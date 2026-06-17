package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
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

	q := `SELECT id, name, COALESCE(display_name,''), data_type, scope, COALESCE(description,''),
	            status, first_seen, last_seen
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
		ID          int64      `json:"id"`
		Name        string     `json:"name"`
		DisplayName string     `json:"display_name"`
		DataType    string     `json:"data_type"`
		Scope       string     `json:"scope"`
		Description string     `json:"description"`
		Status      int16      `json:"status"`
		FirstSeen   *time.Time `json:"first_seen,omitempty"`
		LastSeen    *time.Time `json:"last_seen,omitempty"`
	}
	out := []PropertyDef{}
	for rows.Next() {
		var p PropertyDef
		if err := rows.Scan(&p.ID, &p.Name, &p.DisplayName, &p.DataType, &p.Scope, &p.Description, &p.Status, &p.FirstSeen, &p.LastSeen); err == nil {
			out = append(out, p)
		}
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
