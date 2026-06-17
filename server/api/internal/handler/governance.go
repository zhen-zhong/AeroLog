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
	r.GET("/projects/:id/debug/events", h.debugEvents)
	r.GET("/projects/:id/debug/schema_issues", h.schemaIssues)
	r.GET("/projects/:id/identities", h.identities)
	r.GET("/projects/:id/users", h.users)
	r.GET("/projects/:id/users/:distinct_id/profile", h.profile)
}

func (h *GovernanceHandler) properties(c *gin.Context) {
	if err := h.ensureDebuggerSchema(c); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	id := c.Param("id")
	scope := c.Query("scope")
	if scope != "" && scope != "event" && scope != "user" {
		c.JSON(http.StatusBadRequest, gin.H{"err": "scope must be event or user"})
		return
	}

	q := `SELECT id, name, COALESCE(display_name,''), data_type, scope, COALESCE(description,''),
	            schema_required, schema_locked, enum_values, status, first_seen, last_seen
	      FROM property_definitions
	      WHERE project_id=$1`
	args := []any{id}
	if scope != "" {
		q += ` AND scope=$2`
		args = append(args, scope)
	}
	q += ` ORDER BY scope, last_seen DESC NULLS LAST, id DESC LIMIT 1000`

	rows, err := h.PG.Query(c, q, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	defer rows.Close()

	type PropertyDef struct {
		ID             int64      `json:"id"`
		Name           string     `json:"name"`
		DisplayName    string     `json:"display_name"`
		DataType       string     `json:"data_type"`
		Scope          string     `json:"scope"`
		Description    string     `json:"description"`
		SchemaRequired bool       `json:"schema_required"`
		SchemaLocked   bool       `json:"schema_locked"`
		EnumValues     []string   `json:"enum_values"`
		Status         int16      `json:"status"`
		FirstSeen      *time.Time `json:"first_seen,omitempty"`
		LastSeen       *time.Time `json:"last_seen,omitempty"`
	}
	out := []PropertyDef{}
	for rows.Next() {
		var p PropertyDef
		var rawEnum []byte
		if err := rows.Scan(&p.ID, &p.Name, &p.DisplayName, &p.DataType, &p.Scope, &p.Description, &p.SchemaRequired, &p.SchemaLocked, &rawEnum, &p.Status, &p.FirstSeen, &p.LastSeen); err == nil {
			p.EnumValues = parseStringList(rawEnum)
			out = append(out, p)
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *GovernanceHandler) updatePropertySchema(c *gin.Context) {
	if err := h.ensureDebuggerSchema(c); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	projectID := c.Param("id")
	property := c.Param("property")
	if property == "" {
		c.JSON(http.StatusBadRequest, gin.H{"err": "property is required"})
		return
	}
	var req struct {
		Scope          string   `json:"scope"`
		DataType       string   `json:"data_type"`
		SchemaRequired bool     `json:"schema_required"`
		EnumValues     []string `json:"enum_values"`
		DisplayName    string   `json:"display_name"`
		Description    string   `json:"description"`
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
	if !validDataType(req.DataType) {
		c.JSON(http.StatusBadRequest, gin.H{"err": "invalid data_type"})
		return
	}
	enumValues := cleanStringList(req.EnumValues)
	enumRaw, _ := json.Marshal(enumValues)

	type PropertyDef struct {
		ID             int64    `json:"id"`
		Name           string   `json:"name"`
		DisplayName    string   `json:"display_name"`
		DataType       string   `json:"data_type"`
		Scope          string   `json:"scope"`
		Description    string   `json:"description"`
		SchemaRequired bool     `json:"schema_required"`
		SchemaLocked   bool     `json:"schema_locked"`
		EnumValues     []string `json:"enum_values"`
		Status         int16    `json:"status"`
	}
	var p PropertyDef
	var rawEnum []byte
	err := h.PG.QueryRow(c, `
		INSERT INTO property_definitions(project_id, name, display_name, data_type, scope, description, schema_required, schema_locked, enum_values)
		VALUES($1,$2,$3,$4,$5,$6,$7,true,$8)
		ON CONFLICT (project_id, name, scope) DO UPDATE SET
			display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), property_definitions.display_name),
			description = COALESCE(NULLIF(EXCLUDED.description, ''), property_definitions.description),
			data_type = EXCLUDED.data_type,
			schema_required = EXCLUDED.schema_required,
			schema_locked = true,
			enum_values = EXCLUDED.enum_values,
			updated_at = now()
		RETURNING id, name, COALESCE(display_name,''), data_type, scope, COALESCE(description,''), schema_required, schema_locked, enum_values, status
	`, projectID, property, req.DisplayName, req.DataType, req.Scope, req.Description, req.SchemaRequired, enumRaw).
		Scan(&p.ID, &p.Name, &p.DisplayName, &p.DataType, &p.Scope, &p.Description, &p.SchemaRequired, &p.SchemaLocked, &rawEnum, &p.Status)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	p.EnumValues = parseStringList(rawEnum)
	c.JSON(http.StatusOK, gin.H{"data": p})
}

func (h *GovernanceHandler) debugEvents(c *gin.Context) {
	if err := h.ensureDebuggerSchema(c); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
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
	if err := h.ensureDebuggerSchema(c); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
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

func (h *GovernanceHandler) ensureDebuggerSchema(c *gin.Context) error {
	_, err := h.PG.Exec(c, `
		ALTER TABLE property_definitions ADD COLUMN IF NOT EXISTS schema_required BOOLEAN NOT NULL DEFAULT false;
		ALTER TABLE property_definitions ADD COLUMN IF NOT EXISTS schema_locked BOOLEAN NOT NULL DEFAULT false;
		ALTER TABLE property_definitions ADD COLUMN IF NOT EXISTS enum_values JSONB NOT NULL DEFAULT '[]'::jsonb;
		ALTER TABLE event_definitions ADD COLUMN IF NOT EXISTS schema_required_props JSONB NOT NULL DEFAULT '[]'::jsonb;
		ALTER TABLE event_definitions ADD COLUMN IF NOT EXISTS schema_locked BOOLEAN NOT NULL DEFAULT false;

		CREATE TABLE IF NOT EXISTS debug_events (
			id           BIGSERIAL PRIMARY KEY,
			project_id   BIGINT       REFERENCES projects(id) ON DELETE CASCADE,
			event        VARCHAR(128),
			event_type   VARCHAR(32)   NOT NULL,
			distinct_id  VARCHAR(255),
			user_id      VARCHAR(255),
			anonymous_id VARCHAR(255),
			result       VARCHAR(32)   NOT NULL DEFAULT 'accepted',
			reason       TEXT,
			payload      JSONB         NOT NULL,
			received_at  TIMESTAMPTZ,
			created_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
		);
		ALTER TABLE debug_events ALTER COLUMN project_id DROP NOT NULL;

		CREATE INDEX IF NOT EXISTS idx_debug_events_project_created
			ON debug_events(project_id, created_at DESC);
		CREATE INDEX IF NOT EXISTS idx_debug_events_project_event
			ON debug_events(project_id, event, created_at DESC);

		CREATE TABLE IF NOT EXISTS schema_issues (
			id            BIGSERIAL PRIMARY KEY,
			project_id    BIGINT       NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			event         VARCHAR(128),
			property      VARCHAR(128),
			expected_type VARCHAR(32),
			actual_type   VARCHAR(32),
			severity      VARCHAR(16)   NOT NULL DEFAULT 'warning',
			message       TEXT          NOT NULL,
			payload       JSONB         NOT NULL,
			observed_at   TIMESTAMPTZ,
			created_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
		);

		CREATE INDEX IF NOT EXISTS idx_schema_issues_project_created
			ON schema_issues(project_id, created_at DESC);
		CREATE INDEX IF NOT EXISTS idx_schema_issues_project_property
			ON schema_issues(project_id, property, created_at DESC);
	`)
	return err
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
