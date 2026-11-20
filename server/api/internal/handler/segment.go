package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SegmentHandler 管理可保存的动态用户分群、规则版本和短期成员缓存。
type SegmentHandler struct {
	PG *pgxpool.Pool
	CH driver.Conn
}

func (h *SegmentHandler) Register(r *gin.RouterGroup) {
	r.GET("/projects/:id/segments", h.list)
	r.POST("/projects/:id/segments", h.create)
	r.PATCH("/projects/:id/segments/:segment_id", h.update)
	r.DELETE("/projects/:id/segments/:segment_id", h.remove)
	r.GET("/projects/:id/segments/:segment_id/versions", h.versions)
	r.POST("/projects/:id/segments/:segment_id/refresh", h.refresh)
	r.POST("/projects/:id/segments/preview", h.preview)
}

const segmentCacheTTL = 15 * time.Minute

type SegmentRules struct {
	ProfileProperty string             `json:"profile_property,omitempty"`
	ProfileValue    string             `json:"profile_value,omitempty"`
	Event           string             `json:"event,omitempty"`
	EventCondition  string             `json:"event_condition,omitempty"`
	EventProperty   string             `json:"event_property,omitempty"`
	EventValue      string             `json:"event_value,omitempty"`
	LookbackDays    int                `json:"lookback_days,omitempty"`
	EventRules      []SegmentEventRule `json:"event_rules,omitempty"`
}

// SegmentEventRule 是动态分群中的单个事件条件。全部条件按 AND 合并。
type SegmentEventRule struct {
	Event        string `json:"event"`
	Condition    string `json:"condition,omitempty"`
	Property     string `json:"property,omitempty"`
	Value        string `json:"value,omitempty"`
	LookbackDays int    `json:"lookback_days,omitempty"`
}

type UserSegment struct {
	ID          int64        `json:"id"`
	ProjectID   int64        `json:"project_id"`
	Name        string       `json:"name"`
	Description string       `json:"description"`
	Rules       SegmentRules `json:"rules"`
	Version     int          `json:"version"`
	CachedUsers *int64       `json:"cached_users,omitempty"`
	CachedAt    *time.Time   `json:"cached_at,omitempty"`
	CacheExpiry *time.Time   `json:"cache_expires_at,omitempty"`
	Status      int16        `json:"status"`
	CreatedAt   time.Time    `json:"created_at"`
	UpdatedAt   time.Time    `json:"updated_at"`
}

type UserSegmentVersion struct {
	ID          int64        `json:"id"`
	SegmentID   int64        `json:"segment_id"`
	ProjectID   int64        `json:"project_id"`
	Version     int          `json:"version"`
	Name        string       `json:"name"`
	Description string       `json:"description"`
	Rules       SegmentRules `json:"rules"`
	CreatedAt   time.Time    `json:"created_at"`
}

func (h *SegmentHandler) list(c *gin.Context) {
	projectID, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	rows, err := h.PG.Query(c, `
		SELECT id, project_id, name, COALESCE(description,''), rules, version,
		       cached_users, cached_at, cache_expires_at, status, created_at, updated_at
		FROM user_segments
		WHERE project_id=$1 AND status=1
		ORDER BY updated_at DESC, id DESC
		LIMIT 200
	`, projectID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	defer rows.Close()

	out := make([]UserSegment, 0)
	for rows.Next() {
		segment, err := scanSegment(rows)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
			return
		}
		out = append(out, segment)
	}
	if err := rows.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *SegmentHandler) create(c *gin.Context) {
	projectID, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	var body struct {
		Name        string       `json:"name"`
		Description string       `json:"description"`
		Rules       SegmentRules `json:"rules"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	body.Name = strings.TrimSpace(body.Name)
	body.Description = strings.TrimSpace(body.Description)
	if body.Name == "" || len(body.Name) > 128 {
		c.JSON(http.StatusBadRequest, gin.H{"err": "name length must be 1..128"})
		return
	}
	if len(body.Description) > 1000 {
		c.JSON(http.StatusBadRequest, gin.H{"err": "description length must be <= 1000"})
		return
	}
	rules, err := normalizeSegmentRules(body.Rules)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	rawRules, _ := json.Marshal(rules)

	tx, err := h.PG.Begin(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	defer tx.Rollback(c)
	var segment UserSegment
	var raw []byte
	err = tx.QueryRow(c, `
		INSERT INTO user_segments(project_id, name, description, rules, created_by)
		VALUES($1,$2,$3,$4,$5)
		RETURNING id, project_id, name, COALESCE(description,''), rules, version,
		          cached_users, cached_at, cache_expires_at, status, created_at, updated_at
	`, projectID, body.Name, body.Description, rawRules, CurrentUserID(c)).
		Scan(&segment.ID, &segment.ProjectID, &segment.Name, &segment.Description, &raw, &segment.Version,
			&segment.CachedUsers, &segment.CachedAt, &segment.CacheExpiry, &segment.Status, &segment.CreatedAt, &segment.UpdatedAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	if err := json.Unmarshal(raw, &segment.Rules); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	if _, err = tx.Exec(c, `
		INSERT INTO user_segment_versions(segment_id, project_id, version, name, description, rules, created_by)
		VALUES($1,$2,$3,$4,$5,$6,$7)
	`, segment.ID, segment.ProjectID, segment.Version, segment.Name, segment.Description, rawRules, CurrentUserID(c)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	if err = tx.Commit(c); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": segment})
}

func (h *SegmentHandler) update(c *gin.Context) {
	projectID, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	segmentID, _ := strconv.ParseInt(c.Param("segment_id"), 10, 64)
	var body struct {
		Name        string       `json:"name"`
		Description string       `json:"description"`
		Rules       SegmentRules `json:"rules"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	body.Name = strings.TrimSpace(body.Name)
	body.Description = strings.TrimSpace(body.Description)
	if body.Name == "" || len(body.Name) > 128 || len(body.Description) > 1000 {
		c.JSON(http.StatusBadRequest, gin.H{"err": "invalid name or description"})
		return
	}
	rules, err := normalizeSegmentRules(body.Rules)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	rawRules, _ := json.Marshal(rules)
	tx, err := h.PG.Begin(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	defer tx.Rollback(c)
	var segment UserSegment
	var raw []byte
	err = tx.QueryRow(c, `
		UPDATE user_segments
		SET name=$1, description=$2, rules=$3, version=version+1,
		    cached_users=NULL, cached_at=NULL, cache_expires_at=NULL, updated_at=now()
		WHERE id=$4 AND project_id=$5 AND status=1
		RETURNING id, project_id, name, COALESCE(description,''), rules, version,
		          cached_users, cached_at, cache_expires_at, status, created_at, updated_at
	`, body.Name, body.Description, rawRules, segmentID, projectID).
		Scan(&segment.ID, &segment.ProjectID, &segment.Name, &segment.Description, &raw, &segment.Version,
			&segment.CachedUsers, &segment.CachedAt, &segment.CacheExpiry, &segment.Status, &segment.CreatedAt, &segment.UpdatedAt)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"err": "segment not found"})
		return
	}
	if err := json.Unmarshal(raw, &segment.Rules); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	if _, err = tx.Exec(c, `
		INSERT INTO user_segment_versions(segment_id, project_id, version, name, description, rules, created_by)
		VALUES($1,$2,$3,$4,$5,$6,$7)
	`, segment.ID, segment.ProjectID, segment.Version, segment.Name, segment.Description, rawRules, CurrentUserID(c)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	if err = tx.Commit(c); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": segment})
}

func (h *SegmentHandler) versions(c *gin.Context) {
	projectID, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	segmentID, _ := strconv.ParseInt(c.Param("segment_id"), 10, 64)
	rows, err := h.PG.Query(c, `
		SELECT id, segment_id, project_id, version, name, COALESCE(description,''), rules, created_at
		FROM user_segment_versions WHERE segment_id=$1 AND project_id=$2 ORDER BY version DESC LIMIT 100
	`, segmentID, projectID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	defer rows.Close()
	out := make([]UserSegmentVersion, 0)
	for rows.Next() {
		var item UserSegmentVersion
		var raw []byte
		if err := rows.Scan(&item.ID, &item.SegmentID, &item.ProjectID, &item.Version, &item.Name, &item.Description, &raw, &item.CreatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
			return
		}
		if err := json.Unmarshal(raw, &item.Rules); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
			return
		}
		out = append(out, item)
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *SegmentHandler) refresh(c *gin.Context) {
	projectID, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	segmentID, _ := strconv.ParseInt(c.Param("segment_id"), 10, 64)
	_, _, users, cachedAt, err := h.refreshMemberCache(c, projectID, segmentID, true)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"users": users, "cached_at": cachedAt, "cache_expires_at": cachedAt.Add(segmentCacheTTL)}})
}

func (h *SegmentHandler) remove(c *gin.Context) {
	projectID, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	segmentID, _ := strconv.ParseInt(c.Param("segment_id"), 10, 64)
	result, err := h.PG.Exec(c, `UPDATE user_segments SET status=0, updated_at=now() WHERE id=$1 AND project_id=$2 AND status=1`, segmentID, projectID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	if result.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"err": "segment not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"ok": true}})
}

func (h *SegmentHandler) preview(c *gin.Context) {
	projectID, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	var body struct {
		Rules SegmentRules `json:"rules"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	rules, err := normalizeSegmentRules(body.Rules)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	count, samples, err := h.previewMembers(c, projectID, rules)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"users": count, "sample_users": samples}})
}

func (h *SegmentHandler) previewMembers(ctx context.Context, projectID int64, rules SegmentRules) (uint64, []string, error) {
	query, args := segmentMembershipQueryForRules(projectID, rules)
	var count uint64
	if err := h.CH.QueryRow(ctx, `SELECT count() FROM (`+query+`)`, args...).Scan(&count); err != nil {
		return 0, nil, err
	}
	rows, err := h.CH.Query(ctx, `SELECT distinct_id FROM (`+query+`) ORDER BY distinct_id LIMIT 20`, args...)
	if err != nil {
		return 0, nil, err
	}
	defer rows.Close()
	samples := make([]string, 0, 20)
	for rows.Next() {
		var distinctID string
		if err := rows.Scan(&distinctID); err != nil {
			return 0, nil, err
		}
		samples = append(samples, distinctID)
	}
	if err := rows.Err(); err != nil {
		return 0, nil, err
	}
	return count, samples, nil
}

// segmentMembershipQuery 读取已保存规则，返回可嵌入 ClickHouse IN 子查询的成员查询。
func segmentMembershipQuery(ctx context.Context, pg *pgxpool.Pool, projectID, segmentID int64) (string, []any, error) {
	if segmentID <= 0 {
		return "", nil, errors.New("segment_id must be positive")
	}
	var raw []byte
	if err := pg.QueryRow(ctx, `SELECT rules FROM user_segments WHERE id=$1 AND project_id=$2 AND status=1`, segmentID, projectID).Scan(&raw); err != nil {
		return "", nil, errors.New("segment not found")
	}
	var rules SegmentRules
	if err := json.Unmarshal(raw, &rules); err != nil {
		return "", nil, errors.New("segment rules are invalid")
	}
	rules, err := normalizeSegmentRules(rules)
	if err != nil {
		return "", nil, err
	}
	query, args := segmentMembershipQueryForRules(projectID, rules)
	return query, args, nil
}

// analyticsSegmentMembers returns an optional members subquery for analytical queries.
func (h *AnalyticsHandler) analyticsSegmentMembers(ctx context.Context, projectID, segmentID int64) (string, []any, error) {
	if segmentID == 0 {
		return "", nil, nil
	}
	segmentHandler := SegmentHandler{PG: h.PG, CH: h.CH}
	query, args, _, _, err := segmentHandler.refreshMemberCache(ctx, projectID, segmentID, false)
	return query, args, err
}

// refreshMemberCache 返回可嵌入分析 SQL 的分群成员查询。
// 缓存过期时将固定版本的 distinct_id 写入 ClickHouse；规则更新会递增版本并立即失效旧缓存。
func (h *SegmentHandler) refreshMemberCache(ctx context.Context, projectID, segmentID int64, force bool) (string, []any, int64, time.Time, error) {
	if segmentID <= 0 {
		return "", nil, 0, time.Time{}, errors.New("segment_id must be positive")
	}
	var raw []byte
	var version int
	var cachedUsers *int64
	var cachedAt, cacheExpiry *time.Time
	err := h.PG.QueryRow(ctx, `
		SELECT rules, version, cached_users, cached_at, cache_expires_at
		FROM user_segments WHERE id=$1 AND project_id=$2 AND status=1
	`, segmentID, projectID).Scan(&raw, &version, &cachedUsers, &cachedAt, &cacheExpiry)
	if err != nil {
		return "", nil, 0, time.Time{}, errors.New("segment not found")
	}
	cacheQuery := `SELECT distinct_id FROM segment_members WHERE project_id=? AND segment_id=? AND segment_version=? AND computed_at=fromUnixTimestamp64Milli(?)`
	if !force && cachedAt != nil && cacheExpiry != nil && cacheExpiry.After(time.Now()) {
		users := int64(0)
		if cachedUsers != nil {
			users = *cachedUsers
		}
		return cacheQuery, []any{uint32(projectID), uint64(segmentID), uint32(version), cachedAt.UnixMilli()}, users, *cachedAt, nil
	}
	var rules SegmentRules
	if json.Unmarshal(raw, &rules) != nil {
		return "", nil, 0, time.Time{}, errors.New("segment rules are invalid")
	}
	rules, err = normalizeSegmentRules(rules)
	if err != nil {
		return "", nil, 0, time.Time{}, err
	}
	dynamicQuery, dynamicArgs := segmentMembershipQueryForRules(projectID, rules)
	computedAt := time.Now().UTC().Truncate(time.Millisecond)
	insert := `INSERT INTO segment_members(project_id, segment_id, segment_version, distinct_id, computed_at)
		SELECT ?, ?, ?, distinct_id, fromUnixTimestamp64Milli(?) FROM (` + dynamicQuery + `)`
	insertArgs := []any{uint32(projectID), uint64(segmentID), uint32(version), computedAt.UnixMilli()}
	insertArgs = append(insertArgs, dynamicArgs...)
	if err := h.CH.Exec(ctx, insert, insertArgs...); err != nil {
		return "", nil, 0, time.Time{}, err
	}
	var count uint64
	cacheArgs := []any{uint32(projectID), uint64(segmentID), uint32(version), computedAt.UnixMilli()}
	if err := h.CH.QueryRow(ctx, `SELECT count() FROM (`+cacheQuery+`)`, cacheArgs...).Scan(&count); err != nil {
		return "", nil, 0, time.Time{}, err
	}
	expiresAt := computedAt.Add(segmentCacheTTL)
	result, err := h.PG.Exec(ctx, `
		UPDATE user_segments SET cached_users=$1, cached_at=$2, cache_expires_at=$3
		WHERE id=$4 AND project_id=$5 AND version=$6 AND status=1
	`, int64(count), computedAt, expiresAt, segmentID, projectID, version)
	if err != nil {
		return "", nil, 0, time.Time{}, err
	}
	if result.RowsAffected() == 0 {
		return "", nil, 0, time.Time{}, errors.New("segment changed while refreshing cache")
	}
	return cacheQuery, cacheArgs, int64(count), computedAt, nil
}

func segmentMembershipQueryForRules(projectID int64, rules SegmentRules) (string, []any) {
	eventRules := segmentEventRules(rules)
	var base string
	args := make([]any, 0, 7+len(eventRules)*4)
	baseRule := -1
	for index, rule := range eventRules {
		if rule.Condition == "has" {
			baseRule = index
			break
		}
	}
	if baseRule >= 0 {
		base, args = segmentEventMembershipQuery(projectID, eventRules[baseRule])
	} else {
		base = `SELECT DISTINCT distinct_id FROM users FINAL WHERE project_id=?`
		args = append(args, uint32(projectID))
	}

	where := ""
	if rules.ProfileProperty != "" {
		where += ` AND distinct_id IN (SELECT distinct_id FROM users FINAL WHERE project_id=? AND JSONExtractRaw(properties, ?) = ?)`
		args = append(args, uint32(projectID), rules.ProfileProperty, rawJSONValue(rules.ProfileValue))
	}
	for index, rule := range eventRules {
		if index == baseRule {
			continue
		}
		eventQuery, eventArgs := segmentEventMembershipQuery(projectID, rule)
		if rule.Condition == "not_has" {
			where += ` AND distinct_id NOT IN (` + eventQuery + `)`
		} else {
			where += ` AND distinct_id IN (` + eventQuery + `)`
		}
		args = append(args, eventArgs...)
	}

	return base + ` AND 1=1` + where, args
}

func segmentEventRules(rules SegmentRules) []SegmentEventRule {
	out := make([]SegmentEventRule, 0, 1+len(rules.EventRules))
	if rules.Event != "" {
		out = append(out, SegmentEventRule{
			Event: rules.Event, Condition: rules.EventCondition, Property: rules.EventProperty,
			Value: rules.EventValue, LookbackDays: rules.LookbackDays,
		})
	}
	return append(out, rules.EventRules...)
}

func segmentEventMembershipQuery(projectID int64, rule SegmentEventRule) (string, []any) {
	query := `SELECT DISTINCT distinct_id FROM events WHERE project_id=? AND event=? AND time >= fromUnixTimestamp64Milli(?)`
	args := []any{uint32(projectID), rule.Event, segmentLookbackStart(rule.LookbackDays)}
	if rule.Property != "" {
		query += ` AND JSONExtractRaw(properties, ?) != ''`
		args = append(args, rule.Property)
		if rule.Value != "" {
			query += ` AND JSONExtractRaw(properties, ?) = ?`
			args = append(args, rule.Property, rawJSONValue(rule.Value))
		}
	}
	return query, args
}

func normalizeSegmentRules(rules SegmentRules) (SegmentRules, error) {
	rules.ProfileProperty = strings.TrimSpace(rules.ProfileProperty)
	rules.ProfileValue = strings.TrimSpace(rules.ProfileValue)
	if len(rules.ProfileProperty) > 128 {
		return SegmentRules{}, errors.New("property and event length must be <= 128")
	}
	if rules.Event != "" {
		primary, err := normalizeSegmentEventRule(SegmentEventRule{
			Event: rules.Event, Condition: rules.EventCondition, Property: rules.EventProperty,
			Value: rules.EventValue, LookbackDays: rules.LookbackDays,
		})
		if err != nil {
			return SegmentRules{}, err
		}
		rules.Event = primary.Event
		rules.EventCondition = primary.Condition
		rules.EventProperty = primary.Property
		rules.EventValue = primary.Value
		rules.LookbackDays = primary.LookbackDays
	} else {
		rules.EventCondition = ""
		rules.EventProperty = ""
		rules.EventValue = ""
		rules.LookbackDays = 0
	}
	if len(rules.EventRules) > 5 {
		return SegmentRules{}, errors.New("event_rules must contain at most 5 conditions")
	}
	var normalizedRules []SegmentEventRule
	if len(rules.EventRules) > 0 {
		normalizedRules = make([]SegmentEventRule, 0, len(rules.EventRules))
	}
	for _, rule := range rules.EventRules {
		normalized, err := normalizeSegmentEventRule(rule)
		if err != nil {
			return SegmentRules{}, err
		}
		normalizedRules = append(normalizedRules, normalized)
	}
	rules.EventRules = normalizedRules
	if rules.ProfileProperty == "" && rules.Event == "" && len(rules.EventRules) == 0 {
		return SegmentRules{}, errors.New("at least one profile_property or event is required")
	}
	return rules, nil
}

func normalizeSegmentEventRule(rule SegmentEventRule) (SegmentEventRule, error) {
	rule.Event = strings.TrimSpace(rule.Event)
	rule.Condition = strings.TrimSpace(rule.Condition)
	rule.Property = strings.TrimSpace(rule.Property)
	rule.Value = strings.TrimSpace(rule.Value)
	if rule.Event == "" || len(rule.Event) > 128 || len(rule.Property) > 128 {
		return SegmentEventRule{}, errors.New("property and event length must be 1..128")
	}
	if rule.Condition == "" {
		rule.Condition = "has"
	}
	if rule.Condition != "has" && rule.Condition != "not_has" {
		return SegmentEventRule{}, errors.New("event condition must be has or not_has")
	}
	if rule.Property == "" && rule.Value != "" {
		return SegmentEventRule{}, errors.New("event property required when event value is set")
	}
	if rule.LookbackDays == 0 {
		rule.LookbackDays = 30
	}
	if rule.LookbackDays < 1 || rule.LookbackDays > 365 {
		return SegmentEventRule{}, errors.New("lookback_days must be 1..365")
	}
	return rule, nil
}

func segmentLookbackStart(days int) int64 {
	return time.Now().AddDate(0, 0, -days).UnixMilli()
}

type segmentRow interface {
	Scan(...any) error
}

func scanSegment(row segmentRow) (UserSegment, error) {
	var segment UserSegment
	var raw []byte
	if err := row.Scan(&segment.ID, &segment.ProjectID, &segment.Name, &segment.Description, &raw, &segment.Version,
		&segment.CachedUsers, &segment.CachedAt, &segment.CacheExpiry, &segment.Status, &segment.CreatedAt, &segment.UpdatedAt); err != nil {
		return UserSegment{}, err
	}
	if err := json.Unmarshal(raw, &segment.Rules); err != nil {
		return UserSegment{}, err
	}
	return segment, nil
}
