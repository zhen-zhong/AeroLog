package handler

import (
	"crypto/subtle"
	"net/http"
	"strings"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// WeComBotHandler only exposes fixed, read-only analytics to the internal bot
// service. It never accepts AI-generated SQL.
type WeComBotHandler struct {
	PG      *pgxpool.Pool
	CH      driver.Conn
	Token   string
	Monitor *DataQualityHandler
}

func (h *WeComBotHandler) Register(r *gin.RouterGroup) {
	r.POST("/internal/wecom-bot/analytics", h.analytics)
}

type wecomBotQuery struct {
	Question string `json:"question"`
}

type wecomBotEvent struct {
	Event string `json:"event"`
	Count uint64 `json:"count"`
	Users uint64 `json:"users"`
}

func (h *WeComBotHandler) analytics(c *gin.Context) {
	if h.Token == "" || subtle.ConstantTimeCompare([]byte(c.GetHeader("X-AeroLog-Bot-Token")), []byte(h.Token)) != 1 {
		c.JSON(http.StatusUnauthorized, gin.H{"err": "unauthorized"})
		return
	}
	var body wecomBotQuery
	if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.Question) == "" || len([]rune(body.Question)) > 1000 {
		c.JSON(http.StatusBadRequest, gin.H{"err": "question required"})
		return
	}
	questionLower := strings.ToLower(body.Question)
	if strings.Contains(body.Question, "服务器") || strings.Contains(questionLower, "server") || strings.Contains(questionLower, "主机") {
		h.serverStatus(c)
		return
	}
	if strings.Contains(questionLower, "kafka") || strings.Contains(body.Question, "消息队列") || strings.Contains(body.Question, "积压") || strings.Contains(strings.ToLower(body.Question), "dlq") {
		h.kafkaStatus(c)
		return
	}

	type project struct {
		ID       uint32
		Name     string
		Timezone string
	}
	rows, err := h.PG.Query(c, `SELECT id, name, COALESCE(timezone, 'Asia/Shanghai') FROM projects ORDER BY id`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": "read projects failed"})
		return
	}
	defer rows.Close()
	var matched []project
	for rows.Next() {
		var p project
		if rows.Scan(&p.ID, &p.Name, &p.Timezone) == nil && strings.Contains(strings.ToLower(body.Question), strings.ToLower(p.Name)) {
			matched = append(matched, p)
		}
	}
	if len(matched) != 1 {
		c.JSON(http.StatusBadRequest, gin.H{"err": "请在问题中包含唯一项目名称"})
		return
	}
	p := matched[0]
	loc := time.FixedZone("UTC+8", 8*3600)
	if p.Timezone == "UTC" {
		loc = time.UTC
	}
	now := time.Now().In(loc)
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	if strings.Contains(body.Question, "昨天") || strings.Contains(strings.ToLower(body.Question), "yesterday") {
		start = start.AddDate(0, 0, -1)
		now = start.Add(24 * time.Hour)
	}

	const q = `SELECT event, count() AS c, uniqExact(distinct_id) AS u
		FROM events
		WHERE project_id = ? AND time >= ? AND time < ? AND lower(event) LIKE '%ad%'
		GROUP BY event ORDER BY c DESC LIMIT 20`
	events := make([]wecomBotEvent, 0)
	result, err := h.CH.Query(c, q, p.ID, start.UTC(), now.UTC())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": "query analytics failed"})
		return
	}
	defer result.Close()
	var total uint64
	for result.Next() {
		var item wecomBotEvent
		if result.Scan(&item.Event, &item.Count, &item.Users) == nil {
			total += item.Count
			events = append(events, item)
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"project_name": p.Name,
		"timezone":     p.Timezone,
		"from":         start.Format("2006-01-02 15:04:05 MST"),
		"to":           now.Format("2006-01-02 15:04:05 MST"),
		"metric":       "广告事件（事件名包含 ad）",
		"total_count":  total,
		"events":       events,
	}})
}

func (h *WeComBotHandler) serverStatus(c *gin.Context) {
	if h.Monitor == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"err": "服务器监控不可用"})
		return
	}
	metrics := map[string]any{"skill": "server_status", "checked_at": time.Now().In(time.FixedZone("UTC+8", 8*3600)).Format("2006-01-02 15:04:05 UTC+08:00")}
	queries := map[string]string{
		"cpu_percent":    `100 * (1 - avg(rate(node_cpu_seconds_total{job="aerolog-node",mode="idle"}[5m])))`,
		"memory_percent": `100 * (1 - node_memory_MemAvailable_bytes{job="aerolog-node"} / node_memory_MemTotal_bytes{job="aerolog-node"})`,
		"disk_percent":   `100 * (1 - node_filesystem_avail_bytes{job="aerolog-node",mountpoint="/"} / node_filesystem_size_bytes{job="aerolog-node",mountpoint="/"})`,
		"api_up":         `up{job="aerolog-api"}`,
		"collector_up":   `up{job="aerolog-collector"}`,
	}
	for key, query := range queries {
		if value, err := h.Monitor.prometheusNumber(c, query); err == nil {
			metrics[key] = value
		} else {
			metrics[key] = "unavailable"
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": metrics})
}

func (h *WeComBotHandler) kafkaStatus(c *gin.Context) {
	if h.Monitor == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"err": "Kafka 监控不可用"})
		return
	}
	queue := h.Monitor.sharedQueueHealth(c)
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"skill":         "kafka_status",
		"checked_at":    time.Now().In(time.FixedZone("UTC+8", 8*3600)).Format("2006-01-02 15:04:05 UTC+08:00"),
		"available":     queue.Available,
		"consumers_up":  queue.ConsumersUp,
		"kafka_lag":     queue.KafkaLag,
		"dlq_last_hour": queue.DLQLastHour,
		"error":         queue.Error,
	}})
}
