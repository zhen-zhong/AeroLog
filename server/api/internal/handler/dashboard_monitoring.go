package handler

import (
	"context"
	"errors"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
)

// DashboardSubscription 是看板企业微信定时摘要配置。
type DashboardSubscription struct {
	DashboardID int64      `json:"dashboard_id"`
	ProjectID   int64      `json:"project_id"`
	Enabled     bool       `json:"enabled"`
	Cadence     string     `json:"cadence"`
	SendHour    int16      `json:"send_hour"`
	Weekday     int16      `json:"weekday"`
	LastSentAt  *time.Time `json:"last_sent_at,omitempty"`
	LastPeriod  string     `json:"last_period_key"`
	UpdatedAt   *time.Time `json:"updated_at,omitempty"`
}

// DashboardAlertRule 是项目核心指标阈值规则。
type DashboardAlertRule struct {
	ID              int64      `json:"id"`
	DashboardID     int64      `json:"dashboard_id"`
	ProjectID       int64      `json:"project_id"`
	Name            string     `json:"name"`
	Metric          string     `json:"metric"`
	Event           string     `json:"event"`
	Operator        string     `json:"operator"`
	Threshold       float64    `json:"threshold"`
	WindowMinutes   int        `json:"window_minutes"`
	CooldownMinutes int        `json:"cooldown_minutes"`
	Enabled         bool       `json:"enabled"`
	LastState       bool       `json:"last_state"`
	LastValue       *float64   `json:"last_value,omitempty"`
	LastEvaluatedAt *time.Time `json:"last_evaluated_at,omitempty"`
	LastNotifiedAt  *time.Time `json:"last_notified_at,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

type dashboardSubscriptionBody struct {
	Enabled  bool   `json:"enabled"`
	Cadence  string `json:"cadence"`
	SendHour int16  `json:"send_hour"`
	Weekday  int16  `json:"weekday"`
}

type dashboardAlertRuleBody struct {
	Name            string  `json:"name"`
	Metric          string  `json:"metric"`
	Event           string  `json:"event"`
	Operator        string  `json:"operator"`
	Threshold       float64 `json:"threshold"`
	WindowMinutes   int     `json:"window_minutes"`
	CooldownMinutes int     `json:"cooldown_minutes"`
	Enabled         bool    `json:"enabled"`
}

func (h *DashboardHandler) getMonitoring(c *gin.Context) {
	projectID, dashboardID, ok := dashboardIDs(c)
	if !ok {
		return
	}
	if !h.dashboardExists(c, projectID, dashboardID) {
		c.JSON(http.StatusNotFound, gin.H{"err": "看板不存在"})
		return
	}
	subscription, err := h.dashboardSubscription(c.Request.Context(), projectID, dashboardID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": "读取看板订阅失败"})
		return
	}
	rules, err := h.dashboardAlertRules(c, projectID, dashboardID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": "读取告警规则失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"subscription": subscription, "rules": rules}})
}

func (h *DashboardHandler) updateSubscription(c *gin.Context) {
	projectID, dashboardID, ok := dashboardIDs(c)
	if !ok {
		return
	}
	var body dashboardSubscriptionBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": "请求格式无效"})
		return
	}
	if err := normalizeDashboardSubscription(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	if !h.dashboardExists(c, projectID, dashboardID) {
		c.JSON(http.StatusNotFound, gin.H{"err": "看板不存在"})
		return
	}
	_, err := h.PG.Exec(c, `
		INSERT INTO dashboard_subscriptions(dashboard_id,project_id,enabled,cadence,send_hour,weekday,created_by)
		VALUES($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT(dashboard_id) DO UPDATE SET
			project_id=EXCLUDED.project_id,enabled=EXCLUDED.enabled,cadence=EXCLUDED.cadence,
			send_hour=EXCLUDED.send_hour,weekday=EXCLUDED.weekday,updated_at=now()
	`, dashboardID, projectID, body.Enabled, body.Cadence, body.SendHour, body.Weekday, CurrentUserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": "保存看板订阅失败"})
		return
	}
	item, err := h.dashboardSubscription(c.Request.Context(), projectID, dashboardID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": "读取看板订阅失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": item})
}

func (h *DashboardHandler) createAlertRule(c *gin.Context) {
	projectID, dashboardID, ok := dashboardIDs(c)
	if !ok {
		return
	}
	var body dashboardAlertRuleBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": "请求格式无效"})
		return
	}
	if err := normalizeDashboardAlertRule(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	if !h.dashboardExists(c, projectID, dashboardID) {
		c.JSON(http.StatusNotFound, gin.H{"err": "看板不存在"})
		return
	}
	if body.Event != "" && !h.dashboardAlertEventExists(c, projectID, body.Event) {
		c.JSON(http.StatusBadRequest, gin.H{"err": "事件不属于当前项目"})
		return
	}
	item, err := h.insertDashboardAlertRule(c, projectID, dashboardID, body)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": "创建告警规则失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": item})
}

func (h *DashboardHandler) updateAlertRule(c *gin.Context) {
	projectID, dashboardID, ok := dashboardIDs(c)
	if !ok {
		return
	}
	ruleID, err := positivePathID(c, "rule_id", "告警规则 ID 无效")
	if err != nil {
		return
	}
	var body dashboardAlertRuleBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": "请求格式无效"})
		return
	}
	if err := normalizeDashboardAlertRule(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	if body.Event != "" && !h.dashboardAlertEventExists(c, projectID, body.Event) {
		c.JSON(http.StatusBadRequest, gin.H{"err": "事件不属于当前项目"})
		return
	}
	var item DashboardAlertRule
	err = h.PG.QueryRow(c, `
		UPDATE dashboard_alert_rules SET
			name=$4,metric=$5,event=$6,operator=$7,threshold=$8,window_minutes=$9,
			cooldown_minutes=$10,enabled=$11,updated_at=now()
		WHERE id=$1 AND dashboard_id=$2 AND project_id=$3 AND status=1
		RETURNING id,dashboard_id,project_id,name,metric,event,operator,threshold,window_minutes,
		          cooldown_minutes,enabled,last_state,last_value,last_evaluated_at,last_notified_at,created_at,updated_at
	`, ruleID, dashboardID, projectID, body.Name, body.Metric, body.Event, body.Operator, body.Threshold,
		body.WindowMinutes, body.CooldownMinutes, body.Enabled).Scan(dashboardAlertRuleScan(&item)...)
	if errors.Is(err, pgx.ErrNoRows) {
		c.JSON(http.StatusNotFound, gin.H{"err": "告警规则不存在"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": "保存告警规则失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": item})
}

func (h *DashboardHandler) deleteAlertRule(c *gin.Context) {
	projectID, dashboardID, ok := dashboardIDs(c)
	if !ok {
		return
	}
	ruleID, err := positivePathID(c, "rule_id", "告警规则 ID 无效")
	if err != nil {
		return
	}
	command, err := h.PG.Exec(c, `
		UPDATE dashboard_alert_rules SET status=0,enabled=false,updated_at=now()
		WHERE id=$1 AND dashboard_id=$2 AND project_id=$3 AND status=1
	`, ruleID, dashboardID, projectID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": "删除告警规则失败"})
		return
	}
	if command.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"err": "告警规则不存在或已删除"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"ok": true}})
}

func (h *DashboardHandler) dashboardSubscription(ctx context.Context, projectID, dashboardID int64) (DashboardSubscription, error) {
	item := DashboardSubscription{DashboardID: dashboardID, ProjectID: projectID, Cadence: "daily", SendHour: 9, Weekday: 1}
	err := h.PG.QueryRow(ctx, `
		SELECT dashboard_id,project_id,enabled,cadence,send_hour,weekday,last_sent_at,last_period_key,updated_at
		FROM dashboard_subscriptions WHERE dashboard_id=$1 AND project_id=$2
	`, dashboardID, projectID).Scan(&item.DashboardID, &item.ProjectID, &item.Enabled, &item.Cadence, &item.SendHour,
		&item.Weekday, &item.LastSentAt, &item.LastPeriod, &item.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return item, nil
	}
	return item, err
}

func (h *DashboardHandler) dashboardAlertRules(c *gin.Context, projectID, dashboardID int64) ([]DashboardAlertRule, error) {
	rows, err := h.PG.Query(c, `
		SELECT id,dashboard_id,project_id,name,metric,event,operator,threshold,window_minutes,
		       cooldown_minutes,enabled,last_state,last_value,last_evaluated_at,last_notified_at,created_at,updated_at
		FROM dashboard_alert_rules
		WHERE dashboard_id=$1 AND project_id=$2 AND status=1
		ORDER BY id DESC
	`, dashboardID, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]DashboardAlertRule, 0)
	for rows.Next() {
		var item DashboardAlertRule
		if err := rows.Scan(dashboardAlertRuleScan(&item)...); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (h *DashboardHandler) insertDashboardAlertRule(c *gin.Context, projectID, dashboardID int64, body dashboardAlertRuleBody) (DashboardAlertRule, error) {
	var item DashboardAlertRule
	err := h.PG.QueryRow(c, `
		INSERT INTO dashboard_alert_rules(
			dashboard_id,project_id,name,metric,event,operator,threshold,window_minutes,cooldown_minutes,enabled,created_by
		) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		RETURNING id,dashboard_id,project_id,name,metric,event,operator,threshold,window_minutes,
		          cooldown_minutes,enabled,last_state,last_value,last_evaluated_at,last_notified_at,created_at,updated_at
	`, dashboardID, projectID, body.Name, body.Metric, body.Event, body.Operator, body.Threshold,
		body.WindowMinutes, body.CooldownMinutes, body.Enabled, CurrentUserID(c)).Scan(dashboardAlertRuleScan(&item)...)
	return item, err
}

func (h *DashboardHandler) dashboardAlertEventExists(c *gin.Context, projectID int64, event string) bool {
	var exists bool
	_ = h.PG.QueryRow(c, `
		SELECT EXISTS(SELECT 1 FROM event_definitions WHERE project_id=$1 AND name=$2 AND status=1)
	`, projectID, event).Scan(&exists)
	return exists
}

func dashboardAlertRuleScan(item *DashboardAlertRule) []interface{} {
	return []interface{}{
		&item.ID, &item.DashboardID, &item.ProjectID, &item.Name, &item.Metric, &item.Event,
		&item.Operator, &item.Threshold, &item.WindowMinutes, &item.CooldownMinutes, &item.Enabled,
		&item.LastState, &item.LastValue, &item.LastEvaluatedAt, &item.LastNotifiedAt, &item.CreatedAt, &item.UpdatedAt,
	}
}

func normalizeDashboardSubscription(body *dashboardSubscriptionBody) error {
	body.Cadence = strings.TrimSpace(body.Cadence)
	if body.Cadence != "daily" && body.Cadence != "weekly" {
		return errors.New("发送频率必须是 daily 或 weekly")
	}
	if body.SendHour < 0 || body.SendHour > 23 {
		return errors.New("发送小时必须在 0～23 之间")
	}
	if body.Weekday < 1 || body.Weekday > 7 {
		return errors.New("星期必须在 1～7 之间")
	}
	return nil
}

func normalizeDashboardAlertRule(body *dashboardAlertRuleBody) error {
	body.Name = strings.TrimSpace(body.Name)
	body.Metric = strings.TrimSpace(body.Metric)
	body.Event = strings.TrimSpace(body.Event)
	body.Operator = strings.TrimSpace(body.Operator)
	if body.Name == "" || len([]rune(body.Name)) > 128 {
		return errors.New("规则名称长度必须为 1～128 个字符")
	}
	if body.Metric != "event_count" && body.Metric != "unique_users" {
		return errors.New("不支持的告警指标")
	}
	if len([]rune(body.Event)) > 128 {
		return errors.New("事件名称不能超过 128 个字符")
	}
	if body.Operator != "gt" && body.Operator != "gte" && body.Operator != "lt" && body.Operator != "lte" {
		return errors.New("不支持的阈值运算符")
	}
	if math.IsNaN(body.Threshold) || math.IsInf(body.Threshold, 0) || body.Threshold < 0 {
		return errors.New("阈值必须是大于等于 0 的有限数字")
	}
	allowedWindows := map[int]bool{5: true, 15: true, 60: true, 360: true, 1440: true, 10080: true}
	if !allowedWindows[body.WindowMinutes] {
		return errors.New("不支持的检测窗口")
	}
	if body.CooldownMinutes < 5 || body.CooldownMinutes > 10080 {
		return errors.New("静默期必须在 5～10080 分钟之间")
	}
	return nil
}
