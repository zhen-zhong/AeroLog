package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const sensorsReconciliationAdvisoryLock int64 = 2026110501

// StartReconciliationScheduler stores one completed-natural-day reconciliation
// per project. External notifications are intentionally separate from this
// in-product audit trail.
func (h *DataQualityHandler) StartReconciliationScheduler(ctx context.Context) {
	if h.PG == nil || strings.TrimSpace(h.EncryptionKey) == "" {
		return
	}
	go func() {
		run := func() {
			runCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
			defer cancel()
			h.runScheduledReconciliations(runCtx)
		}
		run()
		ticker := time.NewTicker(30 * time.Minute)
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

func (h *DataQualityHandler) runScheduledReconciliations(ctx context.Context) {
	var locked bool
	if err := h.PG.QueryRow(ctx, `SELECT pg_try_advisory_lock($1)`, sensorsReconciliationAdvisoryLock).Scan(&locked); err != nil || !locked {
		return
	}
	defer func() {
		_, _ = h.PG.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, sensorsReconciliationAdvisoryLock)
	}()

	integrations, err := h.scheduledReconciliationIntegrations(ctx)
	if err != nil {
		log.Printf("scheduled Sensors reconciliation integrations err: %v", err)
		return
	}
	for _, integration := range integrations {
		location, err := time.LoadLocation(integration.Timezone)
		if err != nil {
			location = time.UTC
		}
		now := time.Now().In(location)
		if now.Hour() < 3 {
			continue
		}
		yesterday := now.AddDate(0, 0, -1)
		start := time.Date(yesterday.Year(), yesterday.Month(), yesterday.Day(), 0, 0, 0, 0, location)
		if !h.claimScheduledReconciliation(ctx, integration.ProjectID, start, integration.Timezone) {
			continue
		}
		result := h.reconcileIntegration(ctx, integration, start, start)
		h.saveScheduledReconciliation(ctx, integration.ProjectID, start, result)
		h.notifyScheduledReconciliation(ctx, start, result)
	}
}

func (h *DataQualityHandler) notifyScheduledReconciliation(ctx context.Context, day time.Time, result sensorsReconciliationProject) {
	if result.Error == "" && (len(result.Rows) == 0 || !reconciliationHasAnomaly(result.Rows[0])) {
		return
	}
	lines := []string{
		"项目：" + result.ProjectName + "（" + result.SourceProject + "）",
		"日期：" + day.Format("2006-01-02") + " · " + result.Timezone,
	}
	if result.Error != "" {
		lines = append(lines, "状态：对账失败", "原因："+result.Error)
	} else {
		row := result.Rows[0]
		lines = append(lines,
			"状态：完整覆盖数据存在差异",
			fmt.Sprintf("总事件：神策 %d / AeroLog %d", row.SensorsEvents, row.AeroLogEvents),
		)
	}
	notifyCtx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	if err := h.sendWeComAlert(notifyCtx, "AeroLog 神策数据告警", lines); err != nil {
		log.Printf("send WeCom reconciliation alert project=%d err: %v", result.ProjectID, err)
	}
}

func (h *DataQualityHandler) scheduledReconciliationIntegrations(ctx context.Context) ([]reconciliationIntegration, error) {
	rows, err := h.PG.Query(ctx, `
		SELECT p.id, p.name, si.source_project, si.endpoint, si.api_key_ciphertext,
		       COALESCE(p.timezone,'Asia/Shanghai'), si.created_at, si.realtime_coverage_started_at
		FROM projects p JOIN sensors_integrations si ON si.project_id=p.id
		WHERE si.status=1 ORDER BY p.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []reconciliationIntegration{}
	for rows.Next() {
		var item reconciliationIntegration
		if err := rows.Scan(&item.ProjectID, &item.ProjectName, &item.SourceProject, &item.Endpoint, &item.APIKeyCiphertext, &item.Timezone, &item.ConfiguredAt, &item.CoverageStartedAt); err != nil {
			return nil, err
		}
		if timezone, ok := normalizeProjectTimezone(item.Timezone); ok {
			item.Timezone = timezone
		} else {
			item.Timezone = defaultProjectTimezone
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (h *DataQualityHandler) claimScheduledReconciliation(ctx context.Context, projectID int64, day time.Time, timezone string) bool {
	var id int64
	err := h.PG.QueryRow(ctx, `
		INSERT INTO sensors_reconciliation_runs(project_id, reconcile_date, timezone, status)
		VALUES($1,$2,$3,'running')
		ON CONFLICT(project_id, reconcile_date) DO UPDATE
		SET status='running', error_message='', started_at=now(), finished_at=NULL
		WHERE sensors_reconciliation_runs.status <> 'completed'
		RETURNING id
	`, projectID, day.Format("2006-01-02"), timezone).Scan(&id)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		log.Printf("claim Sensors reconciliation project=%d err: %v", projectID, err)
	}
	return err == nil
}

func (h *DataQualityHandler) saveScheduledReconciliation(ctx context.Context, projectID int64, day time.Time, result sensorsReconciliationProject) {
	if result.Error != "" {
		_, err := h.PG.Exec(ctx, `
			UPDATE sensors_reconciliation_runs
			SET status='error', error_message=$3, finished_at=now()
			WHERE project_id=$1 AND reconcile_date=$2
		`, projectID, day.Format("2006-01-02"), result.Error)
		if err != nil {
			log.Printf("save Sensors reconciliation error project=%d: %v", projectID, err)
		}
		return
	}
	var row sensorsReconciliationDay
	if len(result.Rows) > 0 {
		row = result.Rows[0]
	}
	payload, err := json.Marshal(result)
	if err != nil {
		return
	}
	_, err = h.PG.Exec(ctx, `
		UPDATE sensors_reconciliation_runs
		SET status='completed', coverage_status=$3, has_anomaly=$4, result=$5, error_message='', finished_at=now()
		WHERE project_id=$1 AND reconcile_date=$2
	`, projectID, day.Format("2006-01-02"), row.CoverageStatus, reconciliationHasAnomaly(row), payload)
	if err != nil {
		log.Printf("save Sensors reconciliation project=%d err: %v", projectID, err)
	}
}

func reconciliationHasAnomaly(row sensorsReconciliationDay) bool {
	if row.CoverageStatus != "covered" || row.SensorsEvents != row.AeroLogEvents {
		return row.CoverageStatus == "covered" && row.SensorsEvents != row.AeroLogEvents
	}
	for event, sensors := range row.SensorsByEvent {
		if sensors != row.AeroLogByEvent[event] {
			return true
		}
	}
	return false
}
