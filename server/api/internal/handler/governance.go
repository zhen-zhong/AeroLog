package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// GovernanceHandler exposes event/property dictionaries, identity links, and user profiles.
type GovernanceHandler struct {
	PG *pgxpool.Pool
	CH driver.Conn
}

func (h *GovernanceHandler) Register(r *gin.RouterGroup) {
	r.GET("/projects/:id/properties", h.properties)
	r.PUT("/projects/:id/properties/:property/schema", h.updatePropertySchema)
	r.PUT("/projects/:id/properties/batch", h.batchUpdateProperties)
	r.GET("/projects/:id/properties/:property/change_log", h.propertyChangeLog)
	r.GET("/projects/:id/debug/events", h.debugEvents)
	r.GET("/projects/:id/debug/schema_issues", h.schemaIssues)
	r.GET("/projects/:id/debug/schema_issue_groups", h.schemaIssueGroups)
	r.GET("/projects/:id/identities", h.identities)
	r.GET("/projects/:id/users", h.users)
	r.GET("/projects/:id/users/:distinct_id/profile", h.profile)
}

func (h *GovernanceHandler) properties(c *gin.Context) {
	id := c.Param("id")
	scope := c.Query("scope")
	if scope != "" && scope != "event" && scope != "user" {
		c.JSON(http.StatusBadRequest, gin.H{"err": "scope must be event or user"})
		return
	}
	event := c.Query("event")
	includeGlobal := c.Query("include_global") == "1" || c.Query("include_global") == "true"
	includeArchived := c.Query("include_archived") == "1" || c.Query("include_archived") == "true"
	includeHidden := c.Query("include_hidden") == "1" || c.Query("include_hidden") == "true"

	q := `SELECT id, name, COALESCE(display_name,''), data_type, scope, COALESCE(event,''), COALESCE(description,''),
	            schema_required, schema_locked, enum_values, status, COALESCE(owner,''),
	            COALESCE(archived,false), COALESCE(hidden,false), first_seen, last_seen
	      FROM property_definitions
	      WHERE project_id=$1`
	args := []any{id}
	if scope != "" {
		args = append(args, scope)
		q += ` AND scope=$` + strconv.Itoa(len(args))
	}
	if event != "" {
		if includeGlobal {
			args = append(args, event)
			q += ` AND (event='' OR event=$` + strconv.Itoa(len(args)) + `)`
		} else {
			args = append(args, event)
			q += ` AND event=$` + strconv.Itoa(len(args))
		}
	}
	if !includeArchived {
		q += ` AND COALESCE(archived,false)=false`
	}
	if !includeHidden {
		q += ` AND COALESCE(hidden,false)=false`
	}
	q += ` ORDER BY scope, event, last_seen DESC NULLS LAST, id DESC LIMIT 1000`

	rows, err := h.PG.Query(c, q, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	defer rows.Close()

	out := []PropertyDef{}
	for rows.Next() {
		var p PropertyDef
		var rawEnum []byte
		if err := rows.Scan(&p.ID, &p.Name, &p.DisplayName, &p.DataType, &p.Scope, &p.Event, &p.Description, &p.SchemaRequired, &p.SchemaLocked, &rawEnum, &p.Status, &p.Owner, &p.Archived, &p.Hidden, &p.FirstSeen, &p.LastSeen); err == nil {
			p.EnumValues = parseStringList(rawEnum)
			out = append(out, p)
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// PropertyDef 是属性定义的对外结构。
type PropertyDef struct {
	ID             int64      `json:"id"`
	Name           string     `json:"name"`
	DisplayName    string     `json:"display_name"`
	DataType       string     `json:"data_type"`
	Scope          string     `json:"scope"`
	Event          string     `json:"event"`
	Description    string     `json:"description"`
	SchemaRequired bool       `json:"schema_required"`
	SchemaLocked   bool       `json:"schema_locked"`
	EnumValues     []string   `json:"enum_values"`
	Status         int16      `json:"status"`
	Owner          string     `json:"owner"`
	Archived       bool       `json:"archived"`
	Hidden         bool       `json:"hidden"`
	FirstSeen      *time.Time `json:"first_seen,omitempty"`
	LastSeen       *time.Time `json:"last_seen,omitempty"`
}

func (h *GovernanceHandler) updatePropertySchema(c *gin.Context) {
	projectID := c.Param("id")
	property := c.Param("property")
	if property == "" {
		c.JSON(http.StatusBadRequest, gin.H{"err": "property is required"})
		return
	}
	var req struct {
		Scope          string   `json:"scope"`
		Event          string   `json:"event"`
		DataType       string   `json:"data_type"`
		SchemaRequired bool     `json:"schema_required"`
		EnumValues     []string `json:"enum_values"`
		DisplayName    string   `json:"display_name"`
		Description    string   `json:"description"`
		Owner          string   `json:"owner"`
		Archived       *bool    `json:"archived"`
		Hidden         *bool    `json:"hidden"`
		Actor          string   `json:"actor"`
		Note           string   `json:"note"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	if req.Scope == "" {
		req.Scope = "event"
	}
	if req.Scope != "event" && req.Scope != "user" {
		c.JSON(http.StatusBadRequest, gin.H{"err": "scope must be event or user"})
		return
	}
	if req.Scope == "user" {
		// 用户属性不区分事件
		req.Event = ""
	}
	if len(req.Event) > 128 {
		c.JSON(http.StatusBadRequest, gin.H{"err": "event length must be <= 128"})
		return
	}
	if !validDataType(req.DataType) {
		c.JSON(http.StatusBadRequest, gin.H{"err": "invalid data_type"})
		return
	}
	enumValues := cleanStringList(req.EnumValues)
	enumRaw, _ := json.Marshal(enumValues)
	archived := false
	archivedSet := req.Archived != nil
	if req.Archived != nil {
		archived = *req.Archived
	}
	hidden := false
	hiddenSet := req.Hidden != nil
	if req.Hidden != nil {
		hidden = *req.Hidden
	}

	// 先取旧值用于审计。
	beforeRaw := h.snapshotProperty(c, projectID, property, req.Scope, req.Event)

	var p PropertyDef
	var rawEnum []byte
	err := h.PG.QueryRow(c, `
		INSERT INTO property_definitions(project_id, name, display_name, data_type, scope, event, description, schema_required, schema_locked, enum_values, owner, archived, hidden)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10,$11,$12)
		ON CONFLICT (project_id, name, scope, event) DO UPDATE SET
			display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), property_definitions.display_name),
			description = COALESCE(NULLIF(EXCLUDED.description, ''), property_definitions.description),
			data_type = EXCLUDED.data_type,
			schema_required = EXCLUDED.schema_required,
			schema_locked = true,
			enum_values = EXCLUDED.enum_values,
			owner = EXCLUDED.owner,
			archived = CASE WHEN $13 THEN EXCLUDED.archived ELSE property_definitions.archived END,
			hidden = CASE WHEN $14 THEN EXCLUDED.hidden ELSE property_definitions.hidden END,
			updated_at = now()
		RETURNING id, name, COALESCE(display_name,''), data_type, scope, COALESCE(event,''), COALESCE(description,''),
		          schema_required, schema_locked, enum_values, status,
		          COALESCE(owner,''), COALESCE(archived,false), COALESCE(hidden,false)
	`, projectID, property, req.DisplayName, req.DataType, req.Scope, req.Event, req.Description, req.SchemaRequired, enumRaw, req.Owner, archived, hidden, archivedSet, hiddenSet).
		Scan(&p.ID, &p.Name, &p.DisplayName, &p.DataType, &p.Scope, &p.Event, &p.Description, &p.SchemaRequired, &p.SchemaLocked, &rawEnum, &p.Status, &p.Owner, &p.Archived, &p.Hidden)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	p.EnumValues = parseStringList(rawEnum)
	afterRaw, _ := json.Marshal(p)
	h.recordPropertyChange(c, projectID, property, req.Scope, req.Event, "update", req.Actor, req.Note, beforeRaw, afterRaw)
	c.JSON(http.StatusOK, gin.H{"data": p})
}

// snapshotProperty 返回某属性当前的 JSONB 快照，用于变更日志的 before。
func (h *GovernanceHandler) snapshotProperty(c *gin.Context, projectID, name, scope, event string) []byte {
	var p PropertyDef
	var rawEnum []byte
	err := h.PG.QueryRow(c, `
		SELECT id, name, COALESCE(display_name,''), data_type, scope, COALESCE(event,''), COALESCE(description,''),
		       schema_required, schema_locked, enum_values, status,
		       COALESCE(owner,''), COALESCE(archived,false), COALESCE(hidden,false)
		FROM property_definitions
		WHERE project_id=$1 AND name=$2 AND scope=$3 AND event=$4
	`, projectID, name, scope, event).
		Scan(&p.ID, &p.Name, &p.DisplayName, &p.DataType, &p.Scope, &p.Event, &p.Description, &p.SchemaRequired, &p.SchemaLocked, &rawEnum, &p.Status, &p.Owner, &p.Archived, &p.Hidden)
	if err != nil {
		return nil
	}
	p.EnumValues = parseStringList(rawEnum)
	buf, _ := json.Marshal(p)
	return buf
}

// recordPropertyChange 记录属性变更日志。
func (h *GovernanceHandler) recordPropertyChange(c *gin.Context, projectID, name, scope, event, changeType, actor, note string, before, after []byte) {
	if changeType == "" {
		changeType = "update"
	}
	_, _ = h.PG.Exec(c, `
		INSERT INTO property_change_log(project_id, property_name, scope, event, change_type, actor, note, before_value, after_value)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)
	`, projectID, name, scope, event, changeType, actor, note, jsonbOrNull(before), jsonbOrNull(after))
}

func jsonbOrNull(raw []byte) any {
	if len(raw) == 0 {
		return nil
	}
	return string(raw)
}

// batchUpdateProperties 批量更新 owner/archived/hidden 状态。
// body: {actor, note, change_type, items:[{name, scope, event, owner?, archived?, hidden?}]}
func (h *GovernanceHandler) batchUpdateProperties(c *gin.Context) {
	projectID := c.Param("id")
	var req struct {
		Actor      string `json:"actor"`
		Note       string `json:"note"`
		ChangeType string `json:"change_type"`
		Items      []struct {
			Name     string  `json:"name"`
			Scope    string  `json:"scope"`
			Event    string  `json:"event"`
			Owner    *string `json:"owner"`
			Archived *bool   `json:"archived"`
			Hidden   *bool   `json:"hidden"`
		} `json:"items"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	if len(req.Items) == 0 || len(req.Items) > 200 {
		c.JSON(http.StatusBadRequest, gin.H{"err": "items length must be 1..200"})
		return
	}
	if req.ChangeType == "" {
		req.ChangeType = "batch"
	}
	updated := 0
	for _, it := range req.Items {
		if it.Name == "" {
			continue
		}
		scope := it.Scope
		if scope == "" {
			scope = "event"
		}
		event := it.Event
		if scope == "user" {
			event = ""
		}
		setExprs := []string{}
		args := []any{projectID, it.Name, scope, event}
		idx := len(args)
		if it.Owner != nil {
			idx++
			setExprs = append(setExprs, "owner=$"+strconv.Itoa(idx))
			args = append(args, *it.Owner)
		}
		if it.Archived != nil {
			idx++
			setExprs = append(setExprs, "archived=$"+strconv.Itoa(idx))
			args = append(args, *it.Archived)
		}
		if it.Hidden != nil {
			idx++
			setExprs = append(setExprs, "hidden=$"+strconv.Itoa(idx))
			args = append(args, *it.Hidden)
		}
		if len(setExprs) == 0 {
			continue
		}
		before := h.snapshotProperty(c, projectID, it.Name, scope, event)
		setSQL := "updated_at=now()"
		for _, e := range setExprs {
			setSQL += ", " + e
		}
		tag, err := h.PG.Exec(c, `UPDATE property_definitions SET `+setSQL+` WHERE project_id=$1 AND name=$2 AND scope=$3 AND event=$4`, args...)
		if err != nil {
			continue
		}
		if tag.RowsAffected() == 0 {
			continue
		}
		after := h.snapshotProperty(c, projectID, it.Name, scope, event)
		if len(after) == 0 {
			continue
		}
		h.recordPropertyChange(c, projectID, it.Name, scope, event, req.ChangeType, req.Actor, req.Note, before, after)
		updated++
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"updated": updated}})
}

// propertyChangeLog 列出某属性的变更历史。
func (h *GovernanceHandler) propertyChangeLog(c *gin.Context) {
	projectID := c.Param("id")
	property := c.Param("property")
	scope := c.Query("scope")
	event := c.Query("event")
	if scope == "" {
		scope = "event"
	}
	if scope == "user" {
		event = ""
	}
	limit := clampLimit(c.DefaultQuery("limit", "50"), 1, 500)
	rows, err := h.PG.Query(c, `
		SELECT id, project_id, property_name, scope, COALESCE(event,''), change_type, COALESCE(actor,''), COALESCE(note,''),
		       COALESCE(before_value::text,''), COALESCE(after_value::text,''), created_at
		FROM property_change_log
		WHERE project_id=$1 AND property_name=$2 AND scope=$3 AND event=$4
		ORDER BY id DESC LIMIT $5
	`, projectID, property, scope, event, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	defer rows.Close()
	type Entry struct {
		ID           int64           `json:"id"`
		ProjectID    int64           `json:"project_id"`
		PropertyName string          `json:"property_name"`
		Scope        string          `json:"scope"`
		Event        string          `json:"event"`
		ChangeType   string          `json:"change_type"`
		Actor        string          `json:"actor"`
		Note         string          `json:"note"`
		BeforeValue  json.RawMessage `json:"before_value,omitempty"`
		AfterValue   json.RawMessage `json:"after_value,omitempty"`
		CreatedAt    time.Time       `json:"created_at"`
	}
	out := []Entry{}
	for rows.Next() {
		var e Entry
		var before, after string
		if err := rows.Scan(&e.ID, &e.ProjectID, &e.PropertyName, &e.Scope, &e.Event, &e.ChangeType, &e.Actor, &e.Note, &before, &after, &e.CreatedAt); err == nil {
			if before != "" {
				e.BeforeValue = json.RawMessage(before)
			}
			if after != "" {
				e.AfterValue = json.RawMessage(after)
			}
			out = append(out, e)
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *GovernanceHandler) debugEvents(c *gin.Context) {
	projectID := c.Param("id")
	limit := clampLimit(c.DefaultQuery("limit", "100"), 1, 500)
	event := c.Query("event")
	result := c.Query("result")
	distinctID := c.Query("distinct_id")
	includeGlobal := c.Query("include_global") == "1" || c.Query("include_global") == "true"

	q := `SELECT id, COALESCE(project_id,0), event, event_type, distinct_id, user_id, anonymous_id, result, COALESCE(reason,''), payload, received_at, created_at
	      FROM debug_events WHERE `
	args := []any{projectID}
	if includeGlobal {
		q += `(project_id=$1 OR project_id IS NULL)`
	} else {
		q += `project_id=$1`
	}
	if event != "" {
		args = append(args, event)
		q += ` AND event=$` + strconv.Itoa(len(args))
	}
	if result != "" {
		args = append(args, result)
		q += ` AND result=$` + strconv.Itoa(len(args))
	}
	if distinctID != "" {
		args = append(args, distinctID)
		q += ` AND distinct_id=$` + strconv.Itoa(len(args))
	}
	args = append(args, limit)
	q += ` ORDER BY created_at DESC LIMIT $` + strconv.Itoa(len(args))

	rows, err := h.PG.Query(c, q, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	defer rows.Close()

	type DebugEvent struct {
		ID          int64                  `json:"id"`
		ProjectID   int64                  `json:"project_id"`
		Event       string                 `json:"event"`
		EventType   string                 `json:"event_type"`
		DistinctID  string                 `json:"distinct_id"`
		UserID      string                 `json:"user_id"`
		AnonymousID string                 `json:"anonymous_id"`
		Result      string                 `json:"result"`
		Reason      string                 `json:"reason"`
		Payload     map[string]interface{} `json:"payload"`
		ReceivedAt  *time.Time             `json:"received_at,omitempty"`
		CreatedAt   time.Time              `json:"created_at"`
	}
	out := []DebugEvent{}
	for rows.Next() {
		var it DebugEvent
		var raw []byte
		if err := rows.Scan(&it.ID, &it.ProjectID, &it.Event, &it.EventType, &it.DistinctID, &it.UserID, &it.AnonymousID, &it.Result, &it.Reason, &raw, &it.ReceivedAt, &it.CreatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
			return
		}
		it.Payload = parseJSONBytes(raw)
		out = append(out, it)
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *GovernanceHandler) schemaIssues(c *gin.Context) {
	projectID := c.Param("id")
	limit := clampLimit(c.DefaultQuery("limit", "100"), 1, 500)
	event := c.Query("event")
	property := c.Query("property")

	q := `SELECT id, event, property, COALESCE(expected_type,''), COALESCE(actual_type,''), severity, message, payload, observed_at, created_at
	      FROM schema_issues WHERE project_id=$1`
	args := []any{projectID}
	if event != "" {
		args = append(args, event)
		q += ` AND event=$` + strconv.Itoa(len(args))
	}
	if property != "" {
		args = append(args, property)
		q += ` AND property=$` + strconv.Itoa(len(args))
	}
	args = append(args, limit)
	q += ` ORDER BY created_at DESC LIMIT $` + strconv.Itoa(len(args))

	rows, err := h.PG.Query(c, q, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	defer rows.Close()

	type SchemaIssue struct {
		ID           int64                  `json:"id"`
		Event        string                 `json:"event"`
		Property     string                 `json:"property"`
		ExpectedType string                 `json:"expected_type"`
		ActualType   string                 `json:"actual_type"`
		Severity     string                 `json:"severity"`
		Message      string                 `json:"message"`
		Payload      map[string]interface{} `json:"payload"`
		ObservedAt   *time.Time             `json:"observed_at,omitempty"`
		CreatedAt    time.Time              `json:"created_at"`
	}
	out := []SchemaIssue{}
	for rows.Next() {
		var it SchemaIssue
		var raw []byte
		if err := rows.Scan(&it.ID, &it.Event, &it.Property, &it.ExpectedType, &it.ActualType, &it.Severity, &it.Message, &raw, &it.ObservedAt, &it.CreatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
			return
		}
		it.Payload = parseJSONBytes(raw)
		out = append(out, it)
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *GovernanceHandler) schemaIssueGroups(c *gin.Context) {
	projectID := c.Param("id")
	limit := clampLimit(c.DefaultQuery("limit", "100"), 1, 500)
	event := c.Query("event")
	property := c.Query("property")

	q := `SELECT id, event, property, expected_type, actual_type, severity, message, fingerprint,
	             count, sample_payload, first_seen, last_seen, created_at, updated_at
	      FROM schema_issue_groups WHERE project_id=$1`
	args := []any{projectID}
	if event != "" {
		args = append(args, event)
		q += ` AND event=$` + strconv.Itoa(len(args))
	}
	if property != "" {
		args = append(args, property)
		q += ` AND property=$` + strconv.Itoa(len(args))
	}
	args = append(args, limit)
	q += ` ORDER BY count DESC, updated_at DESC LIMIT $` + strconv.Itoa(len(args))

	rows, err := h.PG.Query(c, q, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	defer rows.Close()

	type SchemaIssueGroup struct {
		ID            int64                  `json:"id"`
		Event         string                 `json:"event"`
		Property      string                 `json:"property"`
		ExpectedType  string                 `json:"expected_type"`
		ActualType    string                 `json:"actual_type"`
		Severity      string                 `json:"severity"`
		Message       string                 `json:"message"`
		Fingerprint   string                 `json:"fingerprint"`
		Count         int64                  `json:"count"`
		SamplePayload map[string]interface{} `json:"sample_payload"`
		FirstSeen     *time.Time             `json:"first_seen,omitempty"`
		LastSeen      *time.Time             `json:"last_seen,omitempty"`
		CreatedAt     time.Time              `json:"created_at"`
		UpdatedAt     time.Time              `json:"updated_at"`
	}
	out := []SchemaIssueGroup{}
	for rows.Next() {
		var it SchemaIssueGroup
		var raw []byte
		if err := rows.Scan(&it.ID, &it.Event, &it.Property, &it.ExpectedType, &it.ActualType, &it.Severity, &it.Message, &it.Fingerprint, &it.Count, &raw, &it.FirstSeen, &it.LastSeen, &it.CreatedAt, &it.UpdatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
			return
		}
		it.SamplePayload = parseJSONBytes(raw)
		out = append(out, it)
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *GovernanceHandler) identities(c *gin.Context) {
	id := c.Param("id")
	userID := c.Query("user_id")
	anonymousID := c.Query("anonymous_id")
	limit := clampLimit(c.DefaultQuery("limit", "100"), 1, 500)

	q := `SELECT id, anonymous_id, user_id, first_seen, last_seen, updated_at
	      FROM identity_mappings
	      WHERE project_id=$1`
	args := []any{id}
	if userID != "" {
		args = append(args, userID)
		q += ` AND user_id=$` + strconv.Itoa(len(args))
	}
	if anonymousID != "" {
		args = append(args, anonymousID)
		q += ` AND anonymous_id=$` + strconv.Itoa(len(args))
	}
	args = append(args, limit)
	q += ` ORDER BY last_seen DESC NULLS LAST, id DESC LIMIT $` + strconv.Itoa(len(args))

	rows, err := h.PG.Query(c, q, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	defer rows.Close()

	type Identity struct {
		ID          int64      `json:"id"`
		AnonymousID string     `json:"anonymous_id"`
		UserID      string     `json:"user_id"`
		FirstSeen   *time.Time `json:"first_seen,omitempty"`
		LastSeen    *time.Time `json:"last_seen,omitempty"`
		UpdatedAt   time.Time  `json:"updated_at"`
	}
	out := []Identity{}
	for rows.Next() {
		var it Identity
		if err := rows.Scan(&it.ID, &it.AnonymousID, &it.UserID, &it.FirstSeen, &it.LastSeen, &it.UpdatedAt); err == nil {
			out = append(out, it)
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *GovernanceHandler) users(c *gin.Context) {
	pid, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	query := c.Query("query")
	limit := clampLimit(c.DefaultQuery("limit", "100"), 1, 500)

	q := `SELECT distinct_id, user_id, anonymous_id, properties, updated_at
	      FROM users FINAL
	      WHERE project_id = ?`
	args := []any{uint32(pid)}
	if query != "" {
		q += ` AND (distinct_id = ? OR user_id = ? OR anonymous_id = ?)`
		args = append(args, query, query, query)
	}
	q += ` ORDER BY updated_at DESC LIMIT ?`
	args = append(args, uint32(limit))

	rows, err := h.CH.Query(c, q, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	defer rows.Close()

	type UserProfile struct {
		DistinctID  string                 `json:"distinct_id"`
		UserID      string                 `json:"user_id"`
		AnonymousID string                 `json:"anonymous_id"`
		Properties  map[string]interface{} `json:"properties"`
		UpdatedAt   time.Time              `json:"updated_at"`
	}
	out := []UserProfile{}
	for rows.Next() {
		var u UserProfile
		var raw string
		if err := rows.Scan(&u.DistinctID, &u.UserID, &u.AnonymousID, &raw, &u.UpdatedAt); err == nil {
			u.Properties = parseJSONProps(raw)
			out = append(out, u)
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *GovernanceHandler) profile(c *gin.Context) {
	pid, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	distinctID := c.Param("distinct_id")

	var raw string
	type UserProfile struct {
		DistinctID  string                 `json:"distinct_id"`
		UserID      string                 `json:"user_id"`
		AnonymousID string                 `json:"anonymous_id"`
		Properties  map[string]interface{} `json:"properties"`
		UpdatedAt   time.Time              `json:"updated_at"`
	}
	var u UserProfile
	err := h.CH.QueryRow(c, `
		SELECT distinct_id, user_id, anonymous_id, properties, updated_at
		FROM users FINAL
		WHERE project_id = ? AND distinct_id = ?
		ORDER BY updated_at DESC
		LIMIT 1
	`, uint32(pid), distinctID).Scan(&u.DistinctID, &u.UserID, &u.AnonymousID, &raw, &u.UpdatedAt)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"err": "not found"})
		return
	}
	u.Properties = parseJSONProps(raw)
	c.JSON(http.StatusOK, gin.H{"data": u})
}

func parseJSONProps(raw string) map[string]interface{} {
	out := map[string]interface{}{}
	if raw == "" {
		return out
	}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return map[string]interface{}{}
	}
	return out
}

func parseJSONBytes(raw []byte) map[string]interface{} {
	out := map[string]interface{}{}
	if len(raw) == 0 {
		return out
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return map[string]interface{}{}
	}
	return out
}

func parseStringList(raw []byte) []string {
	if len(raw) == 0 {
		return []string{}
	}
	var out []string
	if err := json.Unmarshal(raw, &out); err != nil {
		return []string{}
	}
	return cleanStringList(out)
}

func cleanStringList(values []string) []string {
	seen := map[string]struct{}{}
	out := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func validDataType(dataType string) bool {
	switch dataType {
	case "string", "number", "bool", "datetime", "list", "object", "mixed", "unknown":
		return true
	default:
		return false
	}
}

func clampLimit(raw string, min, max int) int {
	n, err := strconv.Atoi(raw)
	if err != nil || n < min {
		return min
	}
	if n > max {
		return max
	}
	return n
}
