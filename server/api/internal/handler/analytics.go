package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AnalyticsHandler 提供事件趋势/Top 事件等查询。
type AnalyticsHandler struct {
	PG *pgxpool.Pool
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
	r.POST("/projects/:id/analytics/query_table/export", h.queryTableExport)
	r.GET("/projects/:id/conversion_goals", h.listConversionGoals)
	r.POST("/projects/:id/conversion_goals", h.createConversionGoal)
	r.DELETE("/projects/:id/conversion_goals/:goal_id", h.deleteConversionGoal)
	r.GET("/projects/:id/conversion_goals/:goal_id/versions", h.listConversionGoalVersions)
	r.POST("/projects/:id/analytics/conversion", h.conversion)
	r.POST("/projects/:id/analytics/conversion_trend", h.conversionTrend)
	r.POST("/projects/:id/analytics/conversion_export", h.conversionExport)
	r.POST("/projects/:id/analytics/funnel", h.funnel)
	r.GET("/projects/:id/analytics/retention", h.retention)
	r.POST("/projects/:id/analytics/attribution", h.attribution)
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

type conversionGoal struct {
	ID                int64     `json:"id"`
	ProjectID         int64     `json:"project_id"`
	Name              string    `json:"name"`
	Description       string    `json:"description"`
	Events            []string  `json:"events"`
	WindowSeconds     int       `json:"window_seconds"`
	BreakdownProperty string    `json:"breakdown_property"`
	Version           int       `json:"version"`
	Status            int16     `json:"status"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

func (h *AnalyticsHandler) listConversionGoals(c *gin.Context) {
	pid, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	rows, err := h.PG.Query(c, `
		SELECT *
		FROM (
			SELECT DISTINCT ON (name)
			       id, project_id, name, COALESCE(description, '') AS description, events, window_seconds,
			       COALESCE(breakdown_property, '') AS breakdown_property, COALESCE(version, 1) AS version,
			       status, created_at, updated_at
			FROM conversion_goals
			WHERE project_id = $1 AND status = 1
			ORDER BY name, updated_at DESC, id DESC
		) AS latest
		ORDER BY updated_at DESC, id DESC
		LIMIT 100
	`, pid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	defer rows.Close()
	out := []conversionGoal{}
	for rows.Next() {
		var item conversionGoal
		var raw []byte
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.Name, &item.Description, &raw, &item.WindowSeconds, &item.BreakdownProperty, &item.Version, &item.Status, &item.CreatedAt, &item.UpdatedAt); err == nil {
			_ = json.Unmarshal(raw, &item.Events)
			out = append(out, item)
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *AnalyticsHandler) createConversionGoal(c *gin.Context) {
	pid, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	var body struct {
		Name              string   `json:"name"`
		Description       string   `json:"description"`
		Events            []string `json:"events"`
		WindowSeconds     int      `json:"window_seconds"`
		BreakdownProperty string   `json:"breakdown_property"`
		Note              string   `json:"note"`
	}
	if err := c.BindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	if body.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"err": "name required"})
		return
	}
	if len(body.Events) < 2 || len(body.Events) > 12 {
		c.JSON(http.StatusBadRequest, gin.H{"err": "events length must be 2..12"})
		return
	}
	if body.WindowSeconds <= 0 {
		body.WindowSeconds = 7 * 24 * 3600
	}
	rawEvents, _ := json.Marshal(body.Events)
	tx, err := h.PG.Begin(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	defer tx.Rollback(c)

	var item conversionGoal
	var raw []byte
	err = tx.QueryRow(c, `
		UPDATE conversion_goals
		SET description = $3,
		    events = $4::jsonb,
		    window_seconds = $5,
		    breakdown_property = NULLIF($6, ''),
		    version = COALESCE(version, 1) + 1,
		    updated_at = now()
		WHERE project_id = $1 AND name = $2 AND status = 1
		RETURNING id, project_id, name, COALESCE(description, ''), events, window_seconds,
		          COALESCE(breakdown_property, ''), version, status, created_at, updated_at
	`, pid, body.Name, body.Description, string(rawEvents), body.WindowSeconds, body.BreakdownProperty).
		Scan(&item.ID, &item.ProjectID, &item.Name, &item.Description, &raw, &item.WindowSeconds, &item.BreakdownProperty, &item.Version, &item.Status, &item.CreatedAt, &item.UpdatedAt)
	if err == pgx.ErrNoRows {
		err = tx.QueryRow(c, `
		INSERT INTO conversion_goals(project_id, name, description, events, window_seconds, breakdown_property, version)
		VALUES($1, $2, $3, $4::jsonb, $5, NULLIF($6, ''), 1)
		RETURNING id, project_id, name, COALESCE(description, ''), events, window_seconds,
		          COALESCE(breakdown_property, ''), version, status, created_at, updated_at
	`, pid, body.Name, body.Description, string(rawEvents), body.WindowSeconds, body.BreakdownProperty).
			Scan(&item.ID, &item.ProjectID, &item.Name, &item.Description, &raw, &item.WindowSeconds, &item.BreakdownProperty, &item.Version, &item.Status, &item.CreatedAt, &item.UpdatedAt)
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	_ = json.Unmarshal(raw, &item.Events)

	if _, err := tx.Exec(c, `
		INSERT INTO conversion_goal_versions(goal_id, project_id, version, name, description, events, window_seconds, breakdown_property, note)
		VALUES($1, $2, $3, $4, $5, $6::jsonb, $7, NULLIF($8, ''), $9)
		ON CONFLICT (goal_id, version) DO NOTHING
	`, item.ID, item.ProjectID, item.Version, item.Name, item.Description, string(rawEvents), item.WindowSeconds, item.BreakdownProperty, body.Note); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	if err := tx.Commit(c); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": item})
}

func (h *AnalyticsHandler) deleteConversionGoal(c *gin.Context) {
	pid, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	goalID, _ := strconv.ParseInt(c.Param("goal_id"), 10, 64)
	if goalID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"err": "goal_id required"})
		return
	}
	tag, err := h.PG.Exec(c, `
		UPDATE conversion_goals
		SET status = 0, updated_at = now()
		WHERE project_id = $1 AND id = $2 AND status = 1
	`, pid, goalID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	if tag.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"err": "not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"deleted": true}})
}

func (h *AnalyticsHandler) conversion(c *gin.Context) {
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
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"steps": steps, "breakdown": breakdown}})
}

type funnelStep struct {
	Event      string  `json:"event"`
	Users      uint64  `json:"users"`
	Conversion float64 `json:"conversion"`
	Dropoff    float64 `json:"dropoff"`
}

type conversionBreakdownRow struct {
	Raw        string       `json:"raw"`
	Value      any          `json:"value"`
	Label      string       `json:"label"`
	Steps      []funnelStep `json:"steps"`
	Users      uint64       `json:"users"`
	Conversion float64      `json:"conversion"`
}

func (h *AnalyticsHandler) computeFunnel(ctx context.Context, pid uint32, events []string, from, to, windowSeconds int64) ([]funnelStep, error) {
	conds := make([]string, 0, len(events))
	args := make([]any, 0, len(events)+3)
	for _, ev := range events {
		conds = append(conds, "event = ?")
		args = append(args, ev)
	}
	args = append(args, pid, from, to)

	inner := `SELECT distinct_id, windowFunnel(` + strconv.FormatInt(windowSeconds, 10) + `)(toDateTime(time), ` + joinStrs(conds, ", ") + `) AS level
	          FROM events
	          WHERE project_id = ? AND time BETWEEN fromUnixTimestamp64Milli(?) AND fromUnixTimestamp64Milli(?)
	          GROUP BY distinct_id`
	q := `SELECT level, count() FROM (` + inner + `) GROUP BY level ORDER BY level`
	rows, err := h.CH.Query(ctx, q, args...)
	if err != nil {
		return nil, err
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
	return buildFunnelSteps(events, levelCounts), nil
}

func (h *AnalyticsHandler) computeFunnelBreakdown(ctx context.Context, pid uint32, events []string, from, to, windowSeconds int64, property string) ([]conversionBreakdownRow, error) {
	conds := make([]string, 0, len(events))
	args := []any{property, pid, events[0], from, to}
	for _, ev := range events {
		conds = append(conds, "e.event = ?")
		args = append(args, ev)
	}
	args = append(args, pid, from, to)
	q := `
		WITH first_dims AS (
			SELECT distinct_id, argMin(JSONExtractRaw(properties, ?), time) AS dim
			FROM events
			WHERE project_id = ? AND event = ? AND time BETWEEN fromUnixTimestamp64Milli(?) AND fromUnixTimestamp64Milli(?)
			GROUP BY distinct_id
		)
		SELECT dim, level, count()
		FROM (
			SELECT e.distinct_id, f.dim AS dim,
			       windowFunnel(` + strconv.FormatInt(windowSeconds, 10) + `)(toDateTime(e.time), ` + joinStrs(conds, ", ") + `) AS level
			FROM events AS e
			INNER JOIN first_dims AS f ON e.distinct_id = f.distinct_id
			WHERE e.project_id = ? AND e.time BETWEEN fromUnixTimestamp64Milli(?) AND fromUnixTimestamp64Milli(?)
			GROUP BY e.distinct_id, f.dim
		)
		WHERE dim != ''
		GROUP BY dim, level
		ORDER BY count() DESC
	`
	rows, err := h.CH.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type dimCounts map[uint8]uint64
	byDim := map[string]dimCounts{}
	for rows.Next() {
		var dim string
		var lv uint8
		var cnt uint64
		if err := rows.Scan(&dim, &lv, &cnt); err != nil {
			continue
		}
		if byDim[dim] == nil {
			byDim[dim] = dimCounts{}
		}
		byDim[dim][lv] += cnt
	}
	out := make([]conversionBreakdownRow, 0, len(byDim))
	for raw, counts := range byDim {
		steps := buildFunnelSteps(events, counts)
		value, label := parsePropertyValue(raw)
		users := uint64(0)
		conversion := 0.0
		if len(steps) > 0 {
			users = steps[0].Users
			conversion = steps[len(steps)-1].Conversion
		}
		out = append(out, conversionBreakdownRow{Raw: raw, Value: value, Label: label, Steps: steps, Users: users, Conversion: conversion})
	}
	return out, nil
}

func buildFunnelSteps(events []string, levelCounts map[uint8]uint64) []funnelStep {
	n := len(events)
	cum := make([]uint64, n+1)
	for lv, cnt := range levelCounts {
		for i := 0; i <= int(lv) && i <= n; i++ {
			cum[i] += cnt
		}
	}
	steps := make([]funnelStep, n)
	first := cum[1]
	for i := 0; i < n; i++ {
		users := cum[i+1]
		conversion := 0.0
		if first > 0 {
			conversion = float64(users) / float64(first)
		}
		dropoff := 0.0
		if i > 0 && cum[i] > 0 {
			dropoff = 1 - float64(users)/float64(cum[i])
		}
		steps[i] = funnelStep{Event: events[i], Users: users, Conversion: conversion, Dropoff: dropoff}
	}
	return steps
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

	mergedIDs := []string{distinctID}
	mergeIdentity := !strings.EqualFold(c.DefaultQuery("merge_identity", "true"), "false") && c.Query("merge_identity") != "0"
	if mergeIdentity {
		mergedIDs = h.resolveIdentityIDs(c.Request.Context(), uint32(pid), distinctID)
	}
	where := `project_id = ? AND time BETWEEN fromUnixTimestamp64Milli(?) AND fromUnixTimestamp64Milli(?)`
	args := []any{uint32(pid), from, to}
	if len(mergedIDs) <= 1 {
		where += ` AND distinct_id = ?`
		args = append(args, distinctID)
	} else {
		holders := makePlaceholders(len(mergedIDs))
		where += ` AND (distinct_id IN (` + holders + `) OR user_id IN (` + holders + `) OR anonymous_id IN (` + holders + `))`
		for i := 0; i < 3; i++ {
			for _, id := range mergedIDs {
				args = append(args, id)
			}
		}
	}
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
	c.JSON(http.StatusOK, gin.H{"data": out, "merged_ids": mergedIDs})
}

func (h *AnalyticsHandler) resolveIdentityIDs(ctx context.Context, pid uint32, seed string) []string {
	ids := []string{}
	seen := map[string]struct{}{}
	add := func(values ...string) {
		for _, value := range values {
			value = strings.TrimSpace(value)
			if value == "" {
				continue
			}
			if _, ok := seen[value]; ok {
				continue
			}
			if len(ids) >= 100 {
				return
			}
			seen[value] = struct{}{}
			ids = append(ids, value)
		}
	}
	add(seed)

	if h.CH != nil {
		rows, err := h.CH.Query(ctx, `
			SELECT distinct_id, user_id, anonymous_id
			FROM users FINAL
			WHERE project_id = ? AND (distinct_id = ? OR user_id = ? OR anonymous_id = ?)
			LIMIT 50
		`, pid, seed, seed, seed)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var distinctID, userID, anonymousID string
				if err := rows.Scan(&distinctID, &userID, &anonymousID); err == nil {
					add(distinctID, userID, anonymousID)
				}
			}
		}
	}

	if h.PG != nil {
		for round := 0; round < 4; round++ {
			before := len(ids)
			snapshot := append([]string(nil), ids...)
			for _, id := range snapshot {
				rows, err := h.PG.Query(ctx, `
					SELECT anonymous_id, user_id
					FROM identity_mappings
					WHERE project_id = $1 AND (anonymous_id = $2 OR user_id = $2)
					LIMIT 100
				`, int64(pid), id)
				if err != nil {
					continue
				}
				for rows.Next() {
					var anonymousID, userID string
					if err := rows.Scan(&anonymousID, &userID); err == nil {
						add(anonymousID, userID)
					}
				}
				rows.Close()
			}
			if len(ids) == before || len(ids) >= 100 {
				break
			}
		}
	}
	return ids
}

func makePlaceholders(n int) string {
	if n <= 0 {
		return ""
	}
	holders := make([]string, n)
	for i := range holders {
		holders[i] = "?"
	}
	return joinStrs(holders, ", ")
}

// QueryDimMeta 描述自助查询的一个维度。
type QueryDimMeta struct {
	Type string `json:"type"`
	Key  string `json:"key"`
}

// QueryDimValue 单行的维度取值。
type QueryDimValue struct {
	Type  string `json:"type"`
	Key   string `json:"key"`
	Raw   string `json:"raw"`
	Label string `json:"label"`
	Value any    `json:"value"`
}

// QueryRow 自助查询的一行聚合结果。
type QueryRow struct {
	Dimensions  []QueryDimValue `json:"dimensions"`
	Count       uint64          `json:"count"`
	Users       uint64          `json:"users"`
	SampleUsers []string        `json:"sample_users"`
}

// QueryTableBody 是 queryTable / queryTableExport 公用的请求体。
type QueryTableBody struct {
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

// /v1/projects/:id/analytics/query_table
// body: {events, from, to, dimensions:[{type:"event"|"property", key}], filters:[{event, property, op, value}], limit}
func (h *AnalyticsHandler) queryTable(c *gin.Context) {
	rows, dims, err := h.runQueryTable(c, 500)
	if err != nil {
		writeQueryTableError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"dimensions": dims, "rows": rows}})
}

// runQueryTable 抽取了 queryTable 的核心 SQL 构造与执行流程，便于 CSV 导出/异步任务复用。
// limitCap 控制 limit 的硬上限，正常 API 默认 500，导出可放宽到 5000。
func (h *AnalyticsHandler) runQueryTable(c *gin.Context, limitCap int) ([]QueryRow, []QueryDimMeta, error) {
	pid, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	var body QueryTableBody
	if err := c.BindJSON(&body); err != nil {
		return nil, nil, &queryTableError{Status: http.StatusBadRequest, Msg: err.Error()}
	}
	return h.executeQueryTable(c.Request.Context(), uint32(pid), &body, limitCap)
}

// executeQueryTable 真正执行查询，不依赖 gin.Context，便于 worker 调用。
func (h *AnalyticsHandler) executeQueryTable(ctx context.Context, pid uint32, body *QueryTableBody, limitCap int) ([]QueryRow, []QueryDimMeta, error) {
	if body.To == 0 {
		body.To = time.Now().UnixMilli()
	}
	if body.From == 0 {
		body.From = body.To - 7*24*3600*1000
	}
	if limitCap <= 0 {
		limitCap = 500
	}
	if body.Limit <= 0 || body.Limit > limitCap {
		if body.Limit <= 0 {
			body.Limit = 100
		} else {
			body.Limit = limitCap
		}
	}
	if len(body.Events) > 20 {
		return nil, nil, &queryTableError{Status: http.StatusBadRequest, Msg: "events length must be <= 20"}
	}
	if len(body.Filters) > 8 {
		return nil, nil, &queryTableError{Status: http.StatusBadRequest, Msg: "filters length must be <= 8"}
	}
	if len(body.Dimensions) == 0 {
		body.Dimensions = append(body.Dimensions, struct {
			Type string `json:"type"`
			Key  string `json:"key"`
		}{Type: "event", Key: "event"})
	}

	selectArgs := []any{}
	selects := make([]string, 0, len(body.Dimensions))
	groupKeys := make([]string, 0, len(body.Dimensions))
	metas := make([]QueryDimMeta, 0, len(body.Dimensions))
	for i, dim := range body.Dimensions {
		alias := "d" + strconv.Itoa(i)
		if dim.Type == "event" {
			selects = append(selects, "event AS "+alias)
			metas = append(metas, QueryDimMeta{Type: "event", Key: "event"})
		} else if dim.Type == "property" && dim.Key != "" {
			selects = append(selects, "JSONExtractRaw(properties, ?) AS "+alias)
			selectArgs = append(selectArgs, dim.Key)
			metas = append(metas, QueryDimMeta{Type: "property", Key: dim.Key})
		} else {
			return nil, nil, &queryTableError{Status: http.StatusBadRequest, Msg: "invalid dimension"}
		}
		groupKeys = append(groupKeys, alias)
	}

	where := `project_id = ? AND time BETWEEN fromUnixTimestamp64Milli(?) AND fromUnixTimestamp64Milli(?)`
	whereArgs := []any{pid, body.From, body.To}
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
			return nil, nil, &queryTableError{Status: http.StatusBadRequest, Msg: "unsupported filter op"}
		}
	}

	q := `
		SELECT ` + joinStrs(selects, ", ") + `, count() AS c, uniqExact(distinct_id) AS u, groupUniqArray(5)(distinct_id) AS sample_users
		FROM events
		WHERE ` + where + `
		GROUP BY ` + joinStrs(groupKeys, ", ") + `
		ORDER BY c DESC
		LIMIT ?
	`
	args := append(selectArgs, whereArgs...)
	args = append(args, uint32(body.Limit))
	rows, err := h.CH.Query(ctx, q, args...)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	out := []QueryRow{}
	for rows.Next() {
		rawDims := make([]string, len(metas))
		dest := make([]any, 0, len(metas)+2)
		for i := range rawDims {
			dest = append(dest, &rawDims[i])
		}
		var count uint64
		var users uint64
		sampleUsers := []string{}
		dest = append(dest, &count, &users, &sampleUsers)
		if err := rows.Scan(dest...); err != nil {
			continue
		}
		dims := make([]QueryDimValue, 0, len(metas))
		for i, meta := range metas {
			raw := rawDims[i]
			value, label := parseDimensionValue(meta.Type, raw)
			dims = append(dims, QueryDimValue{Type: meta.Type, Key: meta.Key, Raw: raw, Label: label, Value: value})
		}
		out = append(out, QueryRow{Dimensions: dims, Count: count, Users: users, SampleUsers: sampleUsers})
	}
	return out, metas, nil
}

// queryTableError 表示 runQueryTable 返回的可识别错误，附带 HTTP 状态码。
type queryTableError struct {
	Status int
	Msg    string
}

func (e *queryTableError) Error() string { return e.Msg }

func writeQueryTableError(c *gin.Context, err error) {
	if qe, ok := err.(*queryTableError); ok {
		c.JSON(qe.Status, gin.H{"err": qe.Msg})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
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
