package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DataQualityHandler 返回数据源项目的接入健康度及共享 Kafka 链路健康度。
type DataQualityHandler struct {
	PG                          *pgxpool.Pool
	CH                          driver.Conn
	PrometheusURL               string
	EncryptionKey               string
	WeComWebhookURL             string
	SensorsApplication          string
	SensorsEventsTopic          string
	SensorsEventsGroup          string
	SensorsProfilesTopic        string
	SensorsProfilesGroup        string
	ReconciliationAlertMinCount int
	ReconciliationAlertMinRate  float64
	ReconciliationAlertSilence  time.Duration
	HTTPClient                  *http.Client
	alertMu                     sync.Mutex
	alertStates                 map[string]bool
}

type sensorsQualityProject struct {
	ProjectID          int64      `json:"project_id"`
	ProjectName        string     `json:"project_name"`
	SourceProject      string     `json:"source_project"`
	ApplicationID      string     `json:"application_id"`
	Subscriber         string     `json:"subscriber"`
	SubscriptionID     *int64     `json:"subscription_id,omitempty"`
	Status             int16      `json:"status"`
	LastError          string     `json:"last_error"`
	LastVerifiedAt     *time.Time `json:"last_verified_at,omitempty"`
	LastEventAt        *time.Time `json:"last_event_at,omitempty"`
	EventsLast5Minutes uint64     `json:"events_last_5_minutes"`
	EventsLastHour     uint64     `json:"events_last_hour"`
	DLQLastHour        uint64     `json:"dlq_last_hour"`
}

type sensorsQueueHealth struct {
	Available       bool                         `json:"available"`
	ApplicationName string                       `json:"application_name"`
	ConsumersUp     bool                         `json:"consumers_up"`
	KafkaLag        float64                      `json:"kafka_lag"`
	DLQLastHour     uint64                       `json:"dlq_last_hour"`
	Consumers       []sensorsQueueConsumerHealth `json:"consumers"`
	Error           string                       `json:"error,omitempty"`
}

type sensorsQueueConsumerHealth struct {
	Name       string  `json:"name"`
	Topic      string  `json:"topic"`
	GroupID    string  `json:"group_id"`
	Job        string  `json:"job"`
	ConsumerUp bool    `json:"consumer_up"`
	KafkaLag   float64 `json:"kafka_lag"`
}

type sensorsConsumerSpec struct {
	Name, Topic, GroupID, Job string
}

type prometheusVectorValue struct {
	Metric map[string]string
	Value  float64
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
	projectIDs := make([]int64, 0, len(projects))
	for _, project := range projects {
		projectIDs = append(projectIDs, project.ProjectID)
	}
	alerts, err := h.reconciliationAlertsForProjects(c.Request.Context(), projectIDs)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"err": "读取对账告警状态失败"})
		return
	}
	queue := h.sharedQueueHealth(c.Request.Context())
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"projects": projects, "queue": queue, "alerts": alerts}})
}

func (h *DataQualityHandler) visibleSensorsProjects(c *gin.Context) ([]sensorsQualityProject, error) {
	base := `
		SELECT p.id, p.name, si.source_project, si.application_id, si.subscriber, si.subscription_id,
		       si.status, COALESCE(si.last_error,''), si.last_verified_at
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
		if err := rows.Scan(&item.ProjectID, &item.ProjectName, &item.SourceProject, &item.ApplicationID, &item.Subscriber, &item.SubscriptionID, &item.Status, &item.LastError, &item.LastVerifiedAt); err != nil {
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
	out := sensorsQueueHealth{ApplicationName: h.SensorsApplication}
	if h.PG != nil {
		_ = h.PG.QueryRow(ctx, `SELECT count(*) FROM event_dlq WHERE created_at >= now() - INTERVAL '1 hour'`).Scan(&out.DLQLastHour)
	}
	if strings.TrimSpace(h.PrometheusURL) == "" {
		out.Error = "未配置 Prometheus"
		return out
	}
	specs := h.sensorsConsumerSpecs()
	if len(specs) == 0 {
		out.Error = "未配置神策消费者 Topic 或消费者组"
		return out
	}
	out.Consumers = make([]sensorsQueueConsumerHealth, 0, len(specs))
	out.ConsumersUp = true
	for _, spec := range specs {
		item := sensorsQueueConsumerHealth{Name: spec.Name, Topic: spec.Topic, GroupID: spec.GroupID, Job: spec.Job}
		up, err := h.prometheusNumber(ctx, `max(up{job=`+promQLString(spec.Job)+`}) OR vector(0)`)
		if err != nil {
			out.Error = "暂时无法读取神策消费者状态"
			return out
		}
		lag, err := h.prometheusNumber(ctx, `sum(aerolog_consumer_kafka_lag{job=`+promQLString(spec.Job)+`,topic=`+promQLString(spec.Topic)+`}) OR vector(0)`)
		if err != nil {
			out.Error = "暂时无法读取神策 Kafka lag"
			return out
		}
		item.ConsumerUp = up >= 1
		item.KafkaLag = lag
		out.ConsumersUp = out.ConsumersUp && item.ConsumerUp
		out.KafkaLag += lag
		out.Consumers = append(out.Consumers, item)
	}
	out.Available = true
	return out
}

func (h *DataQualityHandler) sensorsConsumerSpecs() []sensorsConsumerSpec {
	items := []sensorsConsumerSpec{
		{Name: "事件", Topic: strings.TrimSpace(h.SensorsEventsTopic), GroupID: strings.TrimSpace(h.SensorsEventsGroup), Job: "aerolog-sensors-consumer"},
		{Name: "用户属性", Topic: strings.TrimSpace(h.SensorsProfilesTopic), GroupID: strings.TrimSpace(h.SensorsProfilesGroup), Job: "aerolog-sensors-profile-consumer"},
	}
	out := make([]sensorsConsumerSpec, 0, len(items))
	for _, item := range items {
		if item.Topic != "" && item.GroupID != "" {
			out = append(out, item)
		}
	}
	return out
}

func promQLString(value string) string { return strconv.Quote(value) }

func (h *DataQualityHandler) prometheusNumber(ctx context.Context, query string) (float64, error) {
	values, err := h.prometheusVector(ctx, query)
	if err != nil || len(values) == 0 {
		return 0, err
	}
	return values[0].Value, nil
}

func (h *DataQualityHandler) prometheusVector(ctx context.Context, query string) ([]prometheusVectorValue, error) {
	client := h.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 3 * time.Second}
	}
	endpoint := h.PrometheusURL + "/api/v1/query?query=" + url.QueryEscape(query)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, pgx.ErrNoRows
	}
	var payload struct {
		Status string `json:"status"`
		Data   struct {
			Result []struct {
				Metric map[string]string `json:"metric"`
				Value  []json.RawMessage `json:"value"`
			} `json:"result"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}
	if payload.Status != "success" || len(payload.Data.Result) == 0 {
		return nil, pgx.ErrNoRows
	}
	values := make([]prometheusVectorValue, 0, len(payload.Data.Result))
	for _, item := range payload.Data.Result {
		if len(item.Value) < 2 {
			continue
		}
		var raw string
		if err := json.Unmarshal(item.Value[1], &raw); err != nil {
			return nil, err
		}
		value, err := strconv.ParseFloat(raw, 64)
		if err != nil {
			return nil, err
		}
		values = append(values, prometheusVectorValue{Metric: item.Metric, Value: value})
	}
	if len(values) == 0 {
		return nil, pgx.ErrNoRows
	}
	return values, nil
}
