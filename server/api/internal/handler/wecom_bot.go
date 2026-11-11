package handler

import (
	"crypto/subtle"
	"net/http"
	"strings"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// WeComBotHandler only exposes fixed, read-only analytics to the internal bot
// service. It never accepts AI-generated SQL.
type WeComBotHandler struct {
	PG                 *pgxpool.Pool
	CH                 driver.Conn
	Token              string
	Monitor            *DataQualityHandler
	HostInspectorURL   string
	HostInspectorToken string
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
	result, err := h.executeSkill(c, body.Question)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": result})
}
