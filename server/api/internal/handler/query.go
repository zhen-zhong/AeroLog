package handler

import (
	"context"
	"crypto/rand"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// QueryHandler 提供查询模板/分享/异步任务能力。
type QueryHandler struct {
	PG        *pgxpool.Pool
	CH        driver.Conn
	Analytics *AnalyticsHandler
}

func (h *QueryHandler) Register(r *gin.RouterGroup) {
	r.GET("/projects/:id/query_templates", h.listTemplates)
	r.POST("/projects/:id/query_templates", h.createTemplate)
	r.GET("/projects/:id/query_templates/:tid", h.getTemplate)
	r.PUT("/projects/:id/query_templates/:tid", h.updateTemplate)
	r.DELETE("/projects/:id/query_templates/:tid", h.deleteTemplate)
	r.POST("/projects/:id/query_templates/:tid/share", h.shareTemplate)

	r.GET("/shared/query_templates/:token", h.getSharedTemplate)

	r.POST("/projects/:id/analytics/jobs", h.createJob)
	r.GET("/projects/:id/analytics/jobs", h.listJobs)
	r.GET("/projects/:id/analytics/jobs/:job_id", h.getJob)
	r.GET("/projects/:id/analytics/jobs/:job_id/download", h.downloadJob)
}

// QueryTemplate 查询模板。
type QueryTemplate struct {
	ID          int64           `json:"id"`
	ProjectID   int64           `json:"project_id"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Config      json.RawMessage `json:"config"`
	ShareToken  string          `json:"share_token,omitempty"`
	IsShared    bool            `json:"is_shared"`
	Status      int16           `json:"status"`
	CreatedAt   time.Time       `json:"created_at"`
	UpdatedAt   time.Time       `json:"updated_at"`
}

func (h *QueryHandler) listTemplates(c *gin.Context) {
	pid, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	rows, err := h.PG.Query(c, `
		SELECT id, project_id, name, COALESCE(description,''), config, COALESCE(share_token,''), is_shared, status, created_at, updated_at
		FROM query_templates
		WHERE project_id=$1 AND status=1
		ORDER BY updated_at DESC LIMIT 200
	`, pid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	defer rows.Close()
	out := []QueryTemplate{}
	for rows.Next() {
		var t QueryTemplate
		if err := rows.Scan(&t.ID, &t.ProjectID, &t.Name, &t.Description, &t.Config, &t.ShareToken, &t.IsShared, &t.Status, &t.CreatedAt, &t.UpdatedAt); err == nil {
			out = append(out, t)
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *QueryHandler) createTemplate(c *gin.Context) {
	pid, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	var body struct {
		Name        string          `json:"name"`
		Description string          `json:"description"`
		Config      json.RawMessage `json:"config"`
		IsShared    bool            `json:"is_shared"`
	}
	if err := c.BindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	if body.Name == "" || len(body.Name) > 128 {
		c.JSON(http.StatusBadRequest, gin.H{"err": "name length must be 1..128"})
		return
	}
	if len(body.Config) == 0 {
		body.Config = json.RawMessage(`{}`)
	}
	var token *string
	if body.IsShared {
		t := generateShareToken()
		token = &t
	}
	var t QueryTemplate
	var tk *string
	err := h.PG.QueryRow(c, `
		INSERT INTO query_templates(project_id, name, description, config, share_token, is_shared)
		VALUES($1,$2,$3,$4,$5,$6)
		RETURNING id, project_id, name, COALESCE(description,''), config, share_token, is_shared, status, created_at, updated_at
	`, pid, body.Name, body.Description, []byte(body.Config), token, body.IsShared).
		Scan(&t.ID, &t.ProjectID, &t.Name, &t.Description, &t.Config, &tk, &t.IsShared, &t.Status, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	if tk != nil {
		t.ShareToken = *tk
	}
	c.JSON(http.StatusOK, gin.H{"data": t})
}

func (h *QueryHandler) getTemplate(c *gin.Context) {
	pid, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	tid, _ := strconv.ParseInt(c.Param("tid"), 10, 64)
	t, err := h.fetchTemplate(c, pid, tid)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"err": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": t})
}

func (h *QueryHandler) updateTemplate(c *gin.Context) {
	pid, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	tid, _ := strconv.ParseInt(c.Param("tid"), 10, 64)
	var body struct {
		Name        string          `json:"name"`
		Description string          `json:"description"`
		Config      json.RawMessage `json:"config"`
	}
	if err := c.BindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	if body.Name == "" || len(body.Name) > 128 {
		c.JSON(http.StatusBadRequest, gin.H{"err": "name length must be 1..128"})
		return
	}
	if len(body.Config) == 0 {
		body.Config = json.RawMessage(`{}`)
	}
	var t QueryTemplate
	var tk *string
	err := h.PG.QueryRow(c, `
		UPDATE query_templates
		SET name=$3, description=$4, config=$5, updated_at=now()
		WHERE id=$1 AND project_id=$2
		RETURNING id, project_id, name, COALESCE(description,''), config, share_token, is_shared, status, created_at, updated_at
	`, tid, pid, body.Name, body.Description, []byte(body.Config)).
		Scan(&t.ID, &t.ProjectID, &t.Name, &t.Description, &t.Config, &tk, &t.IsShared, &t.Status, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	if tk != nil {
		t.ShareToken = *tk
	}
	c.JSON(http.StatusOK, gin.H{"data": t})
}

func (h *QueryHandler) deleteTemplate(c *gin.Context) {
	pid, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	tid, _ := strconv.ParseInt(c.Param("tid"), 10, 64)
	_, err := h.PG.Exec(c, `UPDATE query_templates SET status=0, updated_at=now() WHERE id=$1 AND project_id=$2`, tid, pid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"ok": true}})
}

// shareTemplate 切换分享状态：enable=true 时生成 token，false 时停用并清空 token。
func (h *QueryHandler) shareTemplate(c *gin.Context) {
	pid, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	tid, _ := strconv.ParseInt(c.Param("tid"), 10, 64)
	var body struct {
		Enable bool `json:"enable"`
	}
	if err := c.BindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	var token *string
	if body.Enable {
		t := generateShareToken()
		token = &t
	}
	var t QueryTemplate
	var tk *string
	err := h.PG.QueryRow(c, `
		UPDATE query_templates
		SET is_shared=$3, share_token=$4, updated_at=now()
		WHERE id=$1 AND project_id=$2
		RETURNING id, project_id, name, COALESCE(description,''), config, share_token, is_shared, status, created_at, updated_at
	`, tid, pid, body.Enable, token).
		Scan(&t.ID, &t.ProjectID, &t.Name, &t.Description, &t.Config, &tk, &t.IsShared, &t.Status, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	if tk != nil {
		t.ShareToken = *tk
	}
	c.JSON(http.StatusOK, gin.H{"data": t})
}

// getSharedTemplate 公共访问：仅返回 is_shared=true 且 status=1 的模板。
func (h *QueryHandler) getSharedTemplate(c *gin.Context) {
	token := c.Param("token")
	if token == "" {
		c.JSON(http.StatusBadRequest, gin.H{"err": "token required"})
		return
	}
	var t QueryTemplate
	var tk *string
	err := h.PG.QueryRow(c, `
		SELECT id, project_id, name, COALESCE(description,''), config, share_token, is_shared, status, created_at, updated_at
		FROM query_templates
		WHERE share_token=$1 AND is_shared=true AND status=1
		LIMIT 1
	`, token).
		Scan(&t.ID, &t.ProjectID, &t.Name, &t.Description, &t.Config, &tk, &t.IsShared, &t.Status, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"err": "shared template not found"})
		return
	}
	if tk != nil {
		t.ShareToken = *tk
	}
	c.JSON(http.StatusOK, gin.H{"data": t})
}

func (h *QueryHandler) fetchTemplate(ctx context.Context, projectID, tid int64) (*QueryTemplate, error) {
	var t QueryTemplate
	var tk *string
	err := h.PG.QueryRow(ctx, `
		SELECT id, project_id, name, COALESCE(description,''), config, share_token, is_shared, status, created_at, updated_at
		FROM query_templates
		WHERE id=$1 AND project_id=$2 AND status=1
	`, tid, projectID).
		Scan(&t.ID, &t.ProjectID, &t.Name, &t.Description, &t.Config, &tk, &t.IsShared, &t.Status, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		return nil, err
	}
	if tk != nil {
		t.ShareToken = *tk
	}
	return &t, nil
}

func generateShareToken() string {
	buf := make([]byte, 24)
	_, _ = rand.Read(buf)
	return hex.EncodeToString(buf)
}

// AnalyticsJob 异步任务记录。
type AnalyticsJob struct {
	ID           int64           `json:"id"`
	ProjectID    int64           `json:"project_id"`
	Type         string          `json:"type"`
	Status       string          `json:"status"`
	Input        json.RawMessage `json:"input"`
	Result       json.RawMessage `json:"result,omitempty"`
	ErrorMessage string          `json:"error_message,omitempty"`
	RowsCount    int64           `json:"rows_count"`
	CreatedAt    time.Time       `json:"created_at"`
	UpdatedAt    time.Time       `json:"updated_at"`
	FinishedAt   *time.Time      `json:"finished_at,omitempty"`
}

func (h *QueryHandler) createJob(c *gin.Context) {
	pid, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	var body struct {
		Type  string          `json:"type"`
		Input json.RawMessage `json:"input"`
	}
	if err := c.BindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	if body.Type != "query_export" {
		c.JSON(http.StatusBadRequest, gin.H{"err": "type must be query_export"})
		return
	}
	if len(body.Input) == 0 {
		body.Input = json.RawMessage(`{}`)
	}
	var j AnalyticsJob
	var resBuf, errMsg *string
	err := h.PG.QueryRow(c, `
		INSERT INTO analytics_jobs(project_id, type, status, input)
		VALUES($1,$2,'pending',$3)
		RETURNING id, project_id, type, status, input, result::text, error_message, rows_count, created_at, updated_at, finished_at
	`, pid, body.Type, []byte(body.Input)).
		Scan(&j.ID, &j.ProjectID, &j.Type, &j.Status, &j.Input, &resBuf, &errMsg, &j.RowsCount, &j.CreatedAt, &j.UpdatedAt, &j.FinishedAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	if resBuf != nil {
		j.Result = json.RawMessage(*resBuf)
	}
	if errMsg != nil {
		j.ErrorMessage = *errMsg
	}
	c.JSON(http.StatusOK, gin.H{"data": j})
}

func (h *QueryHandler) listJobs(c *gin.Context) {
	pid, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	rows, err := h.PG.Query(c, `
		SELECT id, project_id, type, status, input, result::text, COALESCE(error_message,''), rows_count, created_at, updated_at, finished_at
		FROM analytics_jobs
		WHERE project_id=$1
		ORDER BY id DESC LIMIT 100
	`, pid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	defer rows.Close()
	out := []AnalyticsJob{}
	for rows.Next() {
		var j AnalyticsJob
		var resBuf *string
		if err := rows.Scan(&j.ID, &j.ProjectID, &j.Type, &j.Status, &j.Input, &resBuf, &j.ErrorMessage, &j.RowsCount, &j.CreatedAt, &j.UpdatedAt, &j.FinishedAt); err == nil {
			if resBuf != nil {
				j.Result = json.RawMessage(*resBuf)
			}
			out = append(out, j)
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *QueryHandler) getJob(c *gin.Context) {
	pid, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	jid, _ := strconv.ParseInt(c.Param("job_id"), 10, 64)
	var j AnalyticsJob
	var resBuf *string
	err := h.PG.QueryRow(c, `
		SELECT id, project_id, type, status, input, result::text, COALESCE(error_message,''), rows_count, created_at, updated_at, finished_at
		FROM analytics_jobs
		WHERE id=$1 AND project_id=$2
	`, jid, pid).
		Scan(&j.ID, &j.ProjectID, &j.Type, &j.Status, &j.Input, &resBuf, &j.ErrorMessage, &j.RowsCount, &j.CreatedAt, &j.UpdatedAt, &j.FinishedAt)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"err": err.Error()})
		return
	}
	if resBuf != nil {
		j.Result = json.RawMessage(*resBuf)
	}
	c.JSON(http.StatusOK, gin.H{"data": j})
}

// StartJobWorker 启动一个简单的轮询 worker：每 2 秒拉一个 pending 任务并执行。
// 多副本部署时使用 SELECT ... FOR UPDATE SKIP LOCKED 保证幂等。
func (h *QueryHandler) StartJobWorker(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				h.runOneJob(ctx)
			}
		}
	}()
}

func (h *QueryHandler) runOneJob(ctx context.Context) {
	tx, err := h.PG.Begin(ctx)
	if err != nil {
		return
	}
	defer tx.Rollback(ctx)
	var jobID int64
	var pid int64
	var jobType string
	var input []byte
	err = tx.QueryRow(ctx, `
		SELECT id, project_id, type, input
		FROM analytics_jobs
		WHERE status='pending'
		ORDER BY id ASC
		FOR UPDATE SKIP LOCKED
		LIMIT 1
	`).Scan(&jobID, &pid, &jobType, &input)
	if err != nil {
		return
	}
	if _, err := tx.Exec(ctx, `UPDATE analytics_jobs SET status='running', updated_at=now() WHERE id=$1`, jobID); err != nil {
		return
	}
	if err := tx.Commit(ctx); err != nil {
		return
	}

	resultBytes, rowsCount, runErr := h.executeJob(ctx, jobID, jobType, uint32(pid), input)
	if runErr != nil {
		log.Printf("analytics job %d failed: %v", jobID, runErr)
		_, _ = h.PG.Exec(ctx, `
			UPDATE analytics_jobs
			SET status='failed', error_message=$2, updated_at=now(), finished_at=now()
			WHERE id=$1
		`, jobID, runErr.Error())
		return
	}
	_, _ = h.PG.Exec(ctx, `
		UPDATE analytics_jobs
		SET status='succeeded', result=$2::jsonb, rows_count=$3, updated_at=now(), finished_at=now()
		WHERE id=$1
	`, jobID, string(resultBytes), rowsCount)
}

func (h *QueryHandler) executeJob(ctx context.Context, jobID int64, jobType string, pid uint32, input []byte) ([]byte, int64, error) {
	switch jobType {
	case "query_export":
		var body QueryTableBody
		if err := json.Unmarshal(input, &body); err != nil {
			return nil, 0, err
		}
		rows, dims, err := h.Analytics.executeQueryTable(ctx, pid, &body, 50000)
		if err != nil {
			return nil, 0, err
		}
		filename := queryExportFilename(pid, jobID)
		if err := writeQueryExportCSV(filename, rows, dims); err != nil {
			return nil, 0, err
		}
		payload := map[string]any{
			"format":       "csv",
			"filename":     filename,
			"download_url": fmt.Sprintf("/v1/projects/%d/analytics/jobs/%d/download", pid, jobID),
		}
		buf, err := json.Marshal(payload)
		if err != nil {
			return nil, 0, err
		}
		return buf, int64(len(rows)), nil
	}
	return nil, 0, &queryTableError{Status: http.StatusBadRequest, Msg: "unsupported job type"}
}

func (h *QueryHandler) downloadJob(c *gin.Context) {
	pid, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	jid, _ := strconv.ParseInt(c.Param("job_id"), 10, 64)
	var status string
	if err := h.PG.QueryRow(c, `
		SELECT status
		FROM analytics_jobs
		WHERE id=$1 AND project_id=$2
	`, jid, pid).Scan(&status); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"err": "job not found"})
		return
	}
	if status != "succeeded" {
		c.JSON(http.StatusConflict, gin.H{"err": "job is not finished"})
		return
	}
	filename := queryExportFilename(uint32(pid), jid)
	path := filepath.Join(queryExportDir(), filename)
	if _, err := os.Stat(path); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"err": "export file not found"})
		return
	}
	c.FileAttachment(path, filename)
}

func queryExportDir() string {
	if dir := os.Getenv("AEROLOG_EXPORT_DIR"); dir != "" {
		return dir
	}
	return filepath.Join("data", "exports")
}

func queryExportFilename(pid uint32, jobID int64) string {
	return fmt.Sprintf("query_export_project_%d_job_%d.csv", pid, jobID)
}

func writeQueryExportCSV(filename string, rows []QueryRow, dims []QueryDimMeta) error {
	dir := queryExportDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	path := filepath.Join(dir, filename)
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()

	w := csv.NewWriter(f)
	header := make([]string, 0, len(dims)+3)
	for _, dim := range dims {
		if dim.Type == "event" {
			header = append(header, "event")
		} else {
			header = append(header, dim.Key)
		}
	}
	header = append(header, "count", "users", "sample_users")
	if err := w.Write(header); err != nil {
		return err
	}
	for _, row := range rows {
		record := make([]string, 0, len(dims)+3)
		for i := range dims {
			if i < len(row.Dimensions) {
				record = append(record, row.Dimensions[i].Label)
			} else {
				record = append(record, "")
			}
		}
		record = append(record,
			strconv.FormatUint(row.Count, 10),
			strconv.FormatUint(row.Users, 10),
			strings.Join(row.SampleUsers, "|"),
		)
		if err := w.Write(record); err != nil {
			return err
		}
	}
	w.Flush()
	return w.Error()
}
