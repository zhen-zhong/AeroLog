package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/gin-gonic/gin"
)

// AnalyticsHandler 提供事件趋势/Top 事件等查询。
type AnalyticsHandler struct {
	CH driver.Conn
}

// NewCH 便于 main 复用
func NewCH(addr, db, user, pass string) (driver.Conn, error) {
	return clickhouse.Open(&clickhouse.Options{
		Addr:        []string{addr},
		Auth:        clickhouse.Auth{Database: db, Username: user, Password: pass},
		DialTimeout: 5 * time.Second,
	})
}

func (h *AnalyticsHandler) Register(r *gin.RouterGroup) {
	r.GET("/projects/:id/analytics/trend", h.trend)
	r.GET("/projects/:id/analytics/top_events", h.topEvents)
	r.POST("/projects/:id/analytics/funnel", h.funnel)
	r.GET("/projects/:id/analytics/retention", h.retention)
}

// /v1/projects/:id/analytics/trend?event=xxx&from=ts&to=ts&interval=hour|day
func (h *AnalyticsHandler) trend(c *gin.Context) {
	pid, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	event := c.Query("event")
	from := atoi64(c.DefaultQuery("from", "0"))
	to := atoi64(c.DefaultQuery("to", "0"))
	interval := c.DefaultQuery("interval", "day")
	bucket := "toStartOfDay(time)"
	if interval == "hour" {
		bucket = "toStartOfHour(time)"
	}
	if to == 0 {
		to = time.Now().UnixMilli()
	}
	if from == 0 {
		from = to - 7*24*3600*1000
	}

	q := `SELECT ` + bucket + ` AS bucket, count() AS c
	      FROM events
	      WHERE project_id = ? AND event = ? AND time BETWEEN fromUnixTimestamp64Milli(?) AND fromUnixTimestamp64Milli(?)
	      GROUP BY bucket ORDER BY bucket`
	rows, err := h.CH.Query(c, q, uint32(pid), event, from, to)
	if err != nil {
		c.JSON(500, gin.H{"err": err.Error()})
		return
	}
	defer rows.Close()
	type Pt struct {
		Bucket time.Time `json:"bucket"`
		Count  uint64    `json:"count"`
	}
	out := []Pt{}
	for rows.Next() {
		var p Pt
		if err := rows.Scan(&p.Bucket, &p.Count); err == nil {
			out = append(out, p)
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// /v1/projects/:id/analytics/top_events?from=ts&to=ts&limit=20
func (h *AnalyticsHandler) topEvents(c *gin.Context) {
	pid, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	from := atoi64(c.DefaultQuery("from", "0"))
	to := atoi64(c.DefaultQuery("to", "0"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if to == 0 {
		to = time.Now().UnixMilli()
	}
	if from == 0 {
		from = to - 7*24*3600*1000
	}

	q := `SELECT event, count() AS c, uniqExact(distinct_id) AS u
	      FROM events
	      WHERE project_id = ? AND time BETWEEN fromUnixTimestamp64Milli(?) AND fromUnixTimestamp64Milli(?)
	      GROUP BY event ORDER BY c DESC LIMIT ?`
	rows, err := h.CH.Query(c, q, uint32(pid), from, to, uint32(limit))
	if err != nil {
		c.JSON(500, gin.H{"err": err.Error()})
		return
	}
	defer rows.Close()
	type Item struct {
		Event string `json:"event"`
		Count uint64 `json:"count"`
		Users uint64 `json:"users"`
	}
	out := []Item{}
	for rows.Next() {
		var it Item
		if err := rows.Scan(&it.Event, &it.Count, &it.Users); err == nil {
			out = append(out, it)
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func atoi64(s string) int64 {
	v, _ := strconv.ParseInt(s, 10, 64)
	return v
}

// /v1/projects/:id/analytics/funnel  body: {events:["a","b","c"], from, to, window_seconds}
// 实现思路：按 distinct_id 拉出窗口内的事件序列，根据初始事件时间点 + window_seconds 递次判断后续事件是否出现。
func (h *AnalyticsHandler) funnel(c *gin.Context) {
	pid, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	var body struct {
		Events        []string `json:"events"`
		From          int64    `json:"from"`
		To            int64    `json:"to"`
		WindowSeconds int64    `json:"window_seconds"`
	}
	if err := c.BindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	if len(body.Events) < 2 || len(body.Events) > 8 {
		c.JSON(http.StatusBadRequest, gin.H{"err": "events length must be 2..8"})
		return
	}
	if body.To == 0 {
		body.To = time.Now().UnixMilli()
	}
	if body.From == 0 {
		body.From = body.To - 7*24*3600*1000
	}
	if body.WindowSeconds <= 0 {
		body.WindowSeconds = 24 * 3600
	}

	// ClickHouse 漏斗：windowFunnel 函数
	// SELECT level, count() FROM ( SELECT distinct_id, windowFunnel(W)(time, e=ev1, e=ev2, ...) AS level ... ) GROUP BY level
	conds := make([]string, 0, len(body.Events))
	args := []any{uint32(pid), body.From, body.To}
	for _, ev := range body.Events {
		conds = append(conds, "event = ?")
		args = append(args, ev)
	}
	inner := `SELECT distinct_id, windowFunnel(` + strconv.FormatInt(body.WindowSeconds, 10) + `)(time, ` + joinStrs(conds, ", ") + `) AS level
	          FROM events
	          WHERE project_id = ? AND time BETWEEN fromUnixTimestamp64Milli(?) AND fromUnixTimestamp64Milli(?)
	          GROUP BY distinct_id`
	q := `SELECT level, count() FROM (` + inner + `) GROUP BY level ORDER BY level`
	rows, err := h.CH.Query(c, q, args...)
	if err != nil {
		c.JSON(500, gin.H{"err": err.Error()})
		return
	}
	defer rows.Close()

	levelCounts := make(map[uint8]uint64)
	for rows.Next() {
		var lv uint8
		var cnt uint64
		if err := rows.Scan(&lv, &cnt); err == nil {
			levelCounts[lv] = cnt
		}
	}
	// 累加：达到 step k 表示还达到了后面所有等级 ≥ k
	type Step struct {
		Event      string  `json:"event"`
		Users      uint64  `json:"users"`
		Conversion float64 `json:"conversion"`
	}
	n := len(body.Events)
	cum := make([]uint64, n+1) // cum[k] = users reach level >= k
	for lv, c2 := range levelCounts {
		for i := 0; i <= int(lv); i++ {
			cum[i] += c2
		}
	}
	steps := make([]Step, n)
	first := cum[1]
	for i := 0; i < n; i++ {
		u := cum[i+1]
		conv := 0.0
		if first > 0 {
			conv = float64(u) / float64(first)
		}
		steps[i] = Step{Event: body.Events[i], Users: u, Conversion: conv}
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"steps": steps}})
}

// /v1/projects/:id/analytics/retention?initial_event=xxx&return_event=yyy&from=&to=&days=7
// 以初始事件发生当天为同期，计算 0..days 天后是否发生返回事件
func (h *AnalyticsHandler) retention(c *gin.Context) {
	pid, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	initEv := c.Query("initial_event")
	retEv := c.Query("return_event")
	if initEv == "" || retEv == "" {
		c.JSON(http.StatusBadRequest, gin.H{"err": "initial_event/return_event required"})
		return
	}
	days, _ := strconv.Atoi(c.DefaultQuery("days", "7"))
	if days <= 0 || days > 30 {
		days = 7
	}
	to := atoi64(c.DefaultQuery("to", "0"))
	from := atoi64(c.DefaultQuery("from", "0"))
	if to == 0 {
		to = time.Now().UnixMilli()
	}
	if from == 0 {
		from = to - int64(days+7)*24*3600*1000
	}

	// ClickHouse retention(): 传入多个条件表达式，返回每个 distinct_id 的位图。
	// 这里采用 group by toDate(time) cohort。
	conds := []string{"event = ?"}
	args := []any{initEv}
	for i := 0; i < days; i++ {
		conds = append(conds, "event = ? AND toDate(time) = cohort + INTERVAL ? DAY")
		args = append(args, retEv, i)
	}
	_ = conds
	_ = args

	// 简单实现：分两步
	// 1) cohort_users: 初始事件当天首次发生的 (date, distinct_id)
	// 2) join 返回事件，计算 偏移天数
	q := `
	WITH cohort AS (
		SELECT distinct_id, min(toDate(time)) AS d0
		FROM events
		WHERE project_id = ? AND event = ? AND time BETWEEN fromUnixTimestamp64Milli(?) AND fromUnixTimestamp64Milli(?)
		GROUP BY distinct_id
	),
	ret AS (
		SELECT distinct_id, toDate(time) AS d
		FROM events
		WHERE project_id = ? AND event = ? AND time BETWEEN fromUnixTimestamp64Milli(?) AND fromUnixTimestamp64Milli(?)
		GROUP BY distinct_id, d
	)
	SELECT c.d0 AS cohort,
	       count(DISTINCT c.distinct_id) AS size,
	       arrayMap(i -> uniqExactIf(c.distinct_id, dateDiff('day', c.d0, r.d) = i),
	                range(0, ?)) AS values
	FROM cohort AS c
	LEFT JOIN ret AS r ON c.distinct_id = r.distinct_id AND r.d >= c.d0 AND r.d < c.d0 + ?
	GROUP BY c.d0
	ORDER BY c.d0
	`
	rows, err := h.CH.Query(c, q,
		uint32(pid), initEv, from, to,
		uint32(pid), retEv, from, to,
		uint32(days), uint32(days),
	)
	if err != nil {
		c.JSON(500, gin.H{"err": err.Error()})
		return
	}
	defer rows.Close()
	type Row struct {
		Cohort time.Time `json:"cohort"`
		Size   uint64    `json:"size"`
		Values []uint64  `json:"values"`
	}
	out := []Row{}
	for rows.Next() {
		var r Row
		if err := rows.Scan(&r.Cohort, &r.Size, &r.Values); err == nil {
			out = append(out, r)
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func joinStrs(ss []string, sep string) string {
	switch len(ss) {
	case 0:
		return ""
	case 1:
		return ss[0]
	}
	n := len(sep) * (len(ss) - 1)
	for _, s := range ss {
		n += len(s)
	}
	b := make([]byte, 0, n)
	b = append(b, ss[0]...)
	for _, s := range ss[1:] {
		b = append(b, sep...)
		b = append(b, s...)
	}
	return string(b)
}
