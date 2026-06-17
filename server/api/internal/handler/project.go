package handler

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Project 项目记录
type Project struct {
	ID          int64     `json:"id"`
	Name        string    `json:"name"`
	Token       string    `json:"token"`
	Description string    `json:"description"`
	Status      int16     `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
}

// ProjectHandler /v1/projects
type ProjectHandler struct {
	PG *pgxpool.Pool
}

func (h *ProjectHandler) Register(r *gin.RouterGroup) {
	r.GET("/projects", h.list)
	r.POST("/projects", h.create)
	r.GET("/projects/:id", h.get)
}

func (h *ProjectHandler) list(c *gin.Context) {
	rows, err := h.PG.Query(c, `SELECT id, name, token, COALESCE(description,''), status, created_at
		FROM projects ORDER BY id DESC LIMIT 200`)
	if err != nil {
		c.JSON(500, gin.H{"err": err.Error()})
		return
	}
	defer rows.Close()
	out := []Project{}
	for rows.Next() {
		var p Project
		if err := rows.Scan(&p.ID, &p.Name, &p.Token, &p.Description, &p.Status, &p.CreatedAt); err == nil {
			out = append(out, p)
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *ProjectHandler) get(c *gin.Context) {
	id := c.Param("id")
	var p Project
	err := h.PG.QueryRow(c, `SELECT id, name, token, COALESCE(description,''), status, created_at
		FROM projects WHERE id=$1`, id).
		Scan(&p.ID, &p.Name, &p.Token, &p.Description, &p.Status, &p.CreatedAt)
	if err != nil {
		c.JSON(404, gin.H{"err": "not found"})
		return
	}
	c.JSON(200, gin.H{"data": p})
}

type createProjectReq struct {
	Name        string `json:"name" binding:"required"`
	Description string `json:"description"`
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
		`INSERT INTO projects(name, token, secret, description) VALUES($1,$2,$3,$4) RETURNING id`,
		req.Name, token, secret, req.Description).Scan(&id)
	if err != nil {
		c.JSON(500, gin.H{"err": err.Error()})
		return
	}
	c.JSON(200, gin.H{"data": gin.H{"id": id, "name": req.Name, "token": token}})
}

// EventDefHandler 仅做最简列表（基于 ClickHouse 聚合或 Postgres 元数据）
type EventDefHandler struct {
	PG *pgxpool.Pool
}

func (h *EventDefHandler) Register(r *gin.RouterGroup) {
	r.GET("/projects/:id/events", h.list)
}

func (h *EventDefHandler) list(c *gin.Context) {
	id := c.Param("id")
	rows, err := h.PG.Query(context.Background(),
		`SELECT id, name, COALESCE(display_name,''), COALESCE(description,''), status, first_seen, last_seen
		 FROM event_definitions WHERE project_id=$1 ORDER BY id DESC LIMIT 500`, id)
	if err != nil {
		c.JSON(500, gin.H{"err": err.Error()})
		return
	}
	defer rows.Close()
	type EvDef struct {
		ID          int64      `json:"id"`
		Name        string     `json:"name"`
		DisplayName string     `json:"display_name"`
		Description string     `json:"description"`
		Status      int16      `json:"status"`
		FirstSeen   *time.Time `json:"first_seen,omitempty"`
		LastSeen    *time.Time `json:"last_seen,omitempty"`
	}
	out := []EvDef{}
	for rows.Next() {
		var e EvDef
		if err := rows.Scan(&e.ID, &e.Name, &e.DisplayName, &e.Description, &e.Status, &e.FirstSeen, &e.LastSeen); err == nil {
			out = append(out, e)
		}
	}
	c.JSON(200, gin.H{"data": out})
}

func randHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
