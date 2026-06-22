package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
)

// /v1/projects/:id/analytics/attribution
//
//	body: {
//	  conversion_event: string,                  // 转化目标事件，例如 pay_success
//	  touch_events:     []string,                // 待归因的触点事件清单
//	  from, to:         int64 (ms),              // 时间窗口
//	  window_seconds:   int64,                   // 触点回看窗口（秒）
//	  model:            "first" | "last" | "linear"
//	}
//
// 归因思路：
//  1. 找出窗口内每个 distinct_id 最近一次转化事件作为转化锚点；
//  2. 取该锚点之前 window_seconds 秒内、命中 touch_events 的事件序列；
//  3. 按 model 把"一次转化"分配给触点：
//     - first  : 该用户最早一次触点拿全部权重
//     - last   : 最近一次触点拿全部权重
//     - linear : 平均分摊到每一次触点
//  4. 输出每个触点事件的：贡献度 credit、覆盖用户数、平均触达时延。
func (h *AnalyticsHandler) attribution(c *gin.Context) {
	pid, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	var body struct {
		ConversionEvent string   `json:"conversion_event"`
		TouchEvents     []string `json:"touch_events"`
		From            int64    `json:"from"`
		To              int64    `json:"to"`
		WindowSeconds   int64    `json:"window_seconds"`
		Model           string   `json:"model"`
	}
	if err := c.BindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	if body.ConversionEvent == "" {
		c.JSON(http.StatusBadRequest, gin.H{"err": "conversion_event required"})
		return
	}
	if len(body.TouchEvents) == 0 || len(body.TouchEvents) > 32 {
		c.JSON(http.StatusBadRequest, gin.H{"err": "touch_events length must be 1..32"})
		return
	}
	if body.To == 0 {
		body.To = time.Now().UnixMilli()
	}
	if body.From == 0 {
		body.From = body.To - 30*24*3600*1000
	}
	if body.WindowSeconds <= 0 {
		body.WindowSeconds = 7 * 24 * 3600
	}
	model := body.Model
	if model == "" {
		model = "last"
	}
	if model != "first" && model != "last" && model != "linear" {
		c.JSON(http.StatusBadRequest, gin.H{"err": "model must be first|last|linear"})
		return
	}

	// SQL 参数顺序：
	//   conv 子查询：project_id, conversion_event, from, to
	//   touch JOIN：project_id, from, to, window_seconds, touch_events...
	args := []any{
		uint32(pid), body.ConversionEvent, body.From, body.To,
		uint32(pid), body.From, body.To, body.WindowSeconds,
	}
	placeholders := make([]string, 0, len(body.TouchEvents))
	for _, ev := range body.TouchEvents {
		placeholders = append(placeholders, "?")
		args = append(args, ev)
	}

	// 公共 CTE：先得到 (did, conv_time)，再得到 (did, conv_time, ev, et, total_touches)
	commonCTE := `
		WITH conv AS (
			SELECT distinct_id, max(time) AS conv_time
			FROM events
			WHERE project_id = ? AND event = ?
			  AND time BETWEEN fromUnixTimestamp64Milli(?) AND fromUnixTimestamp64Milli(?)
			GROUP BY distinct_id
		),
		touch_raw AS (
			SELECT c.distinct_id AS did,
			       c.conv_time   AS ct,
			       e.event       AS ev,
			       e.time        AS et
			FROM conv c
			INNER JOIN events e ON e.distinct_id = c.distinct_id
			WHERE e.project_id = ?
			  AND e.time BETWEEN fromUnixTimestamp64Milli(?) AND fromUnixTimestamp64Milli(?)
			  AND e.time < c.conv_time
			  AND dateDiff('second', e.time, c.conv_time) <= ?
			  AND e.event IN (` + joinStrs(placeholders, ", ") + `)
		)`

	var q string
	switch model {
	case "first":
		// 每个 did 取 argMin(ev, et)，每个用户为一个触点贡献 1
		q = commonCTE + `
		, picked AS (
			SELECT did, argMin(ev, et) AS pev, any(ct) AS pct, min(et) AS pet
			FROM touch_raw
			GROUP BY did
		)
		SELECT pev,
		       count()                          AS credit_x100,
		       uniqExact(did)                   AS users,
		       avg(dateDiff('second', pet, pct)) AS avg_lag_seconds
		FROM picked
		GROUP BY pev
		ORDER BY credit_x100 DESC`
	case "last":
		q = commonCTE + `
		, picked AS (
			SELECT did, argMax(ev, et) AS pev, any(ct) AS pct, max(et) AS pet
			FROM touch_raw
			GROUP BY did
		)
		SELECT pev,
		       count()                          AS credit_x100,
		       uniqExact(did)                   AS users,
		       avg(dateDiff('second', pet, pct)) AS avg_lag_seconds
		FROM picked
		GROUP BY pev
		ORDER BY credit_x100 DESC`
	case "linear":
		// 每个用户的 N 个触点，每个触点权重 1/N
		q = commonCTE + `
		, weighted AS (
			SELECT ev AS pev, et AS pet, ct AS pct,
			       1.0 / count() OVER (PARTITION BY did) AS w,
			       did
			FROM touch_raw
		)
		SELECT pev,
		       sum(w)                           AS credit,
		       uniqExact(did)                   AS users,
		       avg(dateDiff('second', pet, pct)) AS avg_lag_seconds
		FROM weighted
		GROUP BY pev
		ORDER BY credit DESC`
	}

	// 总转化用户数（用于计算占比）
	var totalUsers uint64
	totalQ := `SELECT uniqExact(distinct_id) FROM events
	           WHERE project_id = ? AND event = ?
	             AND time BETWEEN fromUnixTimestamp64Milli(?) AND fromUnixTimestamp64Milli(?)`
	if err := h.CH.QueryRow(c, totalQ, uint32(pid), body.ConversionEvent, body.From, body.To).Scan(&totalUsers); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}

	rows, err := h.CH.Query(c, q, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	defer rows.Close()

	type Row struct {
		Event         string  `json:"event"`
		Credit        float64 `json:"credit"`
		Users         uint64  `json:"users"`
		Share         float64 `json:"share"`
		AvgLagSeconds float64 `json:"avg_lag_seconds"`
	}
	out := []Row{}
	var totalCredit float64
	for rows.Next() {
		var r Row
		if model == "linear" {
			if err := rows.Scan(&r.Event, &r.Credit, &r.Users, &r.AvgLagSeconds); err != nil {
				continue
			}
		} else {
			var c100 uint64
			if err := rows.Scan(&r.Event, &c100, &r.Users, &r.AvgLagSeconds); err != nil {
				continue
			}
			r.Credit = float64(c100)
		}
		totalCredit += r.Credit
		out = append(out, r)
	}
	for i := range out {
		if totalCredit > 0 {
			out[i].Share = out[i].Credit / totalCredit
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"model":          model,
			"total_users":    totalUsers,
			"total_credit":   totalCredit,
			"window_seconds": body.WindowSeconds,
			"rows":           out,
		},
	})
}
