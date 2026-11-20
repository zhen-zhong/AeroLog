package handler

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"
)

const dashboardMonitorAdvisoryLock int64 = 2026112001

type dashboardMonitorRule struct {
	DashboardAlertRule
	ProjectName   string
	DashboardName string
	Timezone      string
}

type dashboardMonitorSubscription struct {
	DashboardID   int64
	ProjectID     int64
	ProjectName   string
	DashboardName string
	Timezone      string
	Cadence       string
	SendHour      int
	Weekday       int
	LastPeriod    string
	WidgetCount   int64
}

type dashboardSummary struct {
	Events     uint64
	Users      uint64
	AdShows    uint64
	AdComplete uint64
}

// StartDashboardMonitor 定时执行用户显式启用的看板订阅和阈值告警。
func (h *DataQualityHandler) StartDashboardMonitor(ctx context.Context) {
	if h == nil || h.PG == nil || h.CH == nil || strings.TrimSpace(h.WeComWebhookURL) == "" {
		return
	}
	go func() {
		run := func() {
			runCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
			defer cancel()
			h.runDashboardMonitor(runCtx)
		}
		run()
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				run()
			case <-ctx.Done():
				return
			}
		}
	}()
}

func (h *DataQualityHandler) runDashboardMonitor(ctx context.Context) {
	conn, err := h.PG.Acquire(ctx)
	if err != nil {
		return
	}
	defer conn.Release()
	var locked bool
	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock($1)`, dashboardMonitorAdvisoryLock).Scan(&locked); err != nil || !locked {
		return
	}
	defer func() {
		_, _ = conn.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, dashboardMonitorAdvisoryLock)
	}()

	h.evaluateDashboardAlertRules(ctx)
	h.sendDueDashboardSubscriptions(ctx, time.Now())
}

func (h *DataQualityHandler) evaluateDashboardAlertRules(ctx context.Context) {
	rules, err := h.enabledDashboardAlertRules(ctx)
	if err != nil {
		log.Printf("load dashboard alert rules err: %v", err)
		return
	}
	for _, rule := range rules {
		value, err := h.dashboardMetricValue(ctx, rule.ProjectID, rule.Metric, rule.Event, time.Now().Add(-time.Duration(rule.WindowMinutes)*time.Minute), time.Now())
		if err != nil {
			log.Printf("evaluate dashboard alert rule=%d err: %v", rule.ID, err)
			continue
		}
		active := dashboardRuleTriggered(value, rule.Operator, rule.Threshold)
		now := time.Now().UTC()
		_, err = h.PG.Exec(ctx, `
			UPDATE dashboard_alert_rules
			SET last_state=$2,last_value=$3,last_evaluated_at=$4,updated_at=now()
			WHERE id=$1 AND status=1
		`, rule.ID, active, value, now)
		if err != nil {
			log.Printf("save dashboard alert state rule=%d err: %v", rule.ID, err)
			continue
		}

		shouldNotify := active && (!rule.LastState || rule.LastNotifiedAt == nil || now.Sub(*rule.LastNotifiedAt) >= time.Duration(rule.CooldownMinutes)*time.Minute)
		recovered := !active && rule.LastState && rule.LastNotifiedAt != nil
		if !shouldNotify && !recovered {
			continue
		}
		title := "AeroLog 指标异常 · " + rule.Name
		if recovered {
			title = "AeroLog 指标恢复 · " + rule.Name
		}
		lines := []string{
			"项目：" + rule.ProjectName,
			"看板：" + rule.DashboardName,
			"指标：" + dashboardMetricLabel(rule.Metric, rule.Event),
			fmt.Sprintf("当前值：%.0f", value),
			"规则：" + dashboardOperatorLabel(rule.Operator) + fmt.Sprintf(" %.0f", rule.Threshold),
			fmt.Sprintf("检测窗口：近 %d 分钟", rule.WindowMinutes),
		}
		notifyCtx, cancel := context.WithTimeout(ctx, 6*time.Second)
		err = h.sendWeComAlert(notifyCtx, title, lines)
		cancel()
		if err != nil {
			log.Printf("send dashboard alert rule=%d err: %v", rule.ID, err)
			continue
		}
		_, _ = h.PG.Exec(ctx, `UPDATE dashboard_alert_rules SET last_notified_at=$2,updated_at=now() WHERE id=$1`, rule.ID, now)
	}
}

func (h *DataQualityHandler) enabledDashboardAlertRules(ctx context.Context) ([]dashboardMonitorRule, error) {
	rows, err := h.PG.Query(ctx, `
		SELECT r.id,r.dashboard_id,r.project_id,r.name,r.metric,r.event,r.operator,r.threshold,
		       r.window_minutes,r.cooldown_minutes,r.enabled,r.last_state,r.last_value,
		       r.last_evaluated_at,r.last_notified_at,r.created_at,r.updated_at,
		       p.name,d.name,COALESCE(p.timezone,'Asia/Shanghai')
		FROM dashboard_alert_rules r
		JOIN projects p ON p.id=r.project_id AND p.status=1
		JOIN dashboards d ON d.id=r.dashboard_id AND d.project_id=r.project_id AND d.status=1
		WHERE r.status=1 AND r.enabled=true
		ORDER BY r.id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]dashboardMonitorRule, 0)
	for rows.Next() {
		var item dashboardMonitorRule
		if err := rows.Scan(
			&item.ID, &item.DashboardID, &item.ProjectID, &item.Name, &item.Metric, &item.Event,
			&item.Operator, &item.Threshold, &item.WindowMinutes, &item.CooldownMinutes, &item.Enabled,
			&item.LastState, &item.LastValue, &item.LastEvaluatedAt, &item.LastNotifiedAt, &item.CreatedAt, &item.UpdatedAt,
			&item.ProjectName, &item.DashboardName, &item.Timezone,
		); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (h *DataQualityHandler) dashboardMetricValue(ctx context.Context, projectID int64, metric, event string, from, to time.Time) (float64, error) {
	query := `SELECT count(), uniqExact(distinct_id) FROM events WHERE project_id=? AND time>=? AND time<?`
	args := []interface{}{uint32(projectID), from.UTC(), to.UTC()}
	if event != "" {
		query += ` AND event=?`
		args = append(args, event)
	}
	var count, users uint64
	if err := h.CH.QueryRow(ctx, query, args...).Scan(&count, &users); err != nil {
		return 0, err
	}
	if metric == "unique_users" {
		return float64(users), nil
	}
	return float64(count), nil
}

func dashboardRuleTriggered(value float64, operator string, threshold float64) bool {
	switch operator {
	case "gt":
		return value > threshold
	case "gte":
		return value >= threshold
	case "lt":
		return value < threshold
	case "lte":
		return value <= threshold
	default:
		return false
	}
}

func dashboardMetricLabel(metric, event string) string {
	label := "事件次数"
	if metric == "unique_users" {
		label = "去重用户数"
	}
	if event != "" {
		return event + " · " + label
	}
	return "全部事件 · " + label
}

func dashboardOperatorLabel(operator string) string {
	switch operator {
	case "gt":
		return ">"
	case "gte":
		return "≥"
	case "lt":
		return "<"
	case "lte":
		return "≤"
	default:
		return operator
	}
}

func (h *DataQualityHandler) sendDueDashboardSubscriptions(ctx context.Context, now time.Time) {
	items, err := h.enabledDashboardSubscriptions(ctx)
	if err != nil {
		log.Printf("load dashboard subscriptions err: %v", err)
		return
	}
	for _, item := range items {
		location, err := time.LoadLocation(item.Timezone)
		if err != nil {
			location = time.UTC
		}
		start, end, periodKey, due := dashboardSubscriptionPeriod(now.In(location), item.Cadence, item.SendHour, item.Weekday)
		if !due || item.LastPeriod == periodKey {
			continue
		}
		summary, err := h.dashboardSummary(ctx, item.ProjectID, start, end)
		if err != nil {
			log.Printf("query dashboard subscription dashboard=%d err: %v", item.DashboardID, err)
			continue
		}
		lines := []string{
			"项目：" + item.ProjectName,
			"统计周期：" + start.Format("2006-01-02") + " ～ " + end.Add(-time.Second).Format("2006-01-02"),
			fmt.Sprintf("事件总数：%d", summary.Events),
			fmt.Sprintf("去重用户：%d", summary.Users),
			fmt.Sprintf("广告展示：%d", summary.AdShows),
			fmt.Sprintf("广告完成：%d", summary.AdComplete),
			fmt.Sprintf("看板组件：%d", item.WidgetCount),
		}
		notifyCtx, cancel := context.WithTimeout(ctx, 6*time.Second)
		err = h.sendWeComAlert(notifyCtx, "AeroLog 看板订阅 · "+item.DashboardName, lines)
		cancel()
		if err != nil {
			log.Printf("send dashboard subscription dashboard=%d err: %v", item.DashboardID, err)
			continue
		}
		_, _ = h.PG.Exec(ctx, `
			UPDATE dashboard_subscriptions SET last_period_key=$3,last_sent_at=now(),updated_at=now()
			WHERE dashboard_id=$1 AND project_id=$2 AND enabled=true
		`, item.DashboardID, item.ProjectID, periodKey)
	}
}

func (h *DataQualityHandler) enabledDashboardSubscriptions(ctx context.Context) ([]dashboardMonitorSubscription, error) {
	rows, err := h.PG.Query(ctx, `
		SELECT s.dashboard_id,s.project_id,p.name,d.name,COALESCE(p.timezone,'Asia/Shanghai'),
		       s.cadence,s.send_hour,s.weekday,s.last_period_key,
		       COUNT(w.id) FILTER (WHERE w.status=1)
		FROM dashboard_subscriptions s
		JOIN projects p ON p.id=s.project_id AND p.status=1
		JOIN dashboards d ON d.id=s.dashboard_id AND d.project_id=s.project_id AND d.status=1
		LEFT JOIN dashboard_widgets w ON w.dashboard_id=d.id
		WHERE s.enabled=true
		GROUP BY s.dashboard_id,s.project_id,p.name,d.name,p.timezone,s.cadence,s.send_hour,s.weekday,s.last_period_key
		ORDER BY s.dashboard_id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]dashboardMonitorSubscription, 0)
	for rows.Next() {
		var item dashboardMonitorSubscription
		if err := rows.Scan(&item.DashboardID, &item.ProjectID, &item.ProjectName, &item.DashboardName,
			&item.Timezone, &item.Cadence, &item.SendHour, &item.Weekday, &item.LastPeriod, &item.WidgetCount); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func dashboardSubscriptionPeriod(now time.Time, cadence string, sendHour, weekday int) (time.Time, time.Time, string, bool) {
	if now.Hour() < sendHour {
		return time.Time{}, time.Time{}, "", false
	}
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	if cadence == "weekly" {
		currentWeekday := int(now.Weekday())
		if currentWeekday == 0 {
			currentWeekday = 7
		}
		if currentWeekday != weekday {
			return time.Time{}, time.Time{}, "", false
		}
		start := today.AddDate(0, 0, -7)
		return start, today, "weekly:" + start.Format("2006-01-02"), true
	}
	start := today.AddDate(0, 0, -1)
	return start, today, "daily:" + start.Format("2006-01-02"), true
}

func (h *DataQualityHandler) dashboardSummary(ctx context.Context, projectID int64, start, end time.Time) (dashboardSummary, error) {
	var item dashboardSummary
	err := h.CH.QueryRow(ctx, `
		SELECT count(),uniqExact(distinct_id),countIf(event='ad_show'),countIf(event='ad_complete')
		FROM events WHERE project_id=? AND time>=? AND time<?
	`, uint32(projectID), start.UTC(), end.UTC()).Scan(&item.Events, &item.Users, &item.AdShows, &item.AdComplete)
	return item, err
}
