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
}

type MemberAccount struct {
	ID           int64     `json:"id"`
	Email        string    `json:"email"`
	Name         string    `json:"name"`
	Phone        string    `json:"phone"`
	JobTitle     string    `json:"job_title"`
	Role         string    `json:"role"`
	CompanyID    int64     `json:"company_id"`
	CompanyName  string    `json:"company_name"`
	ProjectCount int64     `json:"project_count"`
	ProjectNames string    `json:"project_names"`
	Status       int16     `json:"status"`
	CreatedAt    time.Time `json:"created_at"`
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
		INSERT INTO users(email, name, password_hash, company_id, phone, job_title)
		VALUES($1,$2,$3,$4,$5,$6)
		RETURNING id, email, COALESCE(name,''), COALESCE(phone,''), COALESCE(job_title,''), COALESCE(company_id,0), COALESCE(role,'member'), status, created_at
	`, email, name, hash, companyID, strings.TrimSpace(req.Phone), strings.TrimSpace(req.JobTitle)).
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
	var rows pgx.Rows
	var err error
	if IsPlatformAdmin(c) {
		rows, err = h.PG.Query(c, `
			SELECT u.id, u.email, COALESCE(u.name,''), COALESCE(u.phone,''), COALESCE(u.job_title,''),
			       COALESCE(u.role,'member'), COALESCE(u.company_id,0), COALESCE(o.name,''),
			       count(pm.project_id), COALESCE(string_agg(DISTINCT p.name, ', ' ORDER BY p.name), ''),
			       u.status, u.created_at
			FROM users u
			LEFT JOIN organizations o ON o.id=u.company_id
			LEFT JOIN project_members pm ON pm.user_id=u.id
			LEFT JOIN projects p ON p.id=pm.project_id
			WHERE u.status=1
			GROUP BY u.id, o.name
			ORDER BY u.id DESC LIMIT 500
		`)
	} else {
		if ok, err := h.hasOwnedProject(c); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
			return
		} else if !ok {
			c.JSON(http.StatusForbidden, gin.H{"err": "member management requires project owner permission"})
			return
		}
		rows, err = h.PG.Query(c, `
			SELECT u.id, u.email, COALESCE(u.name,''), COALESCE(u.phone,''), COALESCE(u.job_title,''),
			       COALESCE(u.role,'member'), COALESCE(u.company_id,0), COALESCE(o.name,''),
			       count(pm.project_id), COALESCE(string_agg(DISTINCT p.name, ', ' ORDER BY p.name), ''),
			       u.status, u.created_at
			FROM users u
			LEFT JOIN organizations o ON o.id=u.company_id
			LEFT JOIN project_members pm ON pm.user_id=u.id
			LEFT JOIN projects p ON p.id=pm.project_id
			WHERE u.status=1 AND u.company_id=$1
			GROUP BY u.id, o.name
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
		if err := rows.Scan(&item.ID, &item.Email, &item.Name, &item.Phone, &item.JobTitle, &item.Role, &item.CompanyID, &item.CompanyName, &item.ProjectCount, &item.ProjectNames, &item.Status, &item.CreatedAt); err == nil {
			out = append(out, item)
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *AuthHandler) createMemberAccount(c *gin.Context) {
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
	accountType := strings.TrimSpace(req.AccountType)
	if accountType == "" {
		accountType = "company"
	}
	userRole := "member"
	companyID := CurrentCompanyID(c)
	enforceProjectCompany := true
	if IsPlatformAdmin(c) {
		if accountType == "internal" {
			enforceProjectCompany = false
			if req.CompanyID > 0 {
				companyID = req.CompanyID
			}
		} else if req.CompanyID > 0 {
			companyID = req.CompanyID
		}
	}
	if !IsPlatformAdmin(c) {
		userRole = "member"
		accountType = "company"
		if ok, err := h.hasOwnedProject(c); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
			return
		} else if !ok {
			c.JSON(http.StatusForbidden, gin.H{"err": "member management requires project owner permission"})
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
	if IsPlatformAdmin(c) && accountType == "company" && companyID == 0 {
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

func (h *AuthHandler) canAssignProject(c *gin.Context, tx pgx.Tx, projectID, targetCompanyID int64, enforceCompany bool) error {
	var companyID int64
	if err := tx.QueryRow(c, `SELECT COALESCE(company_id,0) FROM projects WHERE id=$1`, projectID).Scan(&companyID); err != nil {
		return fmt.Errorf("project %d not found", projectID)
	}
	if enforceCompany && companyID != targetCompanyID {
		return fmt.Errorf("project %d does not belong to target company", projectID)
	}
	if !IsPlatformAdmin(c) {
		role, err := projectRole(c, h.PG, projectID, CurrentUserID(c))
		if err != nil || !roleAllows(role, RoleOwner) {
			return fmt.Errorf("no owner permission for project %d", projectID)
		}
	}
	return nil
}

func (h *AuthHandler) hasOwnedProject(c *gin.Context) (bool, error) {
	var exists bool
	err := h.PG.QueryRow(c, `
		SELECT EXISTS (
			SELECT 1
			FROM project_members m
			JOIN projects p ON p.id=m.project_id
			WHERE m.user_id=$1 AND m.role=$2
			LIMIT 1
		)
	`, CurrentUserID(c), RoleOwner).Scan(&exists)
	return exists, err
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
	return CurrentUserRole(c) == "admin"
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

// EnsureDefaultAuth creates a local admin account and makes it owner of orphan projects.
func EnsureDefaultAuth(ctx context.Context, pg *pgxpool.Pool) error {
	if pg == nil {
		return nil
	}
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

	var adminID int64
	err = pg.QueryRow(ctx, `SELECT id FROM users WHERE email=$1 LIMIT 1`, defaultAdminEmail).Scan(&adminID)
	if errors.Is(err, pgx.ErrNoRows) {
		hash, err := hashPassword(defaultAdminPassword)
		if err != nil {
			return err
		}
		if err := pg.QueryRow(ctx, `
			INSERT INTO users(email, name, password_hash, role)
			VALUES($1,$2,$3,'admin')
			RETURNING id
		`, defaultAdminEmail, defaultAdminName, hash).Scan(&adminID); err != nil {
			return err
		}
	} else if err != nil {
		return err
	} else {
		hash, err := hashPassword(defaultAdminPassword)
		if err != nil {
			return err
		}
		if _, err := pg.Exec(ctx, `
			UPDATE users
			SET name=COALESCE(NULLIF(name,''), $2), password_hash=$3, role='admin', status=1, updated_at=now()
			WHERE id=$1
		`, adminID, defaultAdminName, hash); err != nil {
			return err
		}
	}
	if _, err := pg.Exec(ctx, `
		UPDATE users SET company_id=$2 WHERE id=$1 AND company_id IS NULL
	`, adminID, companyID); err != nil {
		return err
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
	`, adminID)
	return err
}
