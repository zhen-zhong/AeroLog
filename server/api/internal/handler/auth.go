package handler

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	RoleViewer = "viewer"
	RoleEditor = "editor"
	RoleOwner  = "owner"

	UserRolePlatformAdmin  = "admin"
	UserRolePlatformMember = "platform_member"
	UserRoleCompanyAdmin   = "company_admin"
	UserRoleMember         = "member"

	authUserIDKey    = "auth_user_id"
	authUserEmailKey = "auth_user_email"
	authUserNameKey  = "auth_user_name"
	authCompanyIDKey = "auth_company_id"
	authUserRoleKey  = "auth_user_role"
	projectRoleKey   = "auth_project_role"
)

const (
	defaultAdminEmail    = "admin@aerolog.local"
	defaultAdminName     = "AeroLog Admin"
	defaultAdminPassword = "aerolog123"
	sessionTTL           = 7 * 24 * time.Hour
	passwordIterations   = 120000
)

// AuthUser 是控制台登录用户。
type AuthUser struct {
	ID          int64     `json:"id"`
	Email       string    `json:"email"`
	Name        string    `json:"name"`
	Phone       string    `json:"phone"`
	JobTitle    string    `json:"job_title"`
	CompanyID   int64     `json:"company_id"`
	CompanyName string    `json:"company_name"`
	Role        string    `json:"role"`
	Status      int16     `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
}

// AuthHandler 提供真实登录、注册、会话查询和退出。
type AuthHandler struct {
	PG *pgxpool.Pool
}

func (h *AuthHandler) RegisterPublic(r *gin.RouterGroup) {
	r.POST("/auth/login", h.login)
	r.POST("/auth/register", h.register)
}

func (h *AuthHandler) RegisterPrivate(r *gin.RouterGroup) {
	r.GET("/auth/me", h.me)
	r.POST("/auth/logout", h.logout)
	r.GET("/members", h.listMemberAccounts)
	r.POST("/members", h.createMemberAccount)
	r.PATCH("/members/:id", h.updateMemberAccount)
	r.GET("/members/:id/projects", h.listMemberProjects)
	r.PUT("/members/:id/projects", h.updateMemberProjects)
}

// MemberProjectGrant 描述某成员在单个项目中的角色。
type MemberProjectGrant struct {
	ProjectID   int64  `json:"project_id"`
	ProjectName string `json:"project_name"`
	Role        string `json:"role"`
}

type MemberAccount struct {
	ID             int64     `json:"id"`
	Email          string    `json:"email"`
	Name           string    `json:"name"`
	Phone          string    `json:"phone"`
	JobTitle       string    `json:"job_title"`
	Role           string    `json:"role"`
	CompanyID      int64     `json:"company_id"`
	CompanyName    string    `json:"company_name"`
	ProjectCount   int64     `json:"project_count"`
	ProjectNames   string    `json:"project_names"`
	IsCompanyAdmin bool      `json:"is_company_admin"`
	Status         int16     `json:"status"`
	CreatedAt      time.Time `json:"created_at"`
}

func (h *AuthHandler) login(c *gin.Context) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	user, hash, err := h.findUserForLogin(c, req.Email)
	if err != nil || !verifyPassword(req.Password, hash) {
		c.JSON(http.StatusUnauthorized, gin.H{"err": "email or password is invalid"})
		return
	}
	token, err := h.createSession(c, user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"token": token, "user": user}})
}

func (h *AuthHandler) register(c *gin.Context) {
	var req struct {
		Email           string `json:"email"`
		Name            string `json:"name"`
		Password        string `json:"password"`
		Phone           string `json:"phone"`
		JobTitle        string `json:"job_title"`
		CompanyName     string `json:"company_name"`
		CompanyIndustry string `json:"company_industry"`
		CompanyPhone    string `json:"company_phone"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	email := normalizeEmail(req.Email)
	if email == "" || !strings.Contains(email, "@") {
		c.JSON(http.StatusBadRequest, gin.H{"err": "valid email is required"})
		return
	}
	if len(req.Password) < 8 {
		c.JSON(http.StatusBadRequest, gin.H{"err": "password must be at least 8 characters"})
		return
	}
	companyName := strings.TrimSpace(req.CompanyName)
	if companyName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"err": "company_name is required"})
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = email
	}
	hash, err := hashPassword(req.Password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	tx, err := h.PG.BeginTx(c, pgx.TxOptions{})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	defer func() { _ = tx.Rollback(c) }()

	var companyID int64
	if err := tx.QueryRow(c, `
		INSERT INTO organizations(name, industry, contact_name, contact_phone)
		VALUES($1,$2,$3,$4)
		RETURNING id
	`, companyName, strings.TrimSpace(req.CompanyIndustry), name, strings.TrimSpace(req.CompanyPhone)).Scan(&companyID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}

	var user AuthUser
	err = tx.QueryRow(c, `
		INSERT INTO users(email, name, password_hash, company_id, phone, job_title, role)
		VALUES($1,$2,$3,$4,$5,$6,$7)
		RETURNING id, email, COALESCE(name,''), COALESCE(phone,''), COALESCE(job_title,''), COALESCE(company_id,0), COALESCE(role,'member'), status, created_at
	`, email, name, hash, companyID, strings.TrimSpace(req.Phone), strings.TrimSpace(req.JobTitle), UserRoleCompanyAdmin).
		Scan(&user.ID, &user.Email, &user.Name, &user.Phone, &user.JobTitle, &user.CompanyID, &user.Role, &user.Status, &user.CreatedAt)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"err": "email already exists"})
		return
	}
	user.CompanyName = companyName
	if err := tx.Commit(c); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	token, err := h.createSession(c, user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"token": token, "user": user}})
}

func (h *AuthHandler) me(c *gin.Context) {
	userID := CurrentUserID(c)
	var user AuthUser
	err := h.PG.QueryRow(c, `
		SELECT u.id, u.email, COALESCE(u.name,''), COALESCE(u.phone,''), COALESCE(u.job_title,''),
		       COALESCE(u.company_id,0), COALESCE(o.name,''), COALESCE(u.role,'member'), u.status, u.created_at
		FROM users u
		LEFT JOIN organizations o ON o.id=u.company_id
		WHERE u.id=$1 AND u.status=1
	`, userID).Scan(&user.ID, &user.Email, &user.Name, &user.Phone, &user.JobTitle, &user.CompanyID, &user.CompanyName, &user.Role, &user.Status, &user.CreatedAt)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"err": "unauthorized"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": user})
}

func (h *AuthHandler) logout(c *gin.Context) {
	token := bearerToken(c.GetHeader("Authorization"))
	if token != "" {
		_, _ = h.PG.Exec(c, `DELETE FROM auth_sessions WHERE token_hash=$1`, hashToken(token))
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"ok": true}})
}

func (h *AuthHandler) listMemberAccounts(c *gin.Context) {
	if !CanManageCompany(c) {
		c.JSON(http.StatusForbidden, gin.H{"err": "需要企业管理员或平台管理员权限"})
		return
	}
	var rows pgx.Rows
	var err error
	if IsPlatformAdmin(c) {
		rows, err = h.PG.Query(c, `
			SELECT u.id, u.email, COALESCE(u.name,''), COALESCE(u.phone,''), COALESCE(u.job_title,''),
			       COALESCE(u.role,'member'), COALESCE(u.company_id,0), COALESCE(o.name,''),
			       COALESCE(g.cnt, 0),
			       COALESCE(g.names, ''),
			       COALESCE(u.role,'member')='company_admin',
			       u.status, u.created_at
			FROM users u
			LEFT JOIN organizations o ON o.id=u.company_id
			LEFT JOIN (
				SELECT pm.user_id,
				       count(DISTINCT pm.project_id) AS cnt,
			       string_agg(DISTINCT p.name, ', ' ORDER BY p.name) AS names
				FROM project_members pm
				JOIN projects p ON p.id=pm.project_id
				GROUP BY pm.user_id
			) g ON g.user_id=u.id
			ORDER BY u.id DESC LIMIT 500
		`)
	} else {
		rows, err = h.PG.Query(c, `
			SELECT u.id, u.email, COALESCE(u.name,''), COALESCE(u.phone,''), COALESCE(u.job_title,''),
			       COALESCE(u.role,'member'), COALESCE(u.company_id,0), COALESCE(o.name,''),
			       COALESCE(g.cnt, 0),
			       COALESCE(g.names, ''),
			       COALESCE(u.role,'member')='company_admin',
			       u.status, u.created_at
			FROM users u
			LEFT JOIN organizations o ON o.id=u.company_id
			LEFT JOIN (
				SELECT pm.user_id,
				       count(DISTINCT pm.project_id) AS cnt,
			       string_agg(DISTINCT p.name, ', ' ORDER BY p.name) AS names
				FROM project_members pm
				JOIN projects p ON p.id=pm.project_id
				GROUP BY pm.user_id
			) g ON g.user_id=u.id
			WHERE u.company_id=$1
			ORDER BY u.id DESC LIMIT 500
		`, CurrentCompanyID(c))
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	defer rows.Close()
	out := []MemberAccount{}
	for rows.Next() {
		var item MemberAccount
		if err := rows.Scan(&item.ID, &item.Email, &item.Name, &item.Phone, &item.JobTitle, &item.Role, &item.CompanyID, &item.CompanyName, &item.ProjectCount, &item.ProjectNames, &item.IsCompanyAdmin, &item.Status, &item.CreatedAt); err == nil {
			out = append(out, item)
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *AuthHandler) createMemberAccount(c *gin.Context) {
	if !CanManageCompany(c) {
		c.JSON(http.StatusForbidden, gin.H{"err": "需要企业管理员或平台管理员权限"})
		return
	}
	var req struct {
		AccountType     string  `json:"account_type"`
		Email           string  `json:"email"`
		Name            string  `json:"name"`
		Password        string  `json:"password"`
		Phone           string  `json:"phone"`
		JobTitle        string  `json:"job_title"`
		CompanyID       int64   `json:"company_id"`
		CompanyName     string  `json:"company_name"`
		CompanyIndustry string  `json:"company_industry"`
		CompanyPhone    string  `json:"company_phone"`
		ProjectIDs      []int64 `json:"project_ids"`
		ProjectRole     string  `json:"project_role"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	email := normalizeEmail(req.Email)
	if email == "" || !strings.Contains(email, "@") {
		c.JSON(http.StatusBadRequest, gin.H{"err": "valid email is required"})
		return
	}
	if len(req.Password) < 8 {
		c.JSON(http.StatusBadRequest, gin.H{"err": "password must be at least 8 characters"})
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = email
	}
	accountType := strings.ToLower(strings.TrimSpace(req.AccountType))
	if accountType == "" {
		accountType = "enterprise_member"
	}
	// 兼容已发布客户端的旧枚举值。
	if accountType == "internal" {
		accountType = "platform_member"
	}
	if accountType == "company" {
		accountType = "enterprise_member"
	}
	userRole := UserRoleMember
	companyID := CurrentCompanyID(c)
	enforceProjectCompany := true
	if IsPlatformAdmin(c) {
		switch accountType {
		case "platform_admin":
			userRole = UserRolePlatformAdmin
			enforceProjectCompany = false
			companyID = 0
		case "platform_member":
			userRole = UserRolePlatformMember
			enforceProjectCompany = false
			companyID = 0
		case "enterprise_admin":
			userRole = UserRoleCompanyAdmin
			companyID = req.CompanyID
		case "enterprise_member":
			companyID = 0
			if req.CompanyID > 0 {
				companyID = req.CompanyID
			}
		default:
			c.JSON(http.StatusBadRequest, gin.H{"err": "账号类型无效"})
			return
		}
	} else {
		accountType = "enterprise_member"
	}
	if IsPlatformAdmin(c) && (accountType == "enterprise_admin" || accountType == "enterprise_member") && companyID == 0 {
		companyName := strings.TrimSpace(req.CompanyName)
		if accountType != "enterprise_admin" || companyName == "" {
			c.JSON(http.StatusBadRequest, gin.H{"err": "请选择所属企业；新建企业时请创建企业管理员"})
			return
		}
	}
	hash, err := hashPassword(req.Password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	tx, err := h.PG.BeginTx(c, pgx.TxOptions{})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	defer func() { _ = tx.Rollback(c) }()
	if IsPlatformAdmin(c) && accountType == "enterprise_admin" && companyID == 0 {
		companyName := strings.TrimSpace(req.CompanyName)
		if companyName == "" {
			c.JSON(http.StatusBadRequest, gin.H{"err": "company_name is required"})
			return
		}
		if err := tx.QueryRow(c, `
			INSERT INTO organizations(name, industry, contact_name, contact_phone)
			VALUES($1,$2,$3,$4)
			RETURNING id
		`, companyName, strings.TrimSpace(req.CompanyIndustry), name, strings.TrimSpace(req.CompanyPhone)).Scan(&companyID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
			return
		}
	}
	var userID int64
	if err := tx.QueryRow(c, `
		INSERT INTO users(email, name, password_hash, company_id, phone, job_title, role)
		VALUES($1,$2,$3,$4,$5,$6,$7)
		RETURNING id
	`, email, name, hash, companyID, strings.TrimSpace(req.Phone), strings.TrimSpace(req.JobTitle), userRole).Scan(&userID); err != nil {
		c.JSON(http.StatusConflict, gin.H{"err": "email already exists"})
		return
	}
	projectRole := normalizeRole(req.ProjectRole)
	for _, projectID := range uniqueInt64(req.ProjectIDs) {
		if err := h.canAssignProject(c, tx, projectID, companyID, enforceProjectCompany); err != nil {
			c.JSON(http.StatusForbidden, gin.H{"err": err.Error()})
			return
		}
		if _, err := tx.Exec(c, `
			INSERT INTO project_members(project_id, user_id, role)
			VALUES($1,$2,$3)
			ON CONFLICT(project_id, user_id) DO UPDATE SET role=EXCLUDED.role, updated_at=now()
		`, projectID, userID, projectRole); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
			return
		}
	}
	if err := tx.Commit(c); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"id": userID, "email": email, "company_id": companyID, "role": userRole}})
}

func (h *AuthHandler) updateMemberAccount(c *gin.Context) {
	if !CanManageCompany(c) {
		c.JSON(http.StatusForbidden, gin.H{"err": "需要企业管理员或平台管理员权限"})
		return
	}
	userID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || userID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"err": "user id is invalid"})
		return
	}
	if userID == CurrentUserID(c) {
		c.JSON(http.StatusForbidden, gin.H{"err": "不能编辑自己的账号"})
		return
	}
	var req struct {
		Name   *string `json:"name"`
		Email  *string `json:"email"`
		Status *int16  `json:"status"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	var targetCompanyID int64
	var targetRole string
	var targetStatus int16
	if err := h.PG.QueryRow(c, `
		SELECT COALESCE(company_id,0), COALESCE(role,'member'), status
		FROM users WHERE id=$1
	`, userID).Scan(&targetCompanyID, &targetRole, &targetStatus); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"err": "user not found"})
		return
	}
	_ = targetStatus
	if targetRole == UserRolePlatformAdmin && !IsPlatformAdmin(c) {
		c.JSON(http.StatusForbidden, gin.H{"err": "平台管理员账号仅平台管理员可编辑"})
		return
	}
	if !IsPlatformAdmin(c) {
		if targetCompanyID != CurrentCompanyID(c) {
			c.JSON(http.StatusForbidden, gin.H{"err": "只能编辑同公司成员"})
			return
		}
		if targetRole == UserRoleCompanyAdmin {
			c.JSON(http.StatusForbidden, gin.H{"err": "企业管理员账号仅平台管理员可编辑"})
			return
		}
	}
	fields := []string{}
	args := []any{}
	idx := 1
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if name == "" {
			c.JSON(http.StatusBadRequest, gin.H{"err": "姓名不能为空"})
			return
		}
		fields = append(fields, fmt.Sprintf("name=$%d", idx))
		args = append(args, name)
		idx++
	}
	if req.Email != nil {
		email := normalizeEmail(*req.Email)
		if email == "" || !strings.Contains(email, "@") {
			c.JSON(http.StatusBadRequest, gin.H{"err": "邮箱格式无效"})
			return
		}
		fields = append(fields, fmt.Sprintf("email=$%d", idx))
		args = append(args, email)
		idx++
	}
	if req.Status != nil {
		s := int16(0)
		if *req.Status == 1 {
			s = 1
		}
		fields = append(fields, fmt.Sprintf("status=$%d", idx))
		args = append(args, s)
		idx++
	}
	if len(fields) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"err": "无可更新字段"})
		return
	}
	args = append(args, userID)
	sql := fmt.Sprintf("UPDATE users SET %s, updated_at=now() WHERE id=$%d", strings.Join(fields, ", "), idx)
	if _, err := h.PG.Exec(c, sql, args...); err != nil {
		msg := err.Error()
		if strings.Contains(msg, "users_email") || strings.Contains(strings.ToLower(msg), "duplicate") {
			c.JSON(http.StatusConflict, gin.H{"err": "邮箱已存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"err": msg})
		return
	}
	if req.Status != nil && *req.Status == 0 {
		_, _ = h.PG.Exec(c, `DELETE FROM auth_sessions WHERE user_id=$1`, userID)
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"id": userID}})
}

func (h *AuthHandler) listMemberProjects(c *gin.Context) {
	if !CanManageCompany(c) {
		c.JSON(http.StatusForbidden, gin.H{"err": "需要企业管理员或平台管理员权限"})
		return
	}
	userID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || userID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"err": "user id is invalid"})
		return
	}
	if err := h.ensureMemberVisible(c, userID); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"err": err.Error()})
		return
	}
	rows, err := h.PG.Query(c, `
		SELECT pm.project_id, COALESCE(p.name,''), pm.role
		FROM project_members pm
		LEFT JOIN projects p ON p.id=pm.project_id
		WHERE pm.user_id=$1
		ORDER BY pm.project_id
	`, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	defer rows.Close()
	out := []MemberProjectGrant{}
	for rows.Next() {
		var g MemberProjectGrant
		if err := rows.Scan(&g.ProjectID, &g.ProjectName, &g.Role); err == nil {
			out = append(out, g)
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *AuthHandler) updateMemberProjects(c *gin.Context) {
	if !CanManageCompany(c) {
		c.JSON(http.StatusForbidden, gin.H{"err": "需要企业管理员或平台管理员权限"})
		return
	}
	userID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || userID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"err": "user id is invalid"})
		return
	}
	var req struct {
		Projects []struct {
			ProjectID int64  `json:"project_id"`
			Role      string `json:"role"`
		} `json:"projects"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	var targetCompanyID int64
	var targetRole string
	if err := h.PG.QueryRow(c, `
		SELECT COALESCE(company_id,0), COALESCE(role,'member')
		FROM users WHERE id=$1 AND status=1
	`, userID).Scan(&targetCompanyID, &targetRole); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"err": "user not found"})
		return
	}
	if targetRole == UserRolePlatformAdmin {
		c.JSON(http.StatusForbidden, gin.H{"err": "平台管理员的项目授权不在这里维护"})
		return
	}
	enforceCompany := !IsPlatformAdmin(c)
	if enforceCompany && targetCompanyID != CurrentCompanyID(c) {
		c.JSON(http.StatusForbidden, gin.H{"err": "只能维护同公司成员的项目授权"})
		return
	}
	desired := map[int64]string{}
	for _, g := range req.Projects {
		if g.ProjectID > 0 {
			desired[g.ProjectID] = normalizeRole(g.Role)
		}
	}
	tx, err := h.PG.BeginTx(c, pgx.TxOptions{})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	defer func() { _ = tx.Rollback(c) }()

	rows, err := tx.Query(c, `SELECT project_id, role FROM project_members WHERE user_id=$1`, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	current := map[int64]string{}
	for rows.Next() {
		var pid int64
		var role string
		if err := rows.Scan(&pid, &role); err == nil {
			current[pid] = role
		}
	}
	rows.Close()

	canDowngradeOwner := func(pid int64) error {
		var cnt int64
		if err := tx.QueryRow(c, `
			SELECT count(*) FROM project_members
			WHERE project_id=$1 AND role='owner' AND user_id<>$2
		`, pid, userID).Scan(&cnt); err != nil {
			return err
		}
		if cnt == 0 {
			return fmt.Errorf("project %d must keep at least one owner", pid)
		}
		return nil
	}

	for pid, role := range desired {
		existing, exists := current[pid]
		if exists && existing == role {
			continue
		}
		if err := h.canAssignProject(c, tx, pid, targetCompanyID, enforceCompany); err != nil {
			c.JSON(http.StatusForbidden, gin.H{"err": err.Error()})
			return
		}
		if exists && existing == RoleOwner && role != RoleOwner {
			if err := canDowngradeOwner(pid); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
				return
			}
		}
		if _, err := tx.Exec(c, `
			INSERT INTO project_members(project_id, user_id, role)
			VALUES($1,$2,$3)
			ON CONFLICT(project_id, user_id) DO UPDATE SET role=EXCLUDED.role, updated_at=now()
		`, pid, userID, role); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
			return
		}
	}

	for pid, existing := range current {
		if _, ok := desired[pid]; ok {
			continue
		}
		if err := h.canAssignProject(c, tx, pid, targetCompanyID, enforceCompany); err != nil {
			c.JSON(http.StatusForbidden, gin.H{"err": err.Error()})
			return
		}
		if existing == RoleOwner {
			if err := canDowngradeOwner(pid); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
				return
			}
		}
		if _, err := tx.Exec(c, `DELETE FROM project_members WHERE project_id=$1 AND user_id=$2`, pid, userID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
			return
		}
	}

	if err := tx.Commit(c); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}

	rows2, err := h.PG.Query(c, `
		SELECT pm.project_id, COALESCE(p.name,''), pm.role
		FROM project_members pm
		LEFT JOIN projects p ON p.id=pm.project_id
		WHERE pm.user_id=$1
		ORDER BY pm.project_id
	`, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	defer rows2.Close()
	out := []MemberProjectGrant{}
	for rows2.Next() {
		var g MemberProjectGrant
		if err := rows2.Scan(&g.ProjectID, &g.ProjectName, &g.Role); err == nil {
			out = append(out, g)
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// ensureMemberVisible 检查当前用户是否有权查看该成员的信息。
func (h *AuthHandler) ensureMemberVisible(c *gin.Context, userID int64) error {
	if IsPlatformAdmin(c) {
		return nil
	}
	var companyID int64
	if err := h.PG.QueryRow(c, `SELECT COALESCE(company_id,0) FROM users WHERE id=$1`, userID).Scan(&companyID); err != nil {
		return fmt.Errorf("user not found")
	}
	if companyID != CurrentCompanyID(c) {
		return fmt.Errorf("只能查看同公司成员")
	}
	return nil
}

func (h *AuthHandler) canAssignProject(c *gin.Context, tx pgx.Tx, projectID, targetCompanyID int64, enforceCompany bool) error {
	var companyID int64
	if err := tx.QueryRow(c, `SELECT COALESCE(company_id,0) FROM projects WHERE id=$1`, projectID).Scan(&companyID); err != nil {
		return fmt.Errorf("project %d not found", projectID)
	}
	if enforceCompany && companyID != targetCompanyID {
		return fmt.Errorf("project %d does not belong to target company", projectID)
	}
	if !CanManageCompany(c) {
		return fmt.Errorf("enterprise admin permission required")
	}
	return nil
}

func (h *AuthHandler) findUserForLogin(ctx context.Context, email string) (AuthUser, string, error) {
	var user AuthUser
	var hash string
	err := h.PG.QueryRow(ctx, `
		SELECT u.id, u.email, COALESCE(u.name,''), COALESCE(u.phone,''), COALESCE(u.job_title,''),
		       COALESCE(u.company_id,0), COALESCE(o.name,''), COALESCE(u.role,'member'), u.status, u.created_at, u.password_hash
		FROM users u
		LEFT JOIN organizations o ON o.id=u.company_id
		WHERE u.email=$1 AND u.status=1
	`, normalizeEmail(email)).Scan(&user.ID, &user.Email, &user.Name, &user.Phone, &user.JobTitle, &user.CompanyID, &user.CompanyName, &user.Role, &user.Status, &user.CreatedAt, &hash)
	return user, hash, err
}

func (h *AuthHandler) createSession(ctx context.Context, userID int64) (string, error) {
	raw, err := randomBase64URL(32)
	if err != nil {
		return "", err
	}
	_, err = h.PG.Exec(ctx, `
		INSERT INTO auth_sessions(user_id, token_hash, expires_at)
		VALUES($1,$2,$3)
	`, userID, hashToken(raw), time.Now().Add(sessionTTL))
	return raw, err
}

// AuthRequired 校验 Bearer token，并把用户信息写入 gin.Context。
func AuthRequired(pg *pgxpool.Pool) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := bearerToken(c.GetHeader("Authorization"))
		if token == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"err": "unauthorized"})
			return
		}
		var user AuthUser
		err := pg.QueryRow(c, `
			SELECT u.id, u.email, COALESCE(u.name,''), COALESCE(u.phone,''), COALESCE(u.job_title,''),
			       COALESCE(u.company_id,0), COALESCE(o.name,''), COALESCE(u.role,'member'), u.status, u.created_at
			FROM auth_sessions s
			JOIN users u ON u.id=s.user_id
			LEFT JOIN organizations o ON o.id=u.company_id
			WHERE s.token_hash=$1 AND s.expires_at > now() AND u.status=1
		`, hashToken(token)).Scan(&user.ID, &user.Email, &user.Name, &user.Phone, &user.JobTitle, &user.CompanyID, &user.CompanyName, &user.Role, &user.Status, &user.CreatedAt)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"err": "unauthorized"})
			return
		}
		_, _ = pg.Exec(c, `UPDATE auth_sessions SET last_seen_at=now() WHERE token_hash=$1`, hashToken(token))
		c.Set(authUserIDKey, user.ID)
		c.Set(authUserEmailKey, user.Email)
		c.Set(authUserNameKey, user.Name)
		c.Set(authCompanyIDKey, user.CompanyID)
		c.Set(authUserRoleKey, user.Role)
		c.Next()
	}
}

// ProjectAccessRequired 按请求方法校验项目权限：GET 需要 viewer，其它写操作需要 editor。
func ProjectAccessRequired(pg *pgxpool.Pool) gin.HandlerFunc {
	return func(c *gin.Context) {
		required := RoleViewer
		if c.Request.Method != http.MethodGet {
			required = RoleEditor
		}
		requireProjectRole(c, pg, required)
	}
}

func ProjectRoleRequired(pg *pgxpool.Pool, role string) gin.HandlerFunc {
	return func(c *gin.Context) {
		requireProjectRole(c, pg, role)
	}
}

func requireProjectRole(c *gin.Context, pg *pgxpool.Pool, required string) {
	pid, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || pid <= 0 {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"err": "project id is invalid"})
		return
	}
	if IsPlatformAdmin(c) {
		c.Set(projectRoleKey, RoleOwner)
		c.Next()
		return
	}
	if IsCompanyAdmin(c) {
		var companyID int64
		if err := pg.QueryRow(c, `SELECT COALESCE(company_id,0) FROM projects WHERE id=$1`, pid).Scan(&companyID); err != nil || companyID != CurrentCompanyID(c) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"err": "project permission denied"})
			return
		}
		c.Set(projectRoleKey, RoleOwner)
		c.Next()
		return
	}
	role, err := projectRole(c, pg, pid, CurrentUserID(c))
	if err != nil || !roleAllows(role, required) {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"err": "project permission denied"})
		return
	}
	c.Set(projectRoleKey, role)
	c.Next()
}

func CurrentUserID(c *gin.Context) int64 {
	v, ok := c.Get(authUserIDKey)
	if !ok {
		return 0
	}
	id, _ := v.(int64)
	return id
}

func CurrentUserEmail(c *gin.Context) string {
	v, _ := c.Get(authUserEmailKey)
	s, _ := v.(string)
	return s
}

func CurrentCompanyID(c *gin.Context) int64 {
	v, ok := c.Get(authCompanyIDKey)
	if !ok {
		return 0
	}
	id, _ := v.(int64)
	return id
}

func CurrentUserRole(c *gin.Context) string {
	v, _ := c.Get(authUserRoleKey)
	s, _ := v.(string)
	if s == "" {
		return "member"
	}
	return s
}

func IsPlatformAdmin(c *gin.Context) bool {
	return CurrentUserRole(c) == UserRolePlatformAdmin
}

// IsCompanyAdmin reports whether the current account manages all projects and
// members in its own organization.
func IsCompanyAdmin(c *gin.Context) bool {
	return CurrentUserRole(c) == UserRoleCompanyAdmin
}

// CanManageCompany is deliberately role-based. Project ownership grants
// authority inside one project only; it must never become company-wide access.
func CanManageCompany(c *gin.Context) bool {
	return IsPlatformAdmin(c) || IsCompanyAdmin(c)
}

func CurrentProjectRole(c *gin.Context) string {
	v, _ := c.Get(projectRoleKey)
	s, _ := v.(string)
	return s
}

func projectRole(ctx context.Context, pg *pgxpool.Pool, projectID, userID int64) (string, error) {
	var role string
	err := pg.QueryRow(ctx, `
		SELECT role FROM project_members
		WHERE project_id=$1 AND user_id=$2
	`, projectID, userID).Scan(&role)
	return role, err
}

func roleAllows(actual, required string) bool {
	return roleRank(actual) >= roleRank(required)
}

func roleRank(role string) int {
	switch role {
	case RoleOwner:
		return 3
	case RoleEditor:
		return 2
	case RoleViewer:
		return 1
	default:
		return 0
	}
}

func normalizeRole(role string) string {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case RoleOwner:
		return RoleOwner
	case RoleEditor:
		return RoleEditor
	default:
		return RoleViewer
	}
}

func uniqueInt64(items []int64) []int64 {
	seen := make(map[int64]struct{}, len(items))
	out := make([]int64, 0, len(items))
	for _, item := range items {
		if item <= 0 {
			continue
		}
		if _, ok := seen[item]; ok {
			continue
		}
		seen[item] = struct{}{}
		out = append(out, item)
	}
	return out
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func bearerToken(header string) string {
	parts := strings.Fields(header)
	if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
		return parts[1]
	}
	return ""
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := pbkdf2SHA256([]byte(password), salt, passwordIterations, 32)
	return fmt.Sprintf("pbkdf2_sha256$%d$%s$%s",
		passwordIterations,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	), nil
}

func verifyPassword(password, encoded string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2_sha256" {
		return false
	}
	iter, err := strconv.Atoi(parts[1])
	if err != nil || iter <= 0 {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[2])
	if err != nil {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[3])
	if err != nil {
		return false
	}
	got := pbkdf2SHA256([]byte(password), salt, iter, len(want))
	return hmac.Equal(got, want)
}

func pbkdf2SHA256(password, salt []byte, iter, keyLen int) []byte {
	hLen := 32
	numBlocks := (keyLen + hLen - 1) / hLen
	out := make([]byte, 0, numBlocks*hLen)
	for block := 1; block <= numBlocks; block++ {
		mac := hmac.New(sha256.New, password)
		mac.Write(salt)
		mac.Write([]byte{byte(block >> 24), byte(block >> 16), byte(block >> 8), byte(block)})
		u := mac.Sum(nil)
		t := append([]byte(nil), u...)
		for i := 1; i < iter; i++ {
			mac = hmac.New(sha256.New, password)
			mac.Write(u)
			u = mac.Sum(nil)
			for j := range t {
				t[j] ^= u[j]
			}
		}
		out = append(out, t...)
	}
	return out[:keyLen]
}

func randomBase64URL(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// EnsureDefaultAuth creates bootstrap platform-admin accounts and makes the
// primary account owner of orphan projects. AEROLOG_BOOTSTRAP_ADMIN_EMAILS and
// AEROLOG_BOOTSTRAP_ADMIN_PASSWORD are intended for first production startup;
// leaving them unset preserves the local development defaults.
func EnsureDefaultAuth(ctx context.Context, pg *pgxpool.Pool) error {
	if pg == nil {
		return nil
	}
	adminEmails := bootstrapAdminEmails()
	adminPassword := bootstrapAdminPassword()
	resetExistingPassword := strings.TrimSpace(os.Getenv("AEROLOG_BOOTSTRAP_ADMIN_EMAILS")) == ""
	var companyID int64
	err := pg.QueryRow(ctx, `SELECT id FROM organizations WHERE name=$1 ORDER BY id LIMIT 1`, "AeroLog Local").Scan(&companyID)
	if errors.Is(err, pgx.ErrNoRows) {
		if err := pg.QueryRow(ctx, `
			INSERT INTO organizations(name, industry, contact_name)
			VALUES($1,$2,$3)
			RETURNING id
		`, "AeroLog Local", "analytics", defaultAdminName).Scan(&companyID); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}

	var primaryAdminID int64
	for i, email := range adminEmails {
		adminID, err := ensureBootstrapAdmin(ctx, pg, email, adminPassword, companyID, resetExistingPassword)
		if err != nil {
			return err
		}
		if i == 0 {
			primaryAdminID = adminID
		}
	}
	if _, err := pg.Exec(ctx, `
		UPDATE projects SET company_id=$1 WHERE company_id IS NULL
	`, companyID); err != nil {
		return err
	}
	_, err = pg.Exec(ctx, `
		INSERT INTO project_members(project_id, user_id, role)
		SELECT p.id, $1, 'owner'
		FROM projects p
		WHERE NOT EXISTS (
			SELECT 1 FROM project_members m WHERE m.project_id=p.id
		)
		ON CONFLICT (project_id, user_id) DO NOTHING
	`, primaryAdminID)
	return err
}

func bootstrapAdminEmails() []string {
	raw := strings.TrimSpace(os.Getenv("AEROLOG_BOOTSTRAP_ADMIN_EMAILS"))
	if raw == "" {
		return []string{defaultAdminEmail}
	}
	seen := make(map[string]struct{})
	emails := make([]string, 0, 2)
	for _, candidate := range strings.Split(raw, ",") {
		email := normalizeEmail(candidate)
		if email == "" || !strings.Contains(email, "@") {
			continue
		}
		if _, ok := seen[email]; ok {
			continue
		}
		seen[email] = struct{}{}
		emails = append(emails, email)
	}
	if len(emails) == 0 {
		return []string{defaultAdminEmail}
	}
	return emails
}

func bootstrapAdminPassword() string {
	if password := strings.TrimSpace(os.Getenv("AEROLOG_BOOTSTRAP_ADMIN_PASSWORD")); password != "" {
		return password
	}
	return defaultAdminPassword
}

func ensureBootstrapAdmin(ctx context.Context, pg *pgxpool.Pool, email, password string, companyID int64, resetExistingPassword bool) (int64, error) {
	var adminID int64
	err := pg.QueryRow(ctx, `SELECT id FROM users WHERE email=$1 LIMIT 1`, email).Scan(&adminID)
	if errors.Is(err, pgx.ErrNoRows) {
		hash, err := hashPassword(password)
		if err != nil {
			return 0, err
		}
		err = pg.QueryRow(ctx, `
			INSERT INTO users(email, name, password_hash, company_id, role, status)
			VALUES($1,$2,$3,$4,'admin',1)
			RETURNING id
		`, email, defaultAdminName, hash, companyID).Scan(&adminID)
		return adminID, err
	}
	if err != nil {
		return 0, err
	}
	if resetExistingPassword {
		hash, err := hashPassword(password)
		if err != nil {
			return 0, err
		}
		_, err = pg.Exec(ctx, `
			UPDATE users
			SET name=COALESCE(NULLIF(name,''), $2), password_hash=$3, company_id=COALESCE(company_id,$4), role='admin', status=1, updated_at=now()
			WHERE id=$1
		`, adminID, defaultAdminName, hash, companyID)
		return adminID, err
	}
	_, err = pg.Exec(ctx, `
		UPDATE users
		SET name=COALESCE(NULLIF(name,''), $2), company_id=COALESCE(company_id,$3), role='admin', status=1, updated_at=now()
		WHERE id=$1
	`, adminID, defaultAdminName, companyID)
	return adminID, err
}
