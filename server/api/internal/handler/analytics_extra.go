package handler

import (
	"encoding/csv"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
)

// listConversionGoalVersions 返回某个目标的版本历史。
func (h *AnalyticsHandler) listConversionGoalVersions(c *gin.Context) {
	pid, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	goalID, _ := strconv.ParseInt(c.Param("goal_id"), 10, 64)
	if goalID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"err": "goal_id required"})
		return
	}
	rows, err := h.PG.Query(c, `
		SELECT id, goal_id, version, name, COALESCE(description,''), events, window_seconds,
		       COALESCE(breakdown_property,''), COALESCE(note,''), created_at
		FROM conversion_goal_versions
		WHERE project_id=$1 AND goal_id=$2
		ORDER BY version DESC LIMIT 100
	`, pid, goalID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	defer rows.Close()
	type Version struct {
		ID                int64     `json:"id"`
		GoalID            int64     `json:"goal_id"`
		Version           int       `json:"version"`
		Name              string    `json:"name"`
		Description       string    `json:"description"`
		Events            []string  `json:"events"`
		WindowSeconds     int       `json:"window_seconds"`
		BreakdownProperty string    `json:"breakdown_property"`
		Note              string    `json:"note"`
		CreatedAt         time.Time `json:"created_at"`
	}
	out := []Version{}
	for rows.Next() {
		var v Version
		var raw []byte
		if err := rows.Scan(&v.ID, &v.GoalID, &v.Version, &v.Name, &v.Description, &raw, &v.WindowSeconds, &v.BreakdownProperty, &v.Note, &v.CreatedAt); err == nil {
			v.Events = parseStringList(raw)
			out = append(out, v)
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// conversionTrend 按天计算转化漏斗，并支持与上一周期对比。
// body: {events, window_seconds, from, to, compare_from?, compare_to?, interval='day'}
func (h *AnalyticsHandler) conversionTrend(c *gin.Context) {
	pid, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	var body struct {
		Events        []string `json:"events"`
		From          int64    `json:"from"`
		To            int64    `json:"to"`
		WindowSeconds int64    `json:"window_seconds"`
		CompareFrom   int64    `json:"compare_from"`
		CompareTo     int64    `json:"compare_to"`
		Interval      string   `json:"interval"`
	}
	if err := c.BindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	if len(body.Events) < 2 || len(body.Events) > 12 {
		c.JSON(http.StatusBadRequest, gin.H{"err": "events length must be 2..12"})
		return
	}
	if body.To == 0 {
		body.To = time.Now().UnixMilli()
	}
	if body.From == 0 {
		body.From = body.To - 7*24*3600*1000
	}
	if body.WindowSeconds <= 0 {
		body.WindowSeconds = 7 * 24 * 3600
	}
	bucket := "day"
	if body.Interval == "hour" {
		bucket = "hour"
	}

	current, err := h.computeFunnelTrend(c, uint32(pid), body.Events, body.From, body.To, body.WindowSeconds, bucket)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	compare := []trendPoint{}
	if body.CompareFrom > 0 && body.CompareTo > 0 {
		compare, err = h.computeFunnelTrend(c, uint32(pid), body.Events, body.CompareFrom, body.CompareTo, body.WindowSeconds, bucket)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"current": current, "compare": compare, "interval": bucket}})
}

type trendPoint struct {
	Bucket     string  `json:"bucket"`
	First      uint64  `json:"first"`
	Last       uint64  `json:"last"`
	Conversion float64 `json:"conversion"`
}

// computeFunnelTrend 按时间桶分组计算每天/每小时的漏斗首末步用户数和总转化率。
func (h *AnalyticsHandler) computeFunnelTrend(c *gin.Context, pid uint32, events []string, from, to, windowSeconds int64, bucket string) ([]trendPoint, error) {
	conds := make([]string, 0, len(events))
	args := make([]any, 0, len(events)+3)
	for _, ev := range events {
		conds = append(conds, "event = ?")
		args = append(args, ev)
	}
	args = append(args, pid, from, to)
	bucketExpr := "toStartOfDay(toDateTime(time))"
	if bucket == "hour" {
		bucketExpr = "toStartOfHour(toDateTime(time))"
	}
	inner := `SELECT ` + bucketExpr + ` AS bucket, distinct_id,
	          windowFunnel(` + strconv.FormatInt(windowSeconds, 10) + `)(toDateTime(time), ` + joinStrs(conds, ", ") + `) AS level
	          FROM events
	          WHERE project_id = ? AND time BETWEEN fromUnixTimestamp64Milli(?) AND fromUnixTimestamp64Milli(?)
	          GROUP BY bucket, distinct_id`
	q := `SELECT bucket, level, count() FROM (` + inner + `) GROUP BY bucket, level ORDER BY bucket`
	rows, err := h.CH.Query(c, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type bucketStats struct {
		first uint64
		last  uint64
	}
	target := uint8(len(events))
	stats := map[time.Time]*bucketStats{}
	order := []time.Time{}
	for rows.Next() {
		var b time.Time
		var lv uint8
		var cnt uint64
		if err := rows.Scan(&b, &lv, &cnt); err != nil {
			continue
		}
		s, ok := stats[b]
		if !ok {
			s = &bucketStats{}
			stats[b] = s
			order = append(order, b)
		}
		if lv >= 1 {
			s.first += cnt
		}
		if lv >= target {
			s.last += cnt
		}
	}
	out := make([]trendPoint, 0, len(order))
	for _, b := range order {
		s := stats[b]
		conv := 0.0
		if s.first > 0 {
			conv = float64(s.last) / float64(s.first)
		}
		out = append(out, trendPoint{
			Bucket:     b.UTC().Format(time.RFC3339),
			First:      s.first,
			Last:       s.last,
			Conversion: conv,
		})
	}
	return out, nil
}

// conversionExport 把参数拆解结果导出为 CSV。
// body: {events, from, to, window_seconds, breakdown_property}
func (h *AnalyticsHandler) conversionExport(c *gin.Context) {
	pid, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	var body struct {
		Events            []string `json:"events"`
		From              int64    `json:"from"`
		To                int64    `json:"to"`
		WindowSeconds     int64    `json:"window_seconds"`
		BreakdownProperty string   `json:"breakdown_property"`
	}
	if err := c.BindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	if len(body.Events) < 2 || len(body.Events) > 12 {
		c.JSON(http.StatusBadRequest, gin.H{"err": "events length must be 2..12"})
		return
	}
	if body.To == 0 {
		body.To = time.Now().UnixMilli()
	}
	if body.From == 0 {
		body.From = body.To - 7*24*3600*1000
	}
	if body.WindowSeconds <= 0 {
		body.WindowSeconds = 7 * 24 * 3600
	}
	ctx := c.Request.Context()
	steps, err := h.computeFunnel(ctx, uint32(pid), body.Events, body.From, body.To, body.WindowSeconds)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	breakdown := []conversionBreakdownRow{}
	if body.BreakdownProperty != "" {
		breakdown, err = h.computeFunnelBreakdown(ctx, uint32(pid), body.Events, body.From, body.To, body.WindowSeconds, body.BreakdownProperty)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
			return
		}
	}

	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", `attachment; filename="conversion_breakdown.csv"`)
	w := csv.NewWriter(c.Writer)
	defer w.Flush()

	// 第一段：总览
	header := []string{"section", "label", "users", "conversion", "dropoff"}
	for _, ev := range body.Events {
		header = append(header, "step:"+ev+":users")
	}
	for _, ev := range body.Events {
		header = append(header, "step:"+ev+":conversion")
	}
	_ = w.Write(header)

	overall := []string{"overall", "全体用户"}
	if len(steps) > 0 {
		overall = append(overall, strconv.FormatUint(steps[0].Users, 10))
		overall = append(overall, formatPercent(steps[len(steps)-1].Conversion))
		overall = append(overall, "")
	} else {
		overall = append(overall, "0", "0", "")
	}
	for _, s := range steps {
		overall = append(overall, strconv.FormatUint(s.Users, 10))
	}
	for _, s := range steps {
		overall = append(overall, formatPercent(s.Conversion))
	}
	_ = w.Write(overall)

	// 第二段：参数拆解
	if body.BreakdownProperty != "" {
		for _, row := range breakdown {
			line := []string{"breakdown", row.Label}
			line = append(line, strconv.FormatUint(row.Users, 10))
			line = append(line, formatPercent(row.Conversion))
			line = append(line, "")
			for _, s := range row.Steps {
				line = append(line, strconv.FormatUint(s.Users, 10))
			}
			for _, s := range row.Steps {
				line = append(line, formatPercent(s.Conversion))
			}
			_ = w.Write(line)
		}
	}
}

// queryTableExport 自助查询的同步 CSV 导出。
// 复用 queryTable 的 body 与逻辑，结果直接写入 CSV，limit 上限提升到 5000。
func (h *AnalyticsHandler) queryTableExport(c *gin.Context) {
	rows, dims, err := h.runQueryTable(c, 5000)
	if err != nil {
		writeQueryTableError(c, err)
		return
	}
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", `attachment; filename="query_table.csv"`)
	w := csv.NewWriter(c.Writer)
	defer w.Flush()
	header := make([]string, 0, len(dims)+3)
	for _, d := range dims {
		if d.Type == "event" {
			header = append(header, "event")
		} else {
			header = append(header, d.Key)
		}
	}
	header = append(header, "count", "users", "sample_users")
	_ = w.Write(header)
	for _, row := range rows {
		line := make([]string, 0, len(dims)+3)
		for _, d := range row.Dimensions {
			line = append(line, d.Label)
		}
		line = append(line, strconv.FormatUint(row.Count, 10))
		line = append(line, strconv.FormatUint(row.Users, 10))
		sample := ""
		for i, u := range row.SampleUsers {
			if i > 0 {
				sample += ";"
			}
			sample += u
		}
		line = append(line, sample)
		_ = w.Write(line)
	}
}

func formatPercent(value float64) string {
	return strconv.FormatFloat(value*100, 'f', 2, 64) + "%"
}
