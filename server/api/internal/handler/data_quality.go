package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DataQualityHandler returns source-specific project ingestion health plus shared Kafka pipeline health.
type DataQualityHandler struct {
	PG              *pgxpool.Pool
	CH              driver.Conn
	PrometheusURL   string
	EncryptionKey   string
	WeComWebhookURL string
	HTTPClient      *http.Client
}

type sensorsQualityProject struct {
	ProjectID          int64      `json:"project_id"`
	ProjectName        string     `json:"project_name"`
	SourceProject      string     `json:"source_project"`
	Status             int16      `json:"status"`
	LastError          string     `json:"last_error"`
	LastVerifiedAt     *time.Time `json:"last_verified_at,omitempty"`
	LastEventAt        *time.Time `json:"last_event_at,omitempty"`
	EventsLast5Minutes uint64     `json:"events_last_5_minutes"`
	EventsLastHour     uint64     `json:"events_last_hour"`
	DLQLastHour        uint64     `json:"dlq_last_hour"`
}

type sensorsQueueHealth struct {
	Available   bool    `json:"available"`
	ConsumersUp bool    `json:"consumers_up"`
	KafkaLag    float64 `json:"kafka_lag"`
	DLQLastHour uint64  `json:"dlq_last_hour"`
	Error       string  `json:"error,omitempty"`
}

func (h *DataQualityHandler) Register(r *gin.RouterGroup) {
	r.GET("/data-quality/sensorsdata", h.sensorsDataQuality)
	r.POST("/data-quality/sensorsdata/reconcile", h.reconcileSensorsData)
	r.POST("/data-quality/wecom/test", h.testWeCom)
}

func (h *DataQualityHandler) testWeCom(c *gin.Context) {
	if !IsPlatformAdmin(c) {
		c.JSON(http.StatusForbidden, gin.H{"err": "仅平台管理员可发送测试告警"})
		return
	}
	if err := h.sendWeComAlert(c.Request.Context(), "AeroLog 企业微信告警测试", []string{"机器人连接正常", "时间：" + time.Now().In(time.FixedZone("UTC+8", 8*3600)).Format("2006-01-02 15:04:05 UTC+08:00")}); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"err": "企业微信告警发送失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"sent": true}})
}

func (h *DataQualityHandler) sensorsDataQuality(c *gin.Context) {
	projects, err := h.visibleSensorsProjects(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	if err := h.fillSensorsEventHealth(c.Request.Context(), projects); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"err": "读取神策事件入库状态失败"})
		return
	}
	if err := h.fillProjectDLQ(c.Request.Context(), projects); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"err": "读取死信队列状态失败"})
		return
	}
	queue := h.sharedQueueHealth(c.Request.Context())
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"projects": projects, "queue": queue}})
}

func (h *DataQualityHandler) visibleSensorsProjects(c *gin.Context) ([]sensorsQualityProject, error) {
	base := `
		SELECT p.id, p.name, si.source_project, si.status, COALESCE(si.last_error,''), si.last_verified_at
		FROM projects p
		JOIN sensors_integrations si ON si.project_id=p.id
		WHERE si.status=1`
	args := []any{}
	if !IsPlatformAdmin(c) {
		if IsCompanyAdmin(c) {
			base += ` AND p.company_id=$1`
			args = append(args, CurrentCompanyID(c))
		} else {
			base += ` AND EXISTS (SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=$1)`
			args = append(args, CurrentUserID(c))
		}
	}
	base += ` ORDER BY p.id DESC`
	rows, err := h.PG.Query(c, base, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]sensorsQualityProject, 0)
	for rows.Next() {
		var item sensorsQualityProject
		if err := rows.Scan(&item.ProjectID, &item.ProjectName, &item.SourceProject, &item.Status, &item.LastError, &item.LastVerifiedAt); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (h *DataQualityHandler) fillSensorsEventHealth(ctx context.Context, projects []sensorsQualityProject) error {
	if h.CH == nil || len(projects) == 0 {
		return nil
	}
	ids := make([]int64, 0, len(projects))
	byID := make(map[int64]*sensorsQualityProject, len(projects))
	for index := range projects {
		ids = append(ids, projects[index].ProjectID)
		byID[projects[index].ProjectID] = &projects[index]
	}
	holders := make([]string, len(ids))
	args := make([]any, len(ids))
	for index, id := range ids {
		holders[index] = "?"
		args[index] = uint32(id)
	}
	rows, err := h.CH.Query(ctx, `
		SELECT project_id, max(time),
		       countIf(time >= now64(3) - INTERVAL 5 MINUTE),
		       countIf(time >= now64(3) - INTERVAL 1 HOUR)
		FROM events
		WHERE project_id IN (`+strings.Join(holders, ",")+`)
		  AND JSONExtractString(properties, '$aerolog_source')='sensorsdata'
		GROUP BY project_id`, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id uint32
		var last time.Time
		var fiveMinutes, hour uint64
		if err := rows.Scan(&id, &last, &fiveMinutes, &hour); err != nil {
			return err
		}
		if item := byID[int64(id)]; item != nil {
			item.LastEventAt = &last
			item.EventsLast5Minutes = fiveMinutes
			item.EventsLastHour = hour
		}
	}
	return rows.Err()
}

func (h *DataQualityHandler) fillProjectDLQ(ctx context.Context, projects []sensorsQualityProject) error {
	if len(projects) == 0 {
		return nil
	}
	ids := make([]int64, 0, len(projects))
	byID := make(map[int64]*sensorsQualityProject, len(projects))
	for index := range projects {
		ids = append(ids, projects[index].ProjectID)
		byID[projects[index].ProjectID] = &projects[index]
	}
	rows, err := h.PG.Query(ctx, `
		SELECT project_id, count(*)
		FROM event_dlq
		WHERE project_id = ANY($1) AND created_at >= now() - INTERVAL '1 hour'
		GROUP BY project_id`, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var count uint64
		if err := rows.Scan(&id, &count); err != nil {
			return err
		}
		if item := byID[id]; item != nil {
			item.DLQLastHour = count
		}
	}
	return rows.Err()
}

func (h *DataQualityHandler) sharedQueueHealth(ctx context.Context) sensorsQueueHealth {
	var out sensorsQueueHealth
	if h.PG != nil {
		_ = h.PG.QueryRow(ctx, `SELECT count(*) FROM event_dlq WHERE created_at >= now() - INTERVAL '1 hour'`).Scan(&out.DLQLastHour)
	}
	if strings.TrimSpace(h.PrometheusURL) == "" {
		out.Error = "未配置 Prometheus"
		return out
	}
	lag, err := h.prometheusNumber(ctx, `sum(aerolog_consumer_kafka_lag{job=~"aerolog-sensors-(consumer|profile-consumer)"})`)
	if err != nil {
		out.Error = "暂时无法读取共享 Kafka 队列"
		return out
	}
	up, err := h.prometheusNumber(ctx, `min(up{job=~"aerolog-sensors-(consumer|profile-consumer)"})`)
	if err != nil {
		out.Error = "暂时无法读取共享消费者状态"
		return out
	}
	out.Available = true
	out.KafkaLag = lag
	out.ConsumersUp = up >= 1
	return out
}

func (h *DataQualityHandler) prometheusNumber(ctx context.Context, query string) (float64, error) {
	client := h.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 3 * time.Second}
	}
	endpoint := h.PrometheusURL + "/api/v1/query?query=" + url.QueryEscape(query)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return 0, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0, pgx.ErrNoRows
	}
	var payload struct {
		Status string `json:"status"`
		Data   struct {
			Result []struct {
				Value []json.RawMessage `json:"value"`
			} `json:"result"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return 0, err
	}
	if payload.Status != "success" || len(payload.Data.Result) == 0 || len(payload.Data.Result[0].Value) < 2 {
		return 0, pgx.ErrNoRows
	}
	var raw string
	if err := json.Unmarshal(payload.Data.Result[0].Value[1], &raw); err != nil {
		return 0, err
	}
	return strconv.ParseFloat(raw, 64)
}
