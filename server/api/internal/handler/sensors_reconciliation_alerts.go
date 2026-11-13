package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
)

const (
	defaultReconciliationAlertMinCount = 10
	defaultReconciliationAlertMinRate  = 0.05
	defaultReconciliationAlertSilence  = 6 * time.Hour
)

type reconciliationAlertCandidate struct {
	Type    string
	Title   string
	Lines   []string
	Details map[string]any
}

type sensorsReconciliationAlert struct {
	ID                int64          `json:"id"`
	ProjectID         int64          `json:"project_id"`
	ProjectName       string         `json:"project_name"`
	SourceProject     string         `json:"source_project"`
	ReconcileDate     string         `json:"reconcile_date"`
	AlertType         string         `json:"alert_type"`
	Status            string         `json:"status"`
	Details           map[string]any `json:"details"`
	FirstDetectedAt   time.Time      `json:"first_detected_at"`
	LastDetectedAt    time.Time      `json:"last_detected_at"`
	LastNotifiedAt    *time.Time     `json:"last_notified_at,omitempty"`
	NotificationCount int            `json:"notification_count"`
	AcknowledgedBy    string         `json:"acknowledged_by,omitempty"`
	AcknowledgedAt    *time.Time     `json:"acknowledged_at,omitempty"`
	ClosedBy          string         `json:"closed_by,omitempty"`
	ClosedAt          *time.Time     `json:"closed_at,omitempty"`
	ResolutionNote    string         `json:"resolution_note,omitempty"`
}

type reconciliationAlertActionRequest struct {
	Note string `json:"note"`
}

func (h *DataQualityHandler) RegisterProjectAlerts(r *gin.RouterGroup) {
	owner := r.Group("", ProjectRoleRequired(h.PG, RoleOwner))
	owner.POST("/projects/:id/data-quality/sensorsdata/alerts/:alert_id/acknowledge", h.acknowledgeReconciliationAlert)
	owner.POST("/projects/:id/data-quality/sensorsdata/alerts/:alert_id/close", h.closeReconciliationAlert)
}

func (h *DataQualityHandler) reconciliationAlertThreshold() (int, float64) {
	count := h.ReconciliationAlertMinCount
	if count < 1 {
		count = defaultReconciliationAlertMinCount
	}
	rate := h.ReconciliationAlertMinRate
	if rate <= 0 || rate > 1 {
		rate = defaultReconciliationAlertMinRate
	}
	return count, rate
}

func (h *DataQualityHandler) reconciliationAlertSilence() time.Duration {
	if h.ReconciliationAlertSilence <= 0 {
		return defaultReconciliationAlertSilence
	}
	return h.ReconciliationAlertSilence
}

func (h *DataQualityHandler) reconciliationAlertCandidate(result sensorsReconciliationProject) (reconciliationAlertCandidate, bool) {
	if result.Error != "" {
		return reconciliationAlertCandidate{
			Type:    "query_error",
			Title:   "AeroLog 神策对账失败",
			Lines:   []string{"项目：" + result.ProjectName + "（" + result.SourceProject + "）", "状态：对账失败", "原因：" + result.Error},
			Details: map[string]any{"error": result.Error},
		}, true
	}
	if len(result.Rows) == 0 || result.Rows[0].CoverageStatus != "covered" {
		return reconciliationAlertCandidate{}, false
	}
	row := result.Rows[0]
	metric, sensors, aerolog := largestReconciliationDifference(row)
	count, rate := h.reconciliationAlertThreshold()
	difference := absoluteDifference(sensors, aerolog)
	differenceRate := differenceRatio(sensors, aerolog)
	if difference < uint64(count) || differenceRate < rate {
		return reconciliationAlertCandidate{}, false
	}
	return reconciliationAlertCandidate{
		Type:  "data_difference",
		Title: "AeroLog 神策数据告警",
		Lines: []string{
			"项目：" + result.ProjectName + "（" + result.SourceProject + "）",
			"状态：完整覆盖数据差异超过告警阈值",
			fmt.Sprintf("指标：%s；神策 %d / AeroLog %d；差值 %d（%.1f%%）", metric, sensors, aerolog, difference, differenceRate*100),
			fmt.Sprintf("阈值：差值至少 %d 条且比例至少 %.1f%%", count, rate*100),
		},
		Details: map[string]any{
			"metric": metric, "sensors": sensors, "aerolog": aerolog,
			"difference": difference, "difference_rate": differenceRate,
			"threshold_count": count, "threshold_rate": rate,
		},
	}, true
}

func largestReconciliationDifference(row sensorsReconciliationDay) (string, uint64, uint64) {
	metric, sensors, aerolog := "总事件", row.SensorsEvents, row.AeroLogEvents
	maxDifference := absoluteDifference(sensors, aerolog)
	events := make([]string, 0, len(row.SensorsByEvent))
	for event := range row.SensorsByEvent {
		events = append(events, event)
	}
	sort.Strings(events)
	for _, event := range events {
		candidateSensors, candidateAeroLog := row.SensorsByEvent[event], row.AeroLogByEvent[event]
		if candidateDifference := absoluteDifference(candidateSensors, candidateAeroLog); candidateDifference > maxDifference {
			metric, sensors, aerolog, maxDifference = event, candidateSensors, candidateAeroLog, candidateDifference
		}
	}
	return metric, sensors, aerolog
}

func absoluteDifference(left, right uint64) uint64 {
	if left >= right {
		return left - right
	}
	return right - left
}

func differenceRatio(left, right uint64) float64 {
	base := max(left, right)
	if base == 0 {
		return 0
	}
	return float64(absoluteDifference(left, right)) / float64(base)
}

func (h *DataQualityHandler) recordReconciliationAlert(ctx context.Context, projectID int64, day time.Time, candidate reconciliationAlertCandidate) (bool, error) {
	if h.PG == nil {
		return false, errors.New("PostgreSQL 不可用")
	}
	details, err := json.Marshal(candidate.Details)
	if err != nil {
		return false, err
	}
	var alertID int64
	err = h.PG.QueryRow(ctx, `
		INSERT INTO sensors_reconciliation_alerts(project_id, reconcile_date, alert_type, details, last_notified_at, notification_count)
		VALUES($1,$2,$3,$4,now(),1)
		ON CONFLICT(project_id, reconcile_date, alert_type) DO NOTHING
		RETURNING id
	`, projectID, day.Format("2006-01-02"), candidate.Type, details).Scan(&alertID)
	if err == nil {
		return true, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return false, err
	}

	var status string
	var lastNotifiedAt *time.Time
	err = h.PG.QueryRow(ctx, `
		UPDATE sensors_reconciliation_alerts
		SET details=$4, last_detected_at=now(), updated_at=now()
		WHERE project_id=$1 AND reconcile_date=$2 AND alert_type=$3
		RETURNING id, status, last_notified_at
	`, projectID, day.Format("2006-01-02"), candidate.Type, details).Scan(&alertID, &status, &lastNotifiedAt)
	if err != nil {
		return false, err
	}
	if status != "open" || (lastNotifiedAt != nil && time.Since(*lastNotifiedAt) < h.reconciliationAlertSilence()) {
		return false, nil
	}
	command, err := h.PG.Exec(ctx, `
		UPDATE sensors_reconciliation_alerts
		SET last_notified_at=now(), notification_count=notification_count+1, updated_at=now()
		WHERE id=$1 AND status='open'
	`, alertID)
	return command.RowsAffected() == 1, err
}

func (h *DataQualityHandler) reconciliationAlertsForProjects(ctx context.Context, projectIDs []int64) ([]sensorsReconciliationAlert, error) {
	if len(projectIDs) == 0 {
		return []sensorsReconciliationAlert{}, nil
	}
	rows, err := h.PG.Query(ctx, `
		SELECT a.id, a.project_id, p.name, si.source_project, a.reconcile_date::text, a.alert_type, a.status, a.details,
		       a.first_detected_at, a.last_detected_at, a.last_notified_at, a.notification_count,
		       COALESCE(ack.email,''), a.acknowledged_at, COALESCE(closed.email,''), a.closed_at, a.resolution_note
		FROM sensors_reconciliation_alerts a
		JOIN projects p ON p.id=a.project_id
		JOIN sensors_integrations si ON si.project_id=a.project_id
		LEFT JOIN users ack ON ack.id=a.acknowledged_by
		LEFT JOIN users closed ON closed.id=a.closed_by
		WHERE a.project_id=ANY($1)
		ORDER BY CASE a.status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END, a.last_detected_at DESC
	`, projectIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]sensorsReconciliationAlert, 0)
	for rows.Next() {
		var item sensorsReconciliationAlert
		var rawDetails []byte
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.ProjectName, &item.SourceProject, &item.ReconcileDate, &item.AlertType, &item.Status, &rawDetails,
			&item.FirstDetectedAt, &item.LastDetectedAt, &item.LastNotifiedAt, &item.NotificationCount,
			&item.AcknowledgedBy, &item.AcknowledgedAt, &item.ClosedBy, &item.ClosedAt, &item.ResolutionNote); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(rawDetails, &item.Details); err != nil {
			item.Details = map[string]any{}
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (h *DataQualityHandler) acknowledgeReconciliationAlert(c *gin.Context) {
	h.updateReconciliationAlertStatus(c, "acknowledged")
}

func (h *DataQualityHandler) closeReconciliationAlert(c *gin.Context) {
	h.updateReconciliationAlertStatus(c, "closed")
}

func (h *DataQualityHandler) updateReconciliationAlertStatus(c *gin.Context, status string) {
	alertID, err := strconv.ParseInt(c.Param("alert_id"), 10, 64)
	if err != nil || alertID < 1 {
		c.JSON(http.StatusBadRequest, gin.H{"err": "告警 ID 无效"})
		return
	}
	var request reconciliationAlertActionRequest
	if err := c.ShouldBindJSON(&request); err != nil && !errors.Is(err, io.EOF) {
		c.JSON(http.StatusBadRequest, gin.H{"err": "请求格式无效"})
		return
	}
	request.Note = strings.TrimSpace(request.Note)
	if len([]rune(request.Note)) > 500 {
		c.JSON(http.StatusBadRequest, gin.H{"err": "备注不能超过 500 个字符"})
		return
	}
	query := `
		UPDATE sensors_reconciliation_alerts
		SET status=$3, acknowledged_by=CASE WHEN $3='acknowledged' THEN $4 ELSE acknowledged_by END,
		    acknowledged_at=CASE WHEN $3='acknowledged' THEN COALESCE(acknowledged_at, now()) ELSE acknowledged_at END,
		    closed_by=CASE WHEN $3='closed' THEN $4 ELSE closed_by END,
		    closed_at=CASE WHEN $3='closed' THEN now() ELSE closed_at END,
		    resolution_note=CASE WHEN $3='closed' THEN $5 ELSE resolution_note END,
		    updated_at=now()
		WHERE id=$1 AND project_id=$2 AND status <> 'closed'
		RETURNING id, status
	`
	var returnedID int64
	var returnedStatus string
	err = h.PG.QueryRow(c, query, alertID, c.Param("id"), status, CurrentUserID(c), request.Note).Scan(&returnedID, &returnedStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		c.JSON(http.StatusNotFound, gin.H{"err": "告警不存在或已关闭"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": "更新告警状态失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"id": returnedID, "status": returnedStatus}})
}
