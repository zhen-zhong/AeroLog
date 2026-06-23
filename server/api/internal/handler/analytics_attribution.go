package handler

import (
	"context"
	"net/http"
	"sort"
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
//	  breakdown_property: string,                // 可选：按事件属性（如 utm_source/channel）拆分归因
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
//  5. 额外返回：
//     - attributed_users：被分配到任何触点的用户数（用于计算未归因占比）
//     - lag_buckets：基于 picked / weighted 时延的分桶分布（≤1h, ≤6h, ≤1d, ≤3d, ≤7d, >7d）
//     - breakdown：按属性维度拆解的同口径行
func (h *AnalyticsHandler) attribution(c *gin.Context) {
	pid, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	var body struct {
		ConversionEvent   string   `json:"conversion_event"`
		TouchEvents       []string `json:"touch_events"`
		From              int64    `json:"from"`
		To                int64    `json:"to"`
		WindowSeconds     int64    `json:"window_seconds"`
		Model             string   `json:"model"`
		BreakdownProperty string   `json:"breakdown_property"`
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

	ctx := c.Request.Context()

	// 总转化用户数（用于计算未归因占比）
	var totalUsers uint64
	totalQ := `SELECT uniqExact(distinct_id) FROM events
	           WHERE project_id = ? AND event = ?
	             AND time BETWEEN fromUnixTimestamp64Milli(?) AND fromUnixTimestamp64Milli(?)`
	if err := h.CH.QueryRow(ctx, totalQ, uint32(pid), body.ConversionEvent, body.From, body.To).Scan(&totalUsers); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}

	rows, attributedUsers, totalCredit, lagBuckets, err := computeAttribution(ctx, h, uint32(pid), &body, model, "")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}

	breakdown := []attributionBreakdownGroup{}
	breakdownTruncated := false
	if body.BreakdownProperty != "" {
		breakdown, err = computeAttributionBreakdown(ctx, h, uint32(pid), &body, model)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
			return
		}
		breakdown, breakdownTruncated = limitAttributionBreakdown(breakdown, maxBreakdownGroups)
	}

	unattributed := uint64(0)
	if totalUsers > attributedUsers {
		unattributed = totalUsers - attributedUsers
	}
	unattrShare := 0.0
	if totalUsers > 0 {
		unattrShare = float64(unattributed) / float64(totalUsers)
	}

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"model":               model,
			"total_users":         totalUsers,
			"attributed_users":    attributedUsers,
			"unattributed_users":  unattributed,
			"unattributed_share":  unattrShare,
			"total_credit":        totalCredit,
			"window_seconds":      body.WindowSeconds,
			"breakdown_property":  body.BreakdownProperty,
			"breakdown_truncated": breakdownTruncated,
			"rows":                rows,
			"lag_buckets":         lagBuckets,
			"breakdown":           breakdown,
		},
	})
}

type attributionRow struct {
	Event         string  `json:"event"`
	Credit        float64 `json:"credit"`
	Users         uint64  `json:"users"`
	Share         float64 `json:"share"`
	AvgLagSeconds float64 `json:"avg_lag_seconds"`
}

type attributionLagBucket struct {
	Key    string  `json:"key"`
	Label  string  `json:"label"`
	Credit float64 `json:"credit"`
	Users  uint64  `json:"users"`
	Share  float64 `json:"share"`
}

type attributionBreakdownGroup struct {
	Raw         string           `json:"raw"`
	Value       any              `json:"value"`
	Label       string           `json:"label"`
	TotalCredit float64          `json:"total_credit"`
	Users       uint64           `json:"users"`
	TopEvent    string           `json:"top_event"`
	TopShare    float64          `json:"top_share"`
	Rows        []attributionRow `json:"rows"`
}

// lag 分桶定义：升序最大秒数 + 标签
var attributionLagBuckets = []struct {
	max   int64
	key   string
	label string
}{
	{60 * 60, "le_1h", "≤ 1 小时"},
	{6 * 60 * 60, "le_6h", "≤ 6 小时"},
	{24 * 60 * 60, "le_1d", "≤ 1 天"},
	{3 * 24 * 60 * 60, "le_3d", "≤ 3 天"},
	{7 * 24 * 60 * 60, "le_7d", "≤ 7 天"},
	{0, "gt_7d", "> 7 天"},
}

// 共享构造：返回 commonCTE + 参数序列。propertyForGroup 非空时把 dim 也带入 touch_raw（用于 breakdown 路径）。
func attributionBuildCTE(pid uint32, body *struct {
	ConversionEvent   string   `json:"conversion_event"`
	TouchEvents       []string `json:"touch_events"`
	From              int64    `json:"from"`
	To                int64    `json:"to"`
	WindowSeconds     int64    `json:"window_seconds"`
	Model             string   `json:"model"`
	BreakdownProperty string   `json:"breakdown_property"`
}, propertyForGroup string) (string, []any) {
	// SQL 占位符顺序：conv(4) -> [JSONExtractRaw 可选] -> touch_raw 主部分(4) -> touch_events(N)
	args := []any{pid, body.ConversionEvent, body.From, body.To}
	dimSelect := ""
	if propertyForGroup != "" {
		dimSelect = ", JSONExtractRaw(e.properties, ?) AS dim"
		args = append(args, propertyForGroup)
	}
	args = append(args, pid, body.From, body.To, body.WindowSeconds)
	placeholders := make([]string, 0, len(body.TouchEvents))
	for _, ev := range body.TouchEvents {
		placeholders = append(placeholders, "?")
		args = append(args, ev)
	}
	cte := `
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
			       e.time        AS et` + dimSelect + `
			FROM conv c
			INNER JOIN events e ON e.distinct_id = c.distinct_id
			WHERE e.project_id = ?
			  AND e.time BETWEEN fromUnixTimestamp64Milli(?) AND fromUnixTimestamp64Milli(?)
			  AND e.time < c.conv_time
			  AND dateDiff('second', e.time, c.conv_time) <= ?
			  AND e.event IN (` + joinStrs(placeholders, ", ") + `)
		)`
	return cte, args
}

// computeAttribution 主路径：返回 rows / attributedUsers / totalCredit / lagBuckets。
// dimFilter 非空表示只统计该 dim 值的 picked/weighted 行（用于 breakdown 子查询）。
func computeAttribution(ctx context.Context, h *AnalyticsHandler, pid uint32, body *struct {
	ConversionEvent   string   `json:"conversion_event"`
	TouchEvents       []string `json:"touch_events"`
	From              int64    `json:"from"`
	To                int64    `json:"to"`
	WindowSeconds     int64    `json:"window_seconds"`
	Model             string   `json:"model"`
	BreakdownProperty string   `json:"breakdown_property"`
}, model string, _ string) ([]attributionRow, uint64, float64, []attributionLagBucket, error) {
	cte, args := attributionBuildCTE(pid, body, "")

	var aggregated string
	switch model {
	case "first":
		aggregated = `SELECT did, argMin(ev, et) AS pev, any(ct) AS pct, min(et) AS pet, 1.0 AS w
		              FROM touch_raw GROUP BY did`
	case "last":
		aggregated = `SELECT did, argMax(ev, et) AS pev, any(ct) AS pct, max(et) AS pet, 1.0 AS w
		              FROM touch_raw GROUP BY did`
	case "linear":
		aggregated = `SELECT did,
		                     ev AS pev, ct AS pct, et AS pet,
		                     1.0 / count() OVER (PARTITION BY did) AS w
		              FROM touch_raw`
	}

	basicCTE := cte + `, picked AS (` + aggregated + `)`

	// 1) 触点聚合
	qEvents := basicCTE + `
		SELECT pev,
		       sum(w)                                AS credit,
		       uniqExact(did)                        AS users,
		       avg(dateDiff('second', pet, pct))     AS avg_lag
		FROM picked
		GROUP BY pev
		ORDER BY credit DESC`
	rows, err := h.CH.Query(ctx, qEvents, args...)
	if err != nil {
		return nil, 0, 0, nil, err
	}
	out := []attributionRow{}
	for rows.Next() {
		var ev string
		var credit, lag float64
		var users uint64
		if err := rows.Scan(&ev, &credit, &users, &lag); err != nil {
			rows.Close()
			return nil, 0, 0, nil, err
		}
		out = append(out, attributionRow{Event: ev, Credit: credit, Users: users, AvgLagSeconds: lag})
	}
	rows.Close()

	// 2) 全局合计
	var totalCredit float64
	var attributedUsers uint64
	qTotal := basicCTE + ` SELECT sum(w), uniqExact(did) FROM picked`
	if err := h.CH.QueryRow(ctx, qTotal, args...).Scan(&totalCredit, &attributedUsers); err != nil {
		return nil, 0, 0, nil, err
	}
	for i := range out {
		if totalCredit > 0 {
			out[i].Share = out[i].Credit / totalCredit
		}
	}

	// 3) 时延分桶
	qBuckets := basicCTE + `
		SELECT multiIf(
		           dateDiff('second', pet, pct) <= 3600,      'le_1h',
		           dateDiff('second', pet, pct) <= 6*3600,    'le_6h',
		           dateDiff('second', pet, pct) <= 24*3600,   'le_1d',
		           dateDiff('second', pet, pct) <= 3*24*3600, 'le_3d',
		           dateDiff('second', pet, pct) <= 7*24*3600, 'le_7d',
		                                                      'gt_7d'
		       ) AS bk,
		       sum(w)         AS credit,
		       uniqExact(did) AS users
		FROM picked
		GROUP BY bk`
	bRows, err := h.CH.Query(ctx, qBuckets, args...)
	if err != nil {
		return nil, 0, 0, nil, err
	}
	bucketMap := map[string]*attributionLagBucket{}
	for bRows.Next() {
		var key string
		var credit float64
		var users uint64
		if err := bRows.Scan(&key, &credit, &users); err != nil {
			bRows.Close()
			return nil, 0, 0, nil, err
		}
		bucketMap[key] = &attributionLagBucket{Key: key, Credit: credit, Users: users}
	}
	bRows.Close()

	buckets := make([]attributionLagBucket, 0, len(attributionLagBuckets))
	for _, def := range attributionLagBuckets {
		b := attributionLagBucket{Key: def.key, Label: def.label}
		if hit, ok := bucketMap[def.key]; ok {
			b.Credit = hit.Credit
			b.Users = hit.Users
			if totalCredit > 0 {
				b.Share = hit.Credit / totalCredit
			}
		}
		buckets = append(buckets, b)
	}

	return out, attributedUsers, totalCredit, buckets, nil
}

// computeAttributionBreakdown 把 picked/weighted 按 dim 分组，每组返回 rows + 头部触点。
func computeAttributionBreakdown(ctx context.Context, h *AnalyticsHandler, pid uint32, body *struct {
	ConversionEvent   string   `json:"conversion_event"`
	TouchEvents       []string `json:"touch_events"`
	From              int64    `json:"from"`
	To                int64    `json:"to"`
	WindowSeconds     int64    `json:"window_seconds"`
	Model             string   `json:"model"`
	BreakdownProperty string   `json:"breakdown_property"`
}, model string) ([]attributionBreakdownGroup, error) {
	cte, args := attributionBuildCTE(pid, body, body.BreakdownProperty)

	var aggregated string
	switch model {
	case "first":
		// Select a single touch for each conversion before applying the
		// dimension. Grouping by (did, dim) here would credit one conversion
		// more than once whenever its touches span multiple dimensions.
		aggregated = `SELECT did,
		                     argMin(dim, et) AS dim,
		                     argMin(ev, et) AS pev,
		                     any(ct) AS pct, min(et) AS pet, 1.0 AS w
		              FROM touch_raw GROUP BY did`
	case "last":
		aggregated = `SELECT did,
		                     argMax(dim, et) AS dim,
		                     argMax(ev, et) AS pev,
		                     any(ct) AS pct, max(et) AS pet, 1.0 AS w
		              FROM touch_raw GROUP BY did`
	case "linear":
		aggregated = `SELECT did, dim,
		                     ev AS pev, ct AS pct, et AS pet,
		                     1.0 / count() OVER (PARTITION BY did) AS w
		              FROM touch_raw`
	}

	q := cte + `
		, picked AS (` + aggregated + `)
		SELECT dim, pev,
		       sum(w) AS credit,
		       uniqExact(did) AS users,
		       avg(dateDiff('second', pet, pct)) AS avg_lag
		FROM picked
		WHERE dim != ''
		GROUP BY dim, pev
		ORDER BY dim, credit DESC`

	rows, err := h.CH.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	type pair struct {
		event  string
		credit float64
		users  uint64
		lag    float64
	}
	byDim := map[string][]pair{}
	order := []string{}
	for rows.Next() {
		var dim, pev string
		var credit, lag float64
		var users uint64
		if err := rows.Scan(&dim, &pev, &credit, &users, &lag); err != nil {
			continue
		}
		if _, ok := byDim[dim]; !ok {
			order = append(order, dim)
		}
		byDim[dim] = append(byDim[dim], pair{pev, credit, users, lag})
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	// Coverage is a group-level distinct-user count. It cannot be inferred
	// from the per-event counts because one user may touch multiple events.
	qUsers := cte + `
		, picked AS (` + aggregated + `)
		SELECT dim, uniqExact(did)
		FROM picked
		WHERE dim != ''
		GROUP BY dim`
	userRows, err := h.CH.Query(ctx, qUsers, args...)
	if err != nil {
		return nil, err
	}
	defer userRows.Close()
	usersByDim := map[string]uint64{}
	for userRows.Next() {
		var dim string
		var users uint64
		if err := userRows.Scan(&dim, &users); err != nil {
			return nil, err
		}
		usersByDim[dim] = users
	}
	if err := userRows.Err(); err != nil {
		return nil, err
	}

	out := make([]attributionBreakdownGroup, 0, len(order))
	for _, raw := range order {
		list := byDim[raw]
		total := 0.0
		users := usersByDim[raw]
		topEvent := ""
		topCredit := 0.0
		for _, p := range list {
			total += p.credit
			if p.credit > topCredit {
				topCredit = p.credit
				topEvent = p.event
			}
		}
		topShare := 0.0
		if total > 0 {
			topShare = topCredit / total
		}
		rowsOut := make([]attributionRow, 0, len(list))
		for _, p := range list {
			share := 0.0
			if total > 0 {
				share = p.credit / total
			}
			rowsOut = append(rowsOut, attributionRow{
				Event: p.event, Credit: p.credit, Users: p.users, Share: share, AvgLagSeconds: p.lag,
			})
		}
		value, label := parsePropertyValue(raw)
		out = append(out, attributionBreakdownGroup{
			Raw: raw, Value: value, Label: label,
			TotalCredit: total, Users: users,
			TopEvent: topEvent, TopShare: topShare,
			Rows: rowsOut,
		})
	}
	// 总贡献度降序，取值相同时保持结果稳定。
	sort.Slice(out, func(i, j int) bool {
		if out[i].TotalCredit == out[j].TotalCredit {
			return out[i].Label < out[j].Label
		}
		return out[i].TotalCredit > out[j].TotalCredit
	})
	return out, nil
}

// limitAttributionBreakdown prevents a high-cardinality event property from
// producing an unbounded response or an unreadable table. Unlike a funnel,
// linear attribution can legitimately put one user in several groups, so we
// deliberately do not merge the tail into an "other" bucket.
func limitAttributionBreakdown(rows []attributionBreakdownGroup, max int) ([]attributionBreakdownGroup, bool) {
	if max <= 0 || len(rows) <= max {
		return rows, false
	}
	return rows[:max], true
}
