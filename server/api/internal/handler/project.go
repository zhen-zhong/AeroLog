package handler

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Project 项目记录
type Project struct {
	ID               int64     `json:"id"`
	Name             string    `json:"name"`
	Token            string    `json:"token"`
	Description      string    `json:"description"`
	RequireSignature bool      `json:"require_signature"`
	Status           int16     `json:"status"`
	CreatedAt        time.Time `json:"created_at"`
}

// ProjectHandler /v1/projects
type ProjectHandler struct {
	PG *pgxpool.Pool
}

func (h *ProjectHandler) Register(r *gin.RouterGroup) {
	r.GET("/projects", h.list)
	r.POST("/projects", h.create)
	r.GET("/projects/:id", h.get)
	r.PATCH("/projects/:id/security", h.updateSecurity)
}

func (h *ProjectHandler) list(c *gin.Context) {
	rows, err := h.PG.Query(c, `SELECT id, name, token, COALESCE(description,''), COALESCE(require_signature,false), status, created_at
		FROM projects ORDER BY id DESC LIMIT 200`)
	if err != nil {
		c.JSON(500, gin.H{"err": err.Error()})
		return
	}
	defer rows.Close()
	out := []Project{}
	for rows.Next() {
		var p Project
		if err := rows.Scan(&p.ID, &p.Name, &p.Token, &p.Description, &p.RequireSignature, &p.Status, &p.CreatedAt); err == nil {
			out = append(out, p)
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *ProjectHandler) get(c *gin.Context) {
	id := c.Param("id")
	var p Project
	err := h.PG.QueryRow(c, `SELECT id, name, token, COALESCE(description,''), COALESCE(require_signature,false), status, created_at
		FROM projects WHERE id=$1`, id).
		Scan(&p.ID, &p.Name, &p.Token, &p.Description, &p.RequireSignature, &p.Status, &p.CreatedAt)
	if err != nil {
		c.JSON(404, gin.H{"err": "not found"})
		return
	}
	c.JSON(200, gin.H{"data": p})
}

type createProjectReq struct {
	Name             string `json:"name" binding:"required"`
	Description      string `json:"description"`
	RequireSignature bool   `json:"require_signature"`
}

func (h *ProjectHandler) create(c *gin.Context) {
	var req createProjectReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"err": err.Error()})
		return
	}
	token, err := randHex(16)
	if err != nil {
		c.JSON(500, gin.H{"err": err.Error()})
		return
	}
	secret, err := randHex(32)
	if err != nil {
		c.JSON(500, gin.H{"err": err.Error()})
		return
	}
	var id int64
	err = h.PG.QueryRow(c,
		`INSERT INTO projects(name, token, secret, description, require_signature) VALUES($1,$2,$3,$4,$5) RETURNING id`,
		req.Name, token, secret, req.Description, req.RequireSignature).Scan(&id)
	if err != nil {
		c.JSON(500, gin.H{"err": err.Error()})
		return
	}
	c.JSON(200, gin.H{"data": gin.H{"id": id, "name": req.Name, "token": token, "require_signature": req.RequireSignature}})
}

func (h *ProjectHandler) updateSecurity(c *gin.Context) {
	id := c.Param("id")
	var req struct {
		RequireSignature bool `json:"require_signature"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	var p Project
	err := h.PG.QueryRow(c, `
		UPDATE projects
		SET require_signature=$2, updated_at=now()
		WHERE id=$1
		RETURNING id, name, token, COALESCE(description,''), COALESCE(require_signature,false), status, created_at
	`, id, req.RequireSignature).
		Scan(&p.ID, &p.Name, &p.Token, &p.Description, &p.RequireSignature, &p.Status, &p.CreatedAt)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"err": "not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

// EventDefHandler 仅做最简列表（基于 ClickHouse 聚合或 Postgres 元数据）
type EventDefHandler struct {
	PG *pgxpool.Pool
}

func (h *EventDefHandler) Register(r *gin.RouterGroup) {
	r.GET("/projects/:id/events", h.list)
	r.PUT("/projects/:id/events/:event/schema", h.updateSchema)
}

func (h *EventDefHandler) list(c *gin.Context) {
	id := c.Param("id")
	rows, err := h.PG.Query(c,
		`SELECT id, name, COALESCE(display_name,''), COALESCE(description,''), schema_required_props, schema_locked, status, first_seen, last_seen
		 FROM event_definitions WHERE project_id=$1 ORDER BY id DESC LIMIT 500`, id)
	if err != nil {
		c.JSON(500, gin.H{"err": err.Error()})
		return
	}
	defer rows.Close()
	type EvDef struct {
		ID            int64      `json:"id"`
		Name          string     `json:"name"`
		DisplayName   string     `json:"display_name"`
		Description   string     `json:"description"`
		RequiredProps []string   `json:"schema_required_props"`
		SchemaLocked  bool       `json:"schema_locked"`
		Status        int16      `json:"status"`
		FirstSeen     *time.Time `json:"first_seen,omitempty"`
		LastSeen      *time.Time `json:"last_seen,omitempty"`
	}
	out := []EvDef{}
	for rows.Next() {
		var e EvDef
		var rawProps []byte
		if err := rows.Scan(&e.ID, &e.Name, &e.DisplayName, &e.Description, &rawProps, &e.SchemaLocked, &e.Status, &e.FirstSeen, &e.LastSeen); err == nil {
			e.RequiredProps = parseStringList(rawProps)
			out = append(out, e)
		}
	}
	c.JSON(200, gin.H{"data": out})
}

func (h *EventDefHandler) updateSchema(c *gin.Context) {
	projectID := c.Param("id")
	eventName := c.Param("event")
	if eventName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"err": "event is required"})
		return
	}
	var req struct {
		RequiredProps []string `json:"schema_required_props"`
		Status        *int16   `json:"status"`
		DisplayName   string   `json:"display_name"`
		Description   string   `json:"description"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	props := cleanStringList(req.RequiredProps)
	rawProps, _ := json.Marshal(props)
	status := int16(1)
	if req.Status != nil {
		status = *req.Status
	}

	type EvDef struct {
		ID            int64    `json:"id"`
		Name          string   `json:"name"`
		DisplayName   string   `json:"display_name"`
		Description   string   `json:"description"`
		RequiredProps []string `json:"schema_required_props"`
		SchemaLocked  bool     `json:"schema_locked"`
		Status        int16    `json:"status"`
	}
	var out EvDef
	var returnedProps []byte
	err := h.PG.QueryRow(c, `
		INSERT INTO event_definitions(project_id, name, display_name, description, schema_required_props, schema_locked, status)
		VALUES($1,$2,$3,$4,$5,true,$6)
		ON CONFLICT (project_id, name) DO UPDATE SET
			display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), event_definitions.display_name),
			description = COALESCE(NULLIF(EXCLUDED.description, ''), event_definitions.description),
			schema_required_props = EXCLUDED.schema_required_props,
			schema_locked = true,
			status = EXCLUDED.status,
			updated_at = now()
		RETURNING id, name, COALESCE(display_name,''), COALESCE(description,''), schema_required_props, schema_locked, status
	`, projectID, eventName, req.DisplayName, req.Description, rawProps, status).
		Scan(&out.ID, &out.Name, &out.DisplayName, &out.Description, &returnedProps, &out.SchemaLocked, &out.Status)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	out.RequiredProps = parseStringList(returnedProps)
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func randHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
