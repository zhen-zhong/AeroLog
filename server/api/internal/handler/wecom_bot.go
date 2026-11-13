package handler

import (
	"crypto/subtle"
	"net/http"
	"strings"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// WeComBotHandler 仅向内部机器人服务暴露固定的只读数据查询，
// 不接受 AI 生成的 SQL。
type WeComBotHandler struct {
	PG                 *pgxpool.Pool
	CH                 driver.Conn
	Analytics          *AnalyticsHandler
	Token              string
	Monitor            *DataQualityHandler
	HostInspectorURL   string
	HostInspectorToken string
}

func (h *WeComBotHandler) Register(r *gin.RouterGroup) {
	r.POST("/internal/wecom-bot/analytics", h.analytics)
}

type wecomBotQuery struct {
	Question string              `json:"question"`
	Skill    string              `json:"skill,omitempty"`
	Params   wecomBotSkillParams `json:"params,omitempty"`
}

// wecomBotSkillParams 是机器人规划后允许传入的受限参数。
// 服务端会按 Skill 再次校验，不允许把任意查询条件传给数据层。
type wecomBotSkillParams struct {
	TimeRange   string   `json:"time_range,omitempty"`
	Hours       int      `json:"hours,omitempty"`
	Metric      string   `json:"metric,omitempty"`
	Days        int      `json:"days,omitempty"`
	Chart       string   `json:"chart,omitempty"`
	Events      []string `json:"events,omitempty"`
	Event       string   `json:"event,omitempty"`
	Property    string   `json:"property,omitempty"`
	WindowHours int      `json:"window_hours,omitempty"`
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
	result, err := h.executeSkill(c, body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": result})
}
