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

// SegmentHandler 管理可保存的动态用户分群。成员在查询时根据规则实时计算，不复制用户数据。
type SegmentHandler struct {
	PG *pgxpool.Pool
	CH driver.Conn
}

func (h *SegmentHandler) Register(r *gin.RouterGroup) {
	r.GET("/projects/:id/segments", h.list)
	r.POST("/projects/:id/segments", h.create)
	r.DELETE("/projects/:id/segments/:segment_id", h.remove)
	r.POST("/projects/:id/segments/preview", h.preview)
}

type SegmentRules struct {
	ProfileProperty string `json:"profile_property,omitempty"`
	ProfileValue    string `json:"profile_value,omitempty"`
	Event           string `json:"event,omitempty"`
	EventCondition  string `json:"event_condition,omitempty"`
	LookbackDays    int    `json:"lookback_days,omitempty"`
}

type UserSegment struct {
	ID          int64        `json:"id"`
	ProjectID   int64        `json:"project_id"`
	Name        string       `json:"name"`
	Description string       `json:"description"`
	Rules       SegmentRules `json:"rules"`
	Status      int16        `json:"status"`
	CreatedAt   time.Time    `json:"created_at"`
	UpdatedAt   time.Time    `json:"updated_at"`
}

func (h *SegmentHandler) list(c *gin.Context) {
	projectID, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	rows, err := h.PG.Query(c, `
		SELECT id, project_id, name, COALESCE(description,''), rules, status, created_at, updated_at
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

	var segment UserSegment
	var raw []byte
	err = h.PG.QueryRow(c, `
		INSERT INTO user_segments(project_id, name, description, rules, created_by)
		VALUES($1,$2,$3,$4,$5)
		RETURNING id, project_id, name, COALESCE(description,''), rules, status, created_at, updated_at
	`, projectID, body.Name, body.Description, rawRules, CurrentUserID(c)).
		Scan(&segment.ID, &segment.ProjectID, &segment.Name, &segment.Description, &raw, &segment.Status, &segment.CreatedAt, &segment.UpdatedAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	if err := json.Unmarshal(raw, &segment.Rules); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": segment})
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
	count, err := h.previewCount(c, projectID, rules)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"users": count}})
}

func (h *SegmentHandler) previewCount(ctx context.Context, projectID int64, rules SegmentRules) (uint64, error) {
	query, args := segmentMembershipQueryForRules(projectID, rules)
	var count uint64
	if err := h.CH.QueryRow(ctx, `SELECT count() FROM (`+query+`)`, args...).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
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

func segmentMembershipQueryForRules(projectID int64, rules SegmentRules) (string, []any) {
	var base string
	args := make([]any, 0, 7)
	if rules.Event != "" && rules.EventCondition == "has" {
		base = `SELECT DISTINCT distinct_id FROM events WHERE project_id=? AND event=? AND time >= fromUnixTimestamp64Milli(?)`
		args = append(args, uint32(projectID), rules.Event, segmentLookbackStart(rules.LookbackDays))
	} else {
		base = `SELECT DISTINCT distinct_id FROM users FINAL WHERE project_id=?`
		args = append(args, uint32(projectID))
	}

	where := ""
	if rules.ProfileProperty != "" {
		where += ` AND distinct_id IN (SELECT distinct_id FROM users FINAL WHERE project_id=? AND JSONExtractRaw(properties, ?) = ?)`
		args = append(args, uint32(projectID), rules.ProfileProperty, rawJSONValue(rules.ProfileValue))
	}
	if rules.Event != "" && rules.EventCondition == "not_has" {
		where += ` AND distinct_id NOT IN (SELECT distinct_id FROM events WHERE project_id=? AND event=? AND time >= fromUnixTimestamp64Milli(?))`
		args = append(args, uint32(projectID), rules.Event, segmentLookbackStart(rules.LookbackDays))
	}

	return base + ` AND 1=1` + where, args
}

func normalizeSegmentRules(rules SegmentRules) (SegmentRules, error) {
	rules.ProfileProperty = strings.TrimSpace(rules.ProfileProperty)
	rules.ProfileValue = strings.TrimSpace(rules.ProfileValue)
	rules.Event = strings.TrimSpace(rules.Event)
	rules.EventCondition = strings.TrimSpace(rules.EventCondition)
	if len(rules.ProfileProperty) > 128 || len(rules.Event) > 128 {
		return SegmentRules{}, errors.New("property and event length must be <= 128")
	}
	if rules.ProfileProperty == "" && rules.Event == "" {
		return SegmentRules{}, errors.New("at least one profile_property or event is required")
	}
	if rules.Event == "" {
		rules.EventCondition = ""
		rules.LookbackDays = 0
		return rules, nil
	}
	if rules.EventCondition == "" {
		rules.EventCondition = "has"
	}
	if rules.EventCondition != "has" && rules.EventCondition != "not_has" {
		return SegmentRules{}, errors.New("event_condition must be has or not_has")
	}
	if rules.LookbackDays == 0 {
		rules.LookbackDays = 30
	}
	if rules.LookbackDays < 1 || rules.LookbackDays > 365 {
		return SegmentRules{}, errors.New("lookback_days must be 1..365")
	}
	return rules, nil
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
	if err := row.Scan(&segment.ID, &segment.ProjectID, &segment.Name, &segment.Description, &raw, &segment.Status, &segment.CreatedAt, &segment.UpdatedAt); err != nil {
		return UserSegment{}, err
	}
	if err := json.Unmarshal(raw, &segment.Rules); err != nil {
		return UserSegment{}, err
	}
	return segment, nil
}
