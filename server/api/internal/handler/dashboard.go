package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DashboardHandler 管理项目级可视化看板和受控分析组件。
type DashboardHandler struct {
	PG *pgxpool.Pool
}

func (h *DashboardHandler) Register(r *gin.RouterGroup) {
	r.GET("/projects/:id/dashboards", h.list)
	r.POST("/projects/:id/dashboards", h.create)
	r.GET("/projects/:id/dashboards/:dashboard_id", h.get)
	r.PATCH("/projects/:id/dashboards/:dashboard_id", h.update)
	r.DELETE("/projects/:id/dashboards/:dashboard_id", h.remove)
	r.POST("/projects/:id/dashboards/:dashboard_id/widgets", h.createWidget)
	r.PATCH("/projects/:id/dashboards/:dashboard_id/widgets/:widget_id", h.updateWidget)
	r.DELETE("/projects/:id/dashboards/:dashboard_id/widgets/:widget_id", h.removeWidget)
	r.POST("/projects/:id/dashboards/:dashboard_id/widgets/:widget_id/copy", h.copyWidget)
}

type Dashboard struct {
	ID              int64             `json:"id"`
	ProjectID       int64             `json:"project_id"`
	Name            string            `json:"name"`
	Description     string            `json:"description"`
	GlobalConfig    json.RawMessage   `json:"global_config"`
	DraftConfig     json.RawMessage   `json:"draft_config"`
	PublishedConfig json.RawMessage   `json:"published_config"`
	Status          int16             `json:"status"`
	WidgetCount     int64             `json:"widget_count"`
	CreatedAt       time.Time         `json:"created_at"`
	UpdatedAt       time.Time         `json:"updated_at"`
	Widgets         []DashboardWidget `json:"widgets,omitempty"`
}

type DashboardWidget struct {
	ID            int64           `json:"id"`
	DashboardID   int64           `json:"dashboard_id"`
	ProjectID     int64           `json:"project_id"`
	Title         string          `json:"title"`
	WidgetType    string          `json:"widget_type"`
	SourceType    string          `json:"source_type"`
	SourceID      *int64          `json:"source_id,omitempty"`
	QueryConfig   json.RawMessage `json:"query_config"`
	DisplayConfig json.RawMessage `json:"display_config"`
	LayoutConfig  json.RawMessage `json:"layout_config"`
	Status        int16           `json:"status"`
	CreatedAt     time.Time       `json:"created_at"`
	UpdatedAt     time.Time       `json:"updated_at"`
}

type dashboardBody struct {
	Name            string          `json:"name"`
	Description     string          `json:"description"`
	GlobalConfig    json.RawMessage `json:"global_config"`
	DraftConfig     json.RawMessage `json:"draft_config"`
	PublishedConfig json.RawMessage `json:"published_config"`
}

type dashboardWidgetBody struct {
	Title         string          `json:"title"`
	WidgetType    string          `json:"widget_type"`
	SourceType    string          `json:"source_type"`
	SourceID      *int64          `json:"source_id"`
	QueryConfig   json.RawMessage `json:"query_config"`
	DisplayConfig json.RawMessage `json:"display_config"`
	LayoutConfig  json.RawMessage `json:"layout_config"`
}

func (h *DashboardHandler) list(c *gin.Context) {
	projectID, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	rows, err := h.PG.Query(c, `
		SELECT d.id,d.project_id,d.name,d.description,d.global_config,d.draft_config,d.published_config,d.status,
		       COUNT(w.id) FILTER (WHERE w.status=1),d.created_at,d.updated_at
		FROM dashboards d
		LEFT JOIN dashboard_widgets w ON w.dashboard_id=d.id
		WHERE d.project_id=$1 AND d.status=1
		GROUP BY d.id ORDER BY d.updated_at DESC,d.id DESC
	`, projectID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": "读取看板失败"})
		return
	}
	defer rows.Close()
	out := make([]Dashboard, 0)
	for rows.Next() {
		var item Dashboard
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.Name, &item.Description, &item.GlobalConfig, &item.DraftConfig, &item.PublishedConfig, &item.Status, &item.WidgetCount, &item.CreatedAt, &item.UpdatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"err": "读取看板失败"})
			return
		}
		out = append(out, item)
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *DashboardHandler) create(c *gin.Context) {
	projectID, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	var body dashboardBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": "请求格式无效"})
		return
	}
	if err := normalizeDashboardBody(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	var item Dashboard
	err := h.PG.QueryRow(c, `
		INSERT INTO dashboards(project_id,name,description,global_config,draft_config,published_config,created_by)
		VALUES($1,$2,$3,$4,$5,$6,$7)
		RETURNING id,project_id,name,description,global_config,draft_config,published_config,status,created_at,updated_at
	`, projectID, body.Name, body.Description, body.GlobalConfig, body.DraftConfig, body.PublishedConfig, CurrentUserID(c)).Scan(
		&item.ID, &item.ProjectID, &item.Name, &item.Description, &item.GlobalConfig, &item.DraftConfig, &item.PublishedConfig, &item.Status, &item.CreatedAt, &item.UpdatedAt,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": "创建看板失败"})
		return
	}
	item.Widgets = []DashboardWidget{}
	c.JSON(http.StatusOK, gin.H{"data": item})
}

func (h *DashboardHandler) get(c *gin.Context) {
	projectID, dashboardID, ok := dashboardIDs(c)
	if !ok {
		return
	}
	item, err := h.fetchDashboard(c, projectID, dashboardID)
	if errors.Is(err, pgx.ErrNoRows) {
		c.JSON(http.StatusNotFound, gin.H{"err": "看板不存在"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": "读取看板失败"})
		return
	}
	widgets, err := h.widgets(c, projectID, dashboardID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": "读取看板组件失败"})
		return
	}
	item.Widgets = widgets
	item.WidgetCount = int64(len(widgets))
	c.JSON(http.StatusOK, gin.H{"data": item})
}

func (h *DashboardHandler) update(c *gin.Context) {
	projectID, dashboardID, ok := dashboardIDs(c)
	if !ok {
		return
	}
	var body dashboardBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": "请求格式无效"})
		return
	}
	if err := normalizeDashboardBody(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	command, err := h.PG.Exec(c, `
		UPDATE dashboards SET name=$3,description=$4,global_config=$5,draft_config=$6,published_config=$7,updated_at=now()
		WHERE id=$1 AND project_id=$2 AND status=1
	`, dashboardID, projectID, body.Name, body.Description, body.GlobalConfig, body.DraftConfig, body.PublishedConfig)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": "保存看板失败"})
		return
	}
	if command.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"err": "看板不存在"})
		return
	}
	h.get(c)
}

func (h *DashboardHandler) remove(c *gin.Context) {
	projectID, dashboardID, ok := dashboardIDs(c)
	if !ok {
		return
	}
	tx, err := h.PG.Begin(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": "删除看板失败"})
		return
	}
	defer tx.Rollback(c)
	command, err := tx.Exec(c, `UPDATE dashboards SET status=0,updated_at=now() WHERE id=$1 AND project_id=$2 AND status=1`, dashboardID, projectID)
	if err != nil || command.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"err": "看板不存在或已删除"})
		return
	}
	if _, err := tx.Exec(c, `UPDATE dashboard_widgets SET status=0,updated_at=now() WHERE dashboard_id=$1 AND project_id=$2`, dashboardID, projectID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": "删除看板失败"})
		return
	}
	if err := tx.Commit(c); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": "删除看板失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"ok": true}})
}

func (h *DashboardHandler) createWidget(c *gin.Context) {
	projectID, dashboardID, ok := dashboardIDs(c)
	if !ok {
		return
	}
	var body dashboardWidgetBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": "请求格式无效"})
		return
	}
	if err := normalizeDashboardWidgetBody(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	if !h.dashboardExists(c, projectID, dashboardID) {
		c.JSON(http.StatusNotFound, gin.H{"err": "看板不存在"})
		return
	}
	item, err := h.insertWidget(c, projectID, dashboardID, body, CurrentUserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": "添加组件失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": item})
}

func (h *DashboardHandler) updateWidget(c *gin.Context) {
	projectID, dashboardID, ok := dashboardIDs(c)
	if !ok {
		return
	}
	widgetID, err := positivePathID(c, "widget_id", "组件 ID 无效")
	if err != nil {
		return
	}
	var body dashboardWidgetBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": "请求格式无效"})
		return
	}
	if err := normalizeDashboardWidgetBody(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	var item DashboardWidget
	err = h.PG.QueryRow(c, `
		UPDATE dashboard_widgets
		SET title=$4,widget_type=$5,source_type=$6,source_id=$7,query_config=$8,display_config=$9,layout_config=$10,updated_at=now()
		WHERE id=$1 AND dashboard_id=$2 AND project_id=$3 AND status=1
		RETURNING id,dashboard_id,project_id,title,widget_type,source_type,source_id,query_config,display_config,layout_config,status,created_at,updated_at
	`, widgetID, dashboardID, projectID, body.Title, body.WidgetType, body.SourceType, body.SourceID, body.QueryConfig, body.DisplayConfig, body.LayoutConfig).Scan(
		&item.ID, &item.DashboardID, &item.ProjectID, &item.Title, &item.WidgetType, &item.SourceType, &item.SourceID, &item.QueryConfig, &item.DisplayConfig, &item.LayoutConfig, &item.Status, &item.CreatedAt, &item.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		c.JSON(http.StatusNotFound, gin.H{"err": "组件不存在"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": "保存组件失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": item})
}

func (h *DashboardHandler) removeWidget(c *gin.Context) {
	projectID, dashboardID, ok := dashboardIDs(c)
	if !ok {
		return
	}
	widgetID, err := positivePathID(c, "widget_id", "组件 ID 无效")
	if err != nil {
		return
	}
	command, err := h.PG.Exec(c, `UPDATE dashboard_widgets SET status=0,updated_at=now() WHERE id=$1 AND dashboard_id=$2 AND project_id=$3 AND status=1`, widgetID, dashboardID, projectID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": "删除组件失败"})
		return
	}
	if command.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"err": "组件不存在或已删除"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"ok": true}})
}

func (h *DashboardHandler) copyWidget(c *gin.Context) {
	projectID, dashboardID, ok := dashboardIDs(c)
	if !ok {
		return
	}
	widgetID, err := positivePathID(c, "widget_id", "组件 ID 无效")
	if err != nil {
		return
	}
	var source DashboardWidget
	err = h.PG.QueryRow(c, `
		SELECT id,dashboard_id,project_id,title,widget_type,source_type,source_id,query_config,display_config,layout_config,status,created_at,updated_at
		FROM dashboard_widgets WHERE id=$1 AND dashboard_id=$2 AND project_id=$3 AND status=1
	`, widgetID, dashboardID, projectID).Scan(
		&source.ID, &source.DashboardID, &source.ProjectID, &source.Title, &source.WidgetType, &source.SourceType, &source.SourceID, &source.QueryConfig, &source.DisplayConfig, &source.LayoutConfig, &source.Status, &source.CreatedAt, &source.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		c.JSON(http.StatusNotFound, gin.H{"err": "组件不存在"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": "复制组件失败"})
		return
	}
	body := dashboardWidgetBody{Title: source.Title + " 副本", WidgetType: source.WidgetType, SourceType: source.SourceType, SourceID: source.SourceID, QueryConfig: source.QueryConfig, DisplayConfig: source.DisplayConfig, LayoutConfig: offsetDashboardLayout(source.LayoutConfig)}
	item, err := h.insertWidget(c, projectID, dashboardID, body, CurrentUserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": "复制组件失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": item})
}

func (h *DashboardHandler) fetchDashboard(c *gin.Context, projectID, dashboardID int64) (Dashboard, error) {
	var item Dashboard
	err := h.PG.QueryRow(c, `
		SELECT id,project_id,name,description,global_config,draft_config,published_config,status,created_at,updated_at
		FROM dashboards WHERE id=$1 AND project_id=$2 AND status=1
	`, dashboardID, projectID).Scan(&item.ID, &item.ProjectID, &item.Name, &item.Description, &item.GlobalConfig, &item.DraftConfig, &item.PublishedConfig, &item.Status, &item.CreatedAt, &item.UpdatedAt)
	return item, err
}

func (h *DashboardHandler) widgets(c *gin.Context, projectID, dashboardID int64) ([]DashboardWidget, error) {
	rows, err := h.PG.Query(c, `
		SELECT id,dashboard_id,project_id,title,widget_type,source_type,source_id,query_config,display_config,layout_config,status,created_at,updated_at
		FROM dashboard_widgets WHERE dashboard_id=$1 AND project_id=$2 AND status=1 ORDER BY id
	`, dashboardID, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]DashboardWidget, 0)
	for rows.Next() {
		var item DashboardWidget
		if err := rows.Scan(&item.ID, &item.DashboardID, &item.ProjectID, &item.Title, &item.WidgetType, &item.SourceType, &item.SourceID, &item.QueryConfig, &item.DisplayConfig, &item.LayoutConfig, &item.Status, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (h *DashboardHandler) insertWidget(c *gin.Context, projectID, dashboardID int64, body dashboardWidgetBody, userID int64) (DashboardWidget, error) {
	var item DashboardWidget
	err := h.PG.QueryRow(c, `
		INSERT INTO dashboard_widgets(dashboard_id,project_id,title,widget_type,source_type,source_id,query_config,display_config,layout_config,created_by)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		RETURNING id,dashboard_id,project_id,title,widget_type,source_type,source_id,query_config,display_config,layout_config,status,created_at,updated_at
	`, dashboardID, projectID, body.Title, body.WidgetType, body.SourceType, body.SourceID, body.QueryConfig, body.DisplayConfig, body.LayoutConfig, userID).Scan(
		&item.ID, &item.DashboardID, &item.ProjectID, &item.Title, &item.WidgetType, &item.SourceType, &item.SourceID, &item.QueryConfig, &item.DisplayConfig, &item.LayoutConfig, &item.Status, &item.CreatedAt, &item.UpdatedAt,
	)
	return item, err
}

func (h *DashboardHandler) dashboardExists(c *gin.Context, projectID, dashboardID int64) bool {
	var exists bool
	_ = h.PG.QueryRow(c, `SELECT EXISTS(SELECT 1 FROM dashboards WHERE id=$1 AND project_id=$2 AND status=1)`, dashboardID, projectID).Scan(&exists)
	return exists
}

func dashboardIDs(c *gin.Context) (int64, int64, bool) {
	projectID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || projectID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"err": "项目 ID 无效"})
		return 0, 0, false
	}
	dashboardID, err := strconv.ParseInt(c.Param("dashboard_id"), 10, 64)
	if err != nil || dashboardID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"err": "看板 ID 无效"})
		return 0, 0, false
	}
	return projectID, dashboardID, true
}

func positivePathID(c *gin.Context, key, message string) (int64, error) {
	id, err := strconv.ParseInt(c.Param(key), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"err": message})
		return 0, errors.New(message)
	}
	return id, nil
}

func normalizeDashboardBody(body *dashboardBody) error {
	body.Name = strings.TrimSpace(body.Name)
	body.Description = strings.TrimSpace(body.Description)
	if body.Name == "" || len([]rune(body.Name)) > 128 {
		return errors.New("看板名称长度必须为 1～128 个字符")
	}
	if len([]rune(body.Description)) > 1000 {
		return errors.New("看板说明不能超过 1000 个字符")
	}
	body.GlobalConfig = normalizedJSONObject(body.GlobalConfig)
	body.DraftConfig = normalizedJSONObject(body.DraftConfig)
	body.PublishedConfig = normalizedJSONObject(body.PublishedConfig)
	return nil
}

func normalizeDashboardWidgetBody(body *dashboardWidgetBody) error {
	body.Title = strings.TrimSpace(body.Title)
	body.WidgetType = strings.TrimSpace(body.WidgetType)
	body.SourceType = strings.TrimSpace(body.SourceType)
	if body.Title == "" || len([]rune(body.Title)) > 255 {
		return errors.New("组件名称长度必须为 1～255 个字符")
	}
	allowedWidgets := map[string]bool{"metric": true, "line": true, "bar": true, "table": true, "funnel": true, "text": true}
	if !allowedWidgets[body.WidgetType] {
		return errors.New("不支持的组件类型")
	}
	allowedSources := map[string]bool{"query_template": true, "custom_report": true, "funnel": true, "text": true}
	if !allowedSources[body.SourceType] {
		return errors.New("不支持的数据源类型")
	}
	body.QueryConfig = normalizedJSONObject(body.QueryConfig)
	body.DisplayConfig = normalizedJSONObject(body.DisplayConfig)
	body.LayoutConfig = normalizedJSONObject(body.LayoutConfig)
	return nil
}

func normalizedJSONObject(raw json.RawMessage) json.RawMessage {
	trimmed := json.RawMessage(strings.TrimSpace(string(raw)))
	if len(trimmed) == 0 || !json.Valid(trimmed) || trimmed[0] != '{' {
		return json.RawMessage(`{}`)
	}
	return trimmed
}

func offsetDashboardLayout(raw json.RawMessage) json.RawMessage {
	var layout map[string]any
	if err := json.Unmarshal(normalizedJSONObject(raw), &layout); err != nil {
		return json.RawMessage(`{}`)
	}
	y, _ := layout["y"].(float64)
	layout["y"] = y + 1
	encoded, err := json.Marshal(layout)
	if err != nil {
		return json.RawMessage(`{}`)
	}
	return encoded
}
