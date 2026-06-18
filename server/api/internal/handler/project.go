package handler

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	ProjectStatusDisabled int16 = 0
	ProjectStatusEnabled  int16 = 1
	ProjectStatusFrozen   int16 = 2
	ProjectStatusOffline  int16 = 3
)

// Project 项目记录
type Project struct {
	ID               int64     `json:"id"`
	CompanyID        int64     `json:"company_id"`
	CompanyName      string    `json:"company_name"`
	Name             string    `json:"name"`
	AppType          string    `json:"app_type"`
	PackageName      string    `json:"package_name"`
	Token            string    `json:"token"`
	Description      string    `json:"description"`
	RequireSignature bool      `json:"require_signature"`
	Status           int16     `json:"status"`
	Role             string    `json:"role,omitempty"`
	CreatedAt        time.Time `json:"created_at"`
}

type ProjectMember struct {
	ID        int64     `json:"id"`
	ProjectID int64     `json:"project_id"`
	UserID    int64     `json:"user_id"`
	Email     string    `json:"email"`
	Name      string    `json:"name"`
	Role      string    `json:"role"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Company struct {
	ID           int64     `json:"id"`
	Name         string    `json:"name"`
	Industry     string    `json:"industry"`
	ContactName  string    `json:"contact_name"`
	ContactPhone string    `json:"contact_phone"`
	Status       int16     `json:"status"`
	CreatedAt    time.Time `json:"created_at"`
}

// ProjectHandler /v1/projects
type ProjectHandler struct {
	PG *pgxpool.Pool
}

func (h *ProjectHandler) Register(r *gin.RouterGroup) {
	r.GET("/companies", h.listCompanies)
	r.GET("/projects", h.list)
	r.POST("/projects", h.create)
	r.GET("/projects/:id", ProjectRoleRequired(h.PG, RoleViewer), h.get)
	r.PATCH("/projects/:id/security", ProjectRoleRequired(h.PG, RoleOwner), h.updateSecurity)
	r.PATCH("/projects/:id/status", ProjectRoleRequired(h.PG, RoleOwner), h.updateStatus)
	r.GET("/projects/:id/members", ProjectRoleRequired(h.PG, RoleViewer), h.listMembers)
	r.POST("/projects/:id/members", ProjectRoleRequired(h.PG, RoleOwner), h.addMember)
	r.PATCH("/projects/:id/members/:user_id", ProjectRoleRequired(h.PG, RoleOwner), h.updateMember)
	r.DELETE("/projects/:id/members/:user_id", ProjectRoleRequired(h.PG, RoleOwner), h.deleteMember)
}

func (h *ProjectHandler) list(c *gin.Context) {
	var rows pgx.Rows
	var err error
	if IsPlatformAdmin(c) {
		rows, err = h.PG.Query(c, `
			SELECT p.id, COALESCE(p.company_id,0), COALESCE(o.name,''), p.name, COALESCE(p.app_type,'web'),
			       COALESCE(p.package_name,''), p.token, COALESCE(p.description,''), COALESCE(p.require_signature,false),
			       p.status, 'owner'::text, p.created_at
			FROM projects p
			LEFT JOIN organizations o ON o.id=p.company_id
			ORDER BY p.id DESC LIMIT 500
		`)
	} else {
		rows, err = h.PG.Query(c, `
			SELECT p.id, COALESCE(p.company_id,0), COALESCE(o.name,''), p.name, COALESCE(p.app_type,'web'),
			       COALESCE(p.package_name,''), p.token, COALESCE(p.description,''), COALESCE(p.require_signature,false),
			       p.status, m.role, p.created_at
			FROM projects p
			JOIN project_members m ON m.project_id=p.id
			LEFT JOIN organizations o ON o.id=p.company_id
			WHERE m.user_id=$1
			ORDER BY p.id DESC LIMIT 200
		`, CurrentUserID(c))
	}
	if err != nil {
		c.JSON(500, gin.H{"err": err.Error()})
		return
	}
	defer rows.Close()
	out := []Project{}
	for rows.Next() {
		var p Project
		if err := rows.Scan(&p.ID, &p.CompanyID, &p.CompanyName, &p.Name, &p.AppType, &p.PackageName, &p.Token, &p.Description, &p.RequireSignature, &p.Status, &p.Role, &p.CreatedAt); err == nil {
			out = append(out, p)
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *ProjectHandler) get(c *gin.Context) {
	id := c.Param("id")
	var p Project
	err := h.PG.QueryRow(c, `
		SELECT p.id, COALESCE(p.company_id,0), COALESCE(o.name,''), p.name, COALESCE(p.app_type,'web'),
		       COALESCE(p.package_name,''), p.token, COALESCE(p.description,''), COALESCE(p.require_signature,false), p.status, p.created_at
		FROM projects p
		LEFT JOIN organizations o ON o.id=p.company_id
		WHERE p.id=$1
	`, id).Scan(&p.ID, &p.CompanyID, &p.CompanyName, &p.Name, &p.AppType, &p.PackageName, &p.Token, &p.Description, &p.RequireSignature, &p.Status, &p.CreatedAt)
	if err != nil {
		c.JSON(404, gin.H{"err": "not found"})
		return
	}
	p.Role = CurrentProjectRole(c)
	c.JSON(200, gin.H{"data": p})
}

type createProjectReq struct {
	Name             string `json:"name" binding:"required"`
	CompanyID        int64  `json:"company_id"`
	AppType          string `json:"app_type"`
	PackageName      string `json:"package_name"`
	Description      string `json:"description"`
	RequireSignature bool   `json:"require_signature"`
	Status           *int16 `json:"status"`
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
	appType := normalizeAppType(req.AppType)
	packageName := strings.TrimSpace(req.PackageName)
	if requiresPackageName(appType) && packageName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"err": "package_name is required for app project"})
		return
	}
	companyID := CurrentCompanyID(c)
	if IsPlatformAdmin(c) && req.CompanyID > 0 {
		companyID = req.CompanyID
	}
	status := ProjectStatusEnabled
	if req.Status != nil {
		var ok bool
		status, ok = normalizeProjectStatus(*req.Status)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"err": "project status is invalid"})
			return
		}
	}
	var id int64
	tx, err := h.PG.BeginTx(c, pgx.TxOptions{})
	if err != nil {
		c.JSON(500, gin.H{"err": err.Error()})
		return
	}
	defer func() { _ = tx.Rollback(c) }()
	err = tx.QueryRow(c,
		`INSERT INTO projects(company_id, name, app_type, package_name, token, secret, description, require_signature, status, created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
		companyID, req.Name, appType, packageName, token, secret, req.Description, req.RequireSignature, status, CurrentUserID(c)).Scan(&id)
	if err != nil {
		c.JSON(500, gin.H{"err": err.Error()})
		return
	}
	if _, err := tx.Exec(c, `
		INSERT INTO project_members(project_id, user_id, role)
		VALUES($1,$2,'owner')
	`, id, CurrentUserID(c)); err != nil {
		c.JSON(500, gin.H{"err": err.Error()})
		return
	}
	if err := tx.Commit(c); err != nil {
		c.JSON(500, gin.H{"err": err.Error()})
		return
	}
	c.JSON(200, gin.H{"data": gin.H{"id": id, "company_id": companyID, "name": req.Name, "app_type": appType, "package_name": packageName, "token": token, "require_signature": req.RequireSignature, "status": status, "role": RoleOwner}})
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
		RETURNING id, COALESCE(company_id,0), name, COALESCE(app_type,'web'), COALESCE(package_name,''), token, COALESCE(description,''), COALESCE(require_signature,false), status, created_at
	`, id, req.RequireSignature).
		Scan(&p.ID, &p.CompanyID, &p.Name, &p.AppType, &p.PackageName, &p.Token, &p.Description, &p.RequireSignature, &p.Status, &p.CreatedAt)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"err": "not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

func (h *ProjectHandler) updateStatus(c *gin.Context) {
	id := c.Param("id")
	var req struct {
		Status int16 `json:"status"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	status, ok := normalizeProjectStatus(req.Status)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"err": "project status is invalid"})
		return
	}
	var p Project
	err := h.PG.QueryRow(c, `
		UPDATE projects
		SET status=$2, updated_at=now()
		WHERE id=$1
		RETURNING id, COALESCE(company_id,0), name, COALESCE(app_type,'web'), COALESCE(package_name,''), token, COALESCE(description,''), COALESCE(require_signature,false), status, created_at
	`, id, status).
		Scan(&p.ID, &p.CompanyID, &p.Name, &p.AppType, &p.PackageName, &p.Token, &p.Description, &p.RequireSignature, &p.Status, &p.CreatedAt)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"err": "not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

func (h *ProjectHandler) listCompanies(c *gin.Context) {
	var rows pgx.Rows
	var err error
	if IsPlatformAdmin(c) {
		rows, err = h.PG.Query(c, `
			SELECT id, name, COALESCE(industry,''), COALESCE(contact_name,''), COALESCE(contact_phone,''), status, created_at
			FROM organizations
			WHERE status=1
			ORDER BY id DESC LIMIT 500
		`)
	} else {
		rows, err = h.PG.Query(c, `
			SELECT id, name, COALESCE(industry,''), COALESCE(contact_name,''), COALESCE(contact_phone,''), status, created_at
			FROM organizations
			WHERE id=$1 AND status=1
		`, CurrentCompanyID(c))
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	defer rows.Close()
	out := []Company{}
	for rows.Next() {
		var company Company
		if err := rows.Scan(&company.ID, &company.Name, &company.Industry, &company.ContactName, &company.ContactPhone, &company.Status, &company.CreatedAt); err == nil {
			out = append(out, company)
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *ProjectHandler) listMembers(c *gin.Context) {
	projectID := c.Param("id")
	rows, err := h.PG.Query(c, `
		SELECT m.id, m.project_id, m.user_id, u.email, COALESCE(u.name,''), m.role, m.created_at, m.updated_at
		FROM project_members m
		JOIN users u ON u.id=m.user_id
		WHERE m.project_id=$1
		ORDER BY CASE m.role WHEN 'owner' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END, u.email ASC
	`, projectID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	defer rows.Close()
	out := []ProjectMember{}
	for rows.Next() {
		var m ProjectMember
		if err := rows.Scan(&m.ID, &m.ProjectID, &m.UserID, &m.Email, &m.Name, &m.Role, &m.CreatedAt, &m.UpdatedAt); err == nil {
			out = append(out, m)
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *ProjectHandler) addMember(c *gin.Context) {
	projectID, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	var req struct {
		Email string `json:"email"`
		Role  string `json:"role"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	email := normalizeEmail(req.Email)
	role := normalizeRole(req.Role)
	var userID int64
	if err := h.PG.QueryRow(c, `SELECT id FROM users WHERE email=$1 AND status=1`, email).Scan(&userID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"err": "user not found, ask the user to register first"})
		return
	}
	_, err := h.PG.Exec(c, `
		INSERT INTO project_members(project_id, user_id, role)
		VALUES($1,$2,$3)
		ON CONFLICT(project_id, user_id) DO UPDATE SET role=EXCLUDED.role, updated_at=now()
	`, projectID, userID, role)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	h.writeMember(c, projectID, userID)
}

func (h *ProjectHandler) updateMember(c *gin.Context) {
	projectID, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	userID, _ := strconv.ParseInt(c.Param("user_id"), 10, 64)
	var req struct {
		Role string `json:"role"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	role := normalizeRole(req.Role)
	if role != RoleOwner {
		if ok, err := h.canRemoveOwner(c, projectID, userID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
			return
		} else if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"err": "project must keep at least one owner"})
			return
		}
	}
	ct, err := h.PG.Exec(c, `
		UPDATE project_members SET role=$3, updated_at=now()
		WHERE project_id=$1 AND user_id=$2
	`, projectID, userID, role)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	if ct.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"err": "member not found"})
		return
	}
	h.writeMember(c, projectID, userID)
}

func (h *ProjectHandler) deleteMember(c *gin.Context) {
	projectID, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	userID, _ := strconv.ParseInt(c.Param("user_id"), 10, 64)
	if ok, err := h.canRemoveOwner(c, projectID, userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	} else if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"err": "project must keep at least one owner"})
		return
	}
	ct, err := h.PG.Exec(c, `DELETE FROM project_members WHERE project_id=$1 AND user_id=$2`, projectID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	if ct.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"err": "member not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"deleted": true}})
}

func (h *ProjectHandler) writeMember(c *gin.Context, projectID, userID int64) {
	var m ProjectMember
	err := h.PG.QueryRow(c, `
		SELECT m.id, m.project_id, m.user_id, u.email, COALESCE(u.name,''), m.role, m.created_at, m.updated_at
		FROM project_members m
		JOIN users u ON u.id=m.user_id
		WHERE m.project_id=$1 AND m.user_id=$2
	`, projectID, userID).Scan(&m.ID, &m.ProjectID, &m.UserID, &m.Email, &m.Name, &m.Role, &m.CreatedAt, &m.UpdatedAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": m})
}

func (h *ProjectHandler) canRemoveOwner(c *gin.Context, projectID, userID int64) (bool, error) {
	var role string
	err := h.PG.QueryRow(c, `
		SELECT role FROM project_members WHERE project_id=$1 AND user_id=$2
	`, projectID, userID).Scan(&role)
	if err == pgx.ErrNoRows {
		return true, nil
	}
	if err != nil {
		return false, err
	}
	if role != RoleOwner {
		return true, nil
	}
	var ownerCount int64
	if err := h.PG.QueryRow(c, `
		SELECT count(*) FROM project_members WHERE project_id=$1 AND role='owner'
	`, projectID).Scan(&ownerCount); err != nil {
		return false, err
	}
	return ownerCount > 1, nil
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

func normalizeAppType(appType string) string {
	switch appType {
	case "android", "ios", "web", "mini_program", "server", "other":
		return appType
	default:
		return "web"
	}
}

func requiresPackageName(appType string) bool {
	return appType == "android" || appType == "ios"
}

func normalizeProjectStatus(status int16) (int16, bool) {
	switch status {
	case ProjectStatusDisabled, ProjectStatusEnabled, ProjectStatusFrozen, ProjectStatusOffline:
		return status, true
	default:
		return ProjectStatusDisabled, false
	}
}
