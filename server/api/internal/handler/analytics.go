package handler

import (
	"encoding/json"
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
	r.GET("/projects/:id/analytics/property_values", h.propertyValues)
	r.POST("/projects/:id/analytics/query_table", h.queryTable)
	r.POST("/projects/:id/analytics/funnel", h.funnel)
	r.GET("/projects/:id/analytics/retention", h.retention)
	r.GET("/projects/:id/users/:distinct_id/events", h.userEvents)
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

// /v1/projects/:id/analytics/property_values?property=xxx&event=yyy&from=ts&to=ts&limit=20
func (h *AnalyticsHandler) propertyValues(c *gin.Context) {
	pid, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	property := c.Query("property")
	event := c.Query("event")
	from := atoi64(c.DefaultQuery("from", "0"))
	to := atoi64(c.DefaultQuery("to", "0"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if property == "" {
		c.JSON(http.StatusBadRequest, gin.H{"err": "property required"})
		return
	}
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if to == 0 {
		to = time.Now().UnixMilli()
	}
	if from == 0 {
		from = to - 7*24*3600*1000
	}

	where := `project_id = ? AND time BETWEEN fromUnixTimestamp64Milli(?) AND fromUnixTimestamp64Milli(?)`
	args := []any{property, uint32(pid), from, to}
	if event != "" {
		where += ` AND event = ?`
		args = append(args, event)
	}
	args = append(args, uint32(limit))

	q := `
		WITH JSONExtractRaw(properties, ?) AS raw
		SELECT raw, count() AS c, uniqExact(distinct_id) AS u
		FROM events
		WHERE ` + where + ` AND raw != ''
		GROUP BY raw
		ORDER BY c DESC
		LIMIT ?
	`
	rows, err := h.CH.Query(c, q, args...)
	if err != nil {
		c.JSON(500, gin.H{"err": err.Error()})
		return
	}
	defer rows.Close()

	type Item struct {
		Raw   string  `json:"raw"`
		Value any     `json:"value"`
		Label string  `json:"label"`
		Count uint64  `json:"count"`
		Users uint64  `json:"users"`
		Share float64 `json:"share"`
	}
	out := []Item{}
	var total uint64
	for rows.Next() {
		var raw string
		var count uint64
		var users uint64
		if err := rows.Scan(&raw, &count, &users); err != nil {
			continue
		}
		value, label := parsePropertyValue(raw)
		out = append(out, Item{Raw: raw, Value: value, Label: label, Count: count, Users: users})
		total += count
	}
	for i := range out {
		if total > 0 {
			out[i].Share = float64(out[i].Count) / float64(total)
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func parsePropertyValue(raw string) (any, string) {
	var decoded any
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		return raw, raw
	}
	switch v := decoded.(type) {
	case nil:
		return nil, "null"
	case string:
		if v == "" {
			return v, "(空字符串)"
		}
		return v, v
	case float64:
		return v, strconv.FormatFloat(v, 'f', -1, 64)
	case bool:
		return v, strconv.FormatBool(v)
	default:
		b, err := json.Marshal(v)
		if err != nil {
			return v, raw
		}
		return v, string(b)
	}
}

// /v1/projects/:id/users/:distinct_id/events?from=ts&to=ts&event=xxx&limit=100
func (h *AnalyticsHandler) userEvents(c *gin.Context) {
	pid, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	distinctID := c.Param("distinct_id")
	event := c.Query("event")
	from := atoi64(c.DefaultQuery("from", "0"))
	to := atoi64(c.DefaultQuery("to", "0"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	if distinctID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"err": "distinct_id required"})
		return
	}
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	if to == 0 {
		to = time.Now().UnixMilli()
	}
	if from == 0 {
		from = to - 7*24*3600*1000
	}

	where := `project_id = ? AND distinct_id = ? AND time BETWEEN fromUnixTimestamp64Milli(?) AND fromUnixTimestamp64Milli(?)`
	args := []any{uint32(pid), distinctID, from, to}
	if event != "" {
		where += ` AND event = ?`
		args = append(args, event)
	}
	args = append(args, uint32(limit))

	q := `
		SELECT event, distinct_id, user_id, anonymous_id, time, lib, os, properties
		FROM events
		WHERE ` + where + `
		ORDER BY time DESC
		LIMIT ?
	`
	rows, err := h.CH.Query(c, q, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	defer rows.Close()

	type UserEvent struct {
		Event       string                 `json:"event"`
		DistinctID  string                 `json:"distinct_id"`
		UserID      string                 `json:"user_id"`
		AnonymousID string                 `json:"anonymous_id"`
		Time        time.Time              `json:"time"`
		Lib         string                 `json:"lib"`
		OS          string                 `json:"os"`
		Properties  map[string]interface{} `json:"properties"`
	}
	out := []UserEvent{}
	for rows.Next() {
		var item UserEvent
		var raw string
		if err := rows.Scan(&item.Event, &item.DistinctID, &item.UserID, &item.AnonymousID, &item.Time, &item.Lib, &item.OS, &raw); err == nil {
			item.Properties = parseJSONProps(raw)
			out = append(out, item)
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// /v1/projects/:id/analytics/query_table
// body: {events, from, to, dimensions:[{type:"event"|"property", key}], filters:[{event, property, op, value}], limit}
func (h *AnalyticsHandler) queryTable(c *gin.Context) {
	pid, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	var body struct {
		Events     []string `json:"events"`
		From       int64    `json:"from"`
		To         int64    `json:"to"`
		Limit      int      `json:"limit"`
		Dimensions []struct {
			Type string `json:"type"`
			Key  string `json:"key"`
		} `json:"dimensions"`
		Filters []struct {
			Event    string `json:"event"`
			Property string `json:"property"`
			Op       string `json:"op"`
			Value    any    `json:"value"`
		} `json:"filters"`
	}
	if err := c.BindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	if body.To == 0 {
		body.To = time.Now().UnixMilli()
	}
	if body.From == 0 {
		body.From = body.To - 7*24*3600*1000
	}
	if body.Limit <= 0 || body.Limit > 500 {
		body.Limit = 100
	}
	if len(body.Events) > 20 {
		c.JSON(http.StatusBadRequest, gin.H{"err": "events length must be <= 20"})
		return
	}
	if len(body.Filters) > 8 {
		c.JSON(http.StatusBadRequest, gin.H{"err": "filters length must be <= 8"})
		return
	}
	if len(body.Dimensions) == 0 {
		body.Dimensions = append(body.Dimensions, struct {
			Type string `json:"type"`
			Key  string `json:"key"`
		}{Type: "event", Key: "event"})
	}
	if len(body.Dimensions) > 6 {
		c.JSON(http.StatusBadRequest, gin.H{"err": "dimensions length must be <= 6"})
		return
	}

	selectArgs := []any{}
	selects := make([]string, 0, len(body.Dimensions))
	groupKeys := make([]string, 0, len(body.Dimensions))
	type DimMeta struct {
		Type string `json:"type"`
		Key  string `json:"key"`
	}
	metas := make([]DimMeta, 0, len(body.Dimensions))
	for i, dim := range body.Dimensions {
		alias := "d" + strconv.Itoa(i)
		if dim.Type == "event" {
			selects = append(selects, "event AS "+alias)
			metas = append(metas, DimMeta{Type: "event", Key: "event"})
		} else if dim.Type == "property" && dim.Key != "" {
			selects = append(selects, "JSONExtractRaw(properties, ?) AS "+alias)
			selectArgs = append(selectArgs, dim.Key)
			metas = append(metas, DimMeta{Type: "property", Key: dim.Key})
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"err": "invalid dimension"})
			return
		}
		groupKeys = append(groupKeys, alias)
	}

	where := `project_id = ? AND time BETWEEN fromUnixTimestamp64Milli(?) AND fromUnixTimestamp64Milli(?)`
	whereArgs := []any{uint32(pid), body.From, body.To}
	if len(body.Events) > 0 {
		holders := make([]string, 0, len(body.Events))
		for _, event := range body.Events {
			if event == "" {
				continue
			}
			holders = append(holders, "?")
			whereArgs = append(whereArgs, event)
		}
		if len(holders) > 0 {
			where += ` AND event IN (` + joinStrs(holders, ", ") + `)`
		}
	}
	for _, filter := range body.Filters {
		if filter.Event != "" {
			where += ` AND event = ?`
			whereArgs = append(whereArgs, filter.Event)
		}
		if filter.Property == "" {
			continue
		}
		op := filter.Op
		if op == "" {
			op = "eq"
		}
		switch op {
		case "eq":
			where += ` AND JSONExtractRaw(properties, ?) = ?`
			whereArgs = append(whereArgs, filter.Property, rawJSONValue(filter.Value))
		case "neq":
			where += ` AND JSONExtractRaw(properties, ?) != ?`
			whereArgs = append(whereArgs, filter.Property, rawJSONValue(filter.Value))
		case "exists":
			where += ` AND JSONExtractRaw(properties, ?) != ''`
			whereArgs = append(whereArgs, filter.Property)
		default:
			c.JSON(http.StatusBadRequest, gin.H{"err": "unsupported filter op"})
			return
		}
	}

	q := `
		SELECT ` + joinStrs(selects, ", ") + `, count() AS c, uniqExact(distinct_id) AS u
		FROM events
		WHERE ` + where + `
		GROUP BY ` + joinStrs(groupKeys, ", ") + `
		ORDER BY c DESC
		LIMIT ?
	`
	args := append(selectArgs, whereArgs...)
	args = append(args, uint32(body.Limit))
	rows, err := h.CH.Query(c, q, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	defer rows.Close()

	type QueryDimValue struct {
		Type  string `json:"type"`
		Key   string `json:"key"`
		Raw   string `json:"raw"`
		Label string `json:"label"`
		Value any    `json:"value"`
	}
	type QueryRow struct {
		Dimensions []QueryDimValue `json:"dimensions"`
		Count      uint64          `json:"count"`
		Users      uint64          `json:"users"`
	}
	out := []QueryRow{}
	for rows.Next() {
		rawDims := make([]string, len(metas))
		dest := make([]any, 0, len(metas)+2)
		for i := range rawDims {
			dest = append(dest, &rawDims[i])
		}
		var count uint64
		var users uint64
		dest = append(dest, &count, &users)
		if err := rows.Scan(dest...); err != nil {
			continue
		}
		dims := make([]QueryDimValue, 0, len(metas))
		for i, meta := range metas {
			raw := rawDims[i]
			value, label := parseDimensionValue(meta.Type, raw)
			dims = append(dims, QueryDimValue{Type: meta.Type, Key: meta.Key, Raw: raw, Label: label, Value: value})
		}
		out = append(out, QueryRow{Dimensions: dims, Count: count, Users: users})
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"dimensions": metas, "rows": out}})
}

func parseDimensionValue(dimType, raw string) (any, string) {
	if dimType == "event" {
		if raw == "" {
			return raw, "(空事件)"
		}
		return raw, raw
	}
	if raw == "" {
		return nil, "(未设置)"
	}
	return parsePropertyValue(raw)
}

func rawJSONValue(value any) string {
	if s, ok := value.(string); ok {
		if parsed, ok := parseScalarString(s); ok {
			value = parsed
		}
	}
	b, err := json.Marshal(value)
	if err != nil {
		return `""`
	}
	return string(b)
}

func parseScalarString(raw string) (any, bool) {
	if raw == "true" {
		return true, true
	}
	if raw == "false" {
		return false, true
	}
	if raw == "null" {
		return nil, true
	}
	if n, err := strconv.ParseFloat(raw, 64); err == nil {
		return n, true
	}
	return nil, false
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
	args := make([]any, 0, len(body.Events)+3)
	for _, ev := range body.Events {
		conds = append(conds, "event = ?")
		args = append(args, ev)
	}
	args = append(args, uint32(pid), body.From, body.To)

	inner := `SELECT distinct_id, windowFunnel(` + strconv.FormatInt(body.WindowSeconds, 10) + `)(toDateTime(time), ` + joinStrs(conds, ", ") + `) AS level
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

	// 简单实现：分两步
	// 1) cohort_users: 初始事件当天首次发生的 (date, distinct_id)
	// 2) 等值 join 返回事件，再在聚合条件里计算偏移天数。
	valueExprs := make([]string, 0, days)
	for i := 0; i < days; i++ {
		valueExprs = append(valueExprs, "uniqExactIf(c.distinct_id, dateDiff('day', c.d0, r.d) = "+strconv.Itoa(i)+")")
	}
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
	       [` + joinStrs(valueExprs, ", ") + `] AS values
	FROM cohort AS c
	LEFT JOIN ret AS r ON c.distinct_id = r.distinct_id
	GROUP BY c.d0
	ORDER BY c.d0
	`
	rows, err := h.CH.Query(c, q,
		uint32(pid), initEv, from, to,
		uint32(pid), retEv, from, to,
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
