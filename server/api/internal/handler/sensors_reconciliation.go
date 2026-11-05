package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const sensorsAnalyticsPath = "/api/v3/analytics/v1/model/segmentation/report"

var reconciliationEvents = []string{"$AppStart", "ad_show", "ad_complete", "coin_earned"}

type sensorsReconciliationProject struct {
	ProjectID               int64                      `json:"project_id"`
	ProjectName             string                     `json:"project_name"`
	SourceProject           string                     `json:"source_project"`
	Timezone                string                     `json:"timezone"`
	Events                  []string                   `json:"events"`
	From                    string                     `json:"from"`
	To                      string                     `json:"to"`
	IntegrationConfiguredAt time.Time                  `json:"integration_configured_at"`
	CoverageStartedAt       *time.Time                 `json:"coverage_started_at,omitempty"`
	Error                   string                     `json:"error,omitempty"`
	Rows                    []sensorsReconciliationDay `json:"rows"`
}

type sensorsReconciliationDay struct {
	Date               string            `json:"date"`
	SensorsEvents      uint64            `json:"sensors_events"`
	AeroLogEvents      uint64            `json:"aerolog_events"`
	IdentityEvents     uint64            `json:"identity_events"`
	SensorsMergedUsers uint64            `json:"sensors_merged_users"`
	AeroLogDistinctIDs uint64            `json:"aerolog_distinct_ids"`
	SensorsByEvent     map[string]uint64 `json:"sensors_by_event"`
	AeroLogByEvent     map[string]uint64 `json:"aerolog_by_event"`
	CoverageStatus     string            `json:"coverage_status"`
}

type reconciliationIntegration struct {
	ProjectID         int64
	ProjectName       string
	SourceProject     string
	Endpoint          string
	APIKeyCiphertext  string
	Timezone          string
	ConfiguredAt      time.Time
	CoverageStartedAt *time.Time
}

type sensorsSegmentationMeasure struct {
	EventName  string         `json:"event_name"`
	Aggregator string         `json:"aggregator"`
	Name       string         `json:"name"`
	Filter     map[string]any `json:"filter"`
}

func (h *DataQualityHandler) reconcileSensorsData(c *gin.Context) {
	if strings.TrimSpace(h.EncryptionKey) == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"err": "服务端未配置神策 API Key 解密密钥"})
		return
	}
	days := 3
	if raw := strings.TrimSpace(c.Query("days")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 7 {
			c.JSON(http.StatusBadRequest, gin.H{"err": "days 必须在 1 到 7 之间"})
			return
		}
		days = value
	}
	integrations, err := h.visibleReconciliationIntegrations(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": "读取神策接入配置失败"})
		return
	}
	out := make([]sensorsReconciliationProject, 0, len(integrations))
	for _, integration := range integrations {
		start, end := reconciliationDateRange(integration.Timezone, days)
		out = append(out, h.reconcileIntegration(c.Request.Context(), integration, start, end))
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"projects": out,
	}})
}

func (h *DataQualityHandler) reconcileIntegration(ctx context.Context, integration reconciliationIntegration, start, end time.Time) sensorsReconciliationProject {
	item := sensorsReconciliationProject{
		ProjectID: integration.ProjectID, ProjectName: integration.ProjectName,
		SourceProject: integration.SourceProject, Timezone: integration.Timezone,
		From: start.Format("2006-01-02"), To: end.Format("2006-01-02"),
		IntegrationConfiguredAt: integration.ConfiguredAt,
	}
	coverageStartedAt, err := h.reconciliationCoverageStartedAt(ctx, integration)
	if err != nil {
		item.Error = "AeroLog 数据覆盖起点读取失败"
		return item
	}
	item.CoverageStartedAt = coverageStartedAt
	events, err := h.availableReconciliationEvents(ctx, integration.ProjectID)
	if err != nil {
		item.Error = "AeroLog 事件清单读取失败"
		return item
	}
	item.Events = events
	apiKey, err := decryptIntegrationSecret(h.EncryptionKey, integration.APIKeyCiphertext)
	if err != nil {
		item.Error = "无法读取已保存的神策 API Key"
		return item
	}
	requestCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	sensorsRows, err := newSensorsClient(integration.Endpoint, integration.SourceProject, apiKey, h.HTTPClient).dailySegmentation(requestCtx, start, end, events)
	cancel()
	if err != nil {
		item.Error = "神策查询失败：" + safeSensorsError(err)
		return item
	}
	aeroRows, err := h.aeroLogDailyReconciliation(ctx, integration.ProjectID, integration.Timezone, start, end, events)
	if err != nil {
		item.Error = "AeroLog 查询失败"
		return item
	}
	item.Rows = mergeReconciliationDays(start, end, sensorsRows, aeroRows, coverageStartedAt, integration.Timezone)
	return item
}

func reconciliationDateRange(timezone string, days int) (time.Time, time.Time) {
	location, err := time.LoadLocation(timezone)
	if err != nil {
		location = time.UTC
	}
	end := time.Now().In(location).AddDate(0, 0, -1)
	return end.AddDate(0, 0, -(days - 1)), end
}

func (h *DataQualityHandler) visibleReconciliationIntegrations(c *gin.Context) ([]reconciliationIntegration, error) {
	query := `
		SELECT p.id, p.name, si.source_project, si.endpoint, si.api_key_ciphertext,
		       COALESCE(p.timezone,'Asia/Shanghai'), si.created_at, si.realtime_coverage_started_at
		FROM projects p JOIN sensors_integrations si ON si.project_id=p.id
		WHERE si.status=1`
	args := []any{}
	if !IsPlatformAdmin(c) {
		if IsCompanyAdmin(c) {
			query += ` AND p.company_id=$1`
			args = append(args, CurrentCompanyID(c))
		} else {
			query += ` AND EXISTS (SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=$1)`
			args = append(args, CurrentUserID(c))
		}
	}
	query += ` ORDER BY p.id DESC`
	rows, err := h.PG.Query(c, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []reconciliationIntegration{}
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
		out = append(out, item)
	}
	return out, rows.Err()
}

// reconciliationCoverageStartedAt returns durable coverage state. Existing
// integrations are initialized once from the conservative later of integration
// configuration and first observed source event.
func (h *DataQualityHandler) reconciliationCoverageStartedAt(ctx context.Context, integration reconciliationIntegration) (*time.Time, error) {
	if integration.CoverageStartedAt != nil {
		return integration.CoverageStartedAt, nil
	}
	if h.CH == nil {
		return nil, errors.New("ClickHouse 不可用")
	}
	var firstObservedAt *time.Time
	err := h.CH.QueryRow(ctx, `
		SELECT minOrNull(received_at)
		FROM events
		WHERE project_id=? AND JSONExtractString(properties, '$aerolog_source')='sensorsdata'
	`, uint32(integration.ProjectID)).Scan(&firstObservedAt)
	if err != nil {
		return nil, err
	}
	startedAt := initialCoverageStartedAt(integration.ConfiguredAt, firstObservedAt)
	if startedAt == nil {
		return nil, nil
	}
	var persisted time.Time
	err = h.PG.QueryRow(ctx, `
		UPDATE sensors_integrations
		SET realtime_coverage_started_at = COALESCE(realtime_coverage_started_at, $2),
		    realtime_coverage_tracking_started_at = COALESCE(realtime_coverage_tracking_started_at, now())
		WHERE project_id=$1
		RETURNING realtime_coverage_started_at
	`, integration.ProjectID, *startedAt).Scan(&persisted)
	if err != nil {
		return nil, err
	}
	return &persisted, nil
}

func initialCoverageStartedAt(configuredAt time.Time, firstObservedAt *time.Time) *time.Time {
	if firstObservedAt == nil {
		return nil
	}
	startedAt := configuredAt
	if firstObservedAt.After(startedAt) {
		startedAt = *firstObservedAt
	}
	return &startedAt
}

func (s *sensorsClient) dailySegmentation(ctx context.Context, from, to time.Time, events []string) (map[string]sensorsReconciliationDay, error) {
	measures := []sensorsSegmentationMeasure{
		{EventName: "$Anything", Aggregator: "general", Name: "all_events", Filter: map[string]any{}},
		{EventName: "$Anything", Aggregator: "unique", Name: "all_users", Filter: map[string]any{}},
	}
	for _, event := range events {
		measures = append(measures, sensorsSegmentationMeasure{EventName: event, Aggregator: "general", Name: reconciliationMetricName(event), Filter: map[string]any{}})
	}
	body := map[string]any{
		"measures": measures, "from_date": from.Format("2006-01-02"), "to_date": to.Format("2006-01-02"),
		"unit": "DAY", "by_fields": []string{}, "filter": map[string]any{}, "use_cache": false,
		"approx": false, "sampling_factor": 64, "rollup": false,
	}
	raw, err := s.postAnalytics(ctx, body)
	if err != nil {
		return nil, err
	}
	rows, err := decodeSegmentationDays(raw)
	if err != nil {
		return nil, err
	}
	return rows, nil
}

func (s *sensorsClient) postAnalytics(ctx context.Context, body any) (json.RawMessage, error) {
	raw, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.endpoint+sensorsAnalyticsPath, bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json;charset=UTF-8")
	req.Header.Set("api-key", s.apiKey)
	req.Header.Set("sensorsdata-project", s.project)
	req.Header.Set("Sensors-Language", "ZH-CN")
	response, err := s.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP %d", response.StatusCode)
	}
	var envelope struct {
		Code    string          `json:"code"`
		Message string          `json:"message"`
		Data    json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return nil, errors.New("响应不是 JSON")
	}
	if envelope.Code != "SUCCESS" {
		if envelope.Code == "" {
			return nil, errors.New("响应缺少状态码")
		}
		return nil, errors.New(strings.TrimSpace(envelope.Code))
	}
	if len(envelope.Data) == 0 || string(envelope.Data) == "null" {
		return nil, errors.New("响应未返回统计数据")
	}
	return envelope.Data, nil
}

func (h *DataQualityHandler) availableReconciliationEvents(ctx context.Context, projectID int64) ([]string, error) {
	holders := make([]string, len(reconciliationEvents))
	args := make([]any, 0, len(reconciliationEvents)+1)
	args = append(args, uint32(projectID))
	for index, event := range reconciliationEvents {
		holders[index] = "?"
		args = append(args, event)
	}
	rows, err := h.CH.Query(ctx, `SELECT DISTINCT event FROM events
		WHERE project_id=? AND JSONExtractString(properties, '$aerolog_source')='sensorsdata'
		  AND event IN (`+strings.Join(holders, ",")+`)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	present := map[string]bool{}
	for rows.Next() {
		var event string
		if err := rows.Scan(&event); err != nil {
			return nil, err
		}
		present[event] = true
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]string, 0, len(reconciliationEvents))
	for _, event := range reconciliationEvents {
		if present[event] {
			out = append(out, event)
		}
	}
	return out, nil
}

func (h *DataQualityHandler) aeroLogDailyReconciliation(ctx context.Context, projectID int64, timezone string, from, to time.Time, events []string) (map[string]sensorsReconciliationDay, error) {
	if h.CH == nil {
		return nil, errors.New("ClickHouse 不可用")
	}
	eventExpr := make([]string, 0, len(events))
	args := []any{"$SignUp", "$SignUp"}
	for _, event := range events {
		eventExpr = append(eventExpr, "countIf(event = ?) AS `"+reconciliationMetricName(event)+"`")
		args = append(args, event)
	}
	args = append(args, uint32(projectID), from.Format("2006-01-02"), to.Format("2006-01-02"))
	metrics := []string{
		"countIf(event != ?) AS events", "countIf(event = ?) AS identity_events", "uniqExact(distinct_id) AS distinct_ids",
	}
	metrics = append(metrics, eventExpr...)
	rows, err := h.CH.Query(ctx, `
		SELECT toString(toDate(time, `+clickHouseTimezone(timezone)+`)) AS day,
		       `+strings.Join(metrics, ",")+`
		FROM events
		WHERE project_id=? AND JSONExtractString(properties, '$aerolog_source')='sensorsdata'
		  AND toDate(time, `+clickHouseTimezone(timezone)+`) BETWEEN toDate(?) AND toDate(?)
		GROUP BY day ORDER BY day`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]sensorsReconciliationDay{}
	for rows.Next() {
		var day string
		var eventCount, identityEvents, distinctIDs uint64
		values := make([]uint64, len(events))
		dest := []any{&day, &eventCount, &identityEvents, &distinctIDs}
		for i := range values {
			dest = append(dest, &values[i])
		}
		if err := rows.Scan(dest...); err != nil {
			return nil, err
		}
		byEvent := map[string]uint64{}
		for i, event := range events {
			byEvent[event] = values[i]
		}
		out[day] = sensorsReconciliationDay{Date: day, AeroLogEvents: eventCount, IdentityEvents: identityEvents, AeroLogDistinctIDs: distinctIDs, AeroLogByEvent: byEvent}
	}
	return out, rows.Err()
}

func mergeReconciliationDays(from, to time.Time, sensors, aerolog map[string]sensorsReconciliationDay, coverageStartedAt *time.Time, timezone string) []sensorsReconciliationDay {
	out := make([]sensorsReconciliationDay, 0)
	for day := from; !day.After(to); day = day.AddDate(0, 0, 1) {
		key := day.Format("2006-01-02")
		s := sensors[key]
		a := aerolog[key]
		out = append(out, sensorsReconciliationDay{Date: key, SensorsEvents: s.SensorsEvents, AeroLogEvents: a.AeroLogEvents, IdentityEvents: a.IdentityEvents, SensorsMergedUsers: s.SensorsMergedUsers, AeroLogDistinctIDs: a.AeroLogDistinctIDs, SensorsByEvent: s.SensorsByEvent, AeroLogByEvent: a.AeroLogByEvent, CoverageStatus: reconciliationCoverageStatus(key, coverageStartedAt, timezone)})
	}
	return out
}

func reconciliationCoverageStatus(day string, coverageStartedAt *time.Time, timezone string) string {
	if coverageStartedAt == nil {
		return "pending"
	}
	location, err := time.LoadLocation(timezone)
	if err != nil {
		location = time.UTC
	}
	started := coverageStartedAt.In(location)
	startedDay := started.Format("2006-01-02")
	if day < startedDay {
		return "not_covered"
	}
	if day == startedDay && (started.Hour() != 0 || started.Minute() != 0 || started.Second() != 0 || started.Nanosecond() != 0) {
		return "partial"
	}
	return "covered"
}

func reconciliationMetricName(event string) string {
	return "event_" + strings.NewReplacer("$", "meta_", "-", "_", ".", "_").Replace(event)
}

func decodeSegmentationDays(raw json.RawMessage) (map[string]sensorsReconciliationDay, error) {
	if rows := decodeSegmentationDetailRows(raw); len(rows) > 0 {
		return rows, nil
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, errors.New("统计数据格式无效")
	}
	rows := map[string]sensorsReconciliationDay{}
	collectSegmentationRows(value, rows)
	if len(rows) == 0 {
		return nil, errors.New("响应未包含按日统计结果")
	}
	return rows, nil
}

// Sensor Analytics returns metadata_columns and detail_rows. detail_rows is an
// ordered value array, so retain the metadata object's JSON key order instead
// of decoding it into a Go map.
func decodeSegmentationDetailRows(raw json.RawMessage) map[string]sensorsReconciliationDay {
	var payload struct {
		MetadataColumns json.RawMessage `json:"metadata_columns"`
		DetailRows      json.RawMessage `json:"detail_rows"`
	}
	if json.Unmarshal(raw, &payload) != nil || len(payload.MetadataColumns) == 0 || len(payload.DetailRows) == 0 {
		return nil
	}
	columns := orderedMetadataColumns(payload.MetadataColumns)
	if len(columns) == 0 {
		return nil
	}
	var rows []json.RawMessage
	if json.Unmarshal(payload.DetailRows, &rows) != nil {
		return nil
	}
	out := map[string]sensorsReconciliationDay{}
	for _, rawRow := range rows {
		var object map[string]any
		if json.Unmarshal(rawRow, &object) == nil {
			if day := segmentationDate(object); day != "" {
				if row, ok := segmentationRow(day, object); ok {
					out[day] = row
				}
			}
			continue
		}
		decoder := json.NewDecoder(bytes.NewReader(rawRow))
		decoder.UseNumber()
		var values []any
		if decoder.Decode(&values) != nil {
			continue
		}
		object = make(map[string]any, len(columns))
		for index, column := range columns {
			if index < len(values) {
				object[column] = values[index]
			}
		}
		if day := segmentationDate(object); day != "" {
			if row, ok := segmentationRow(day, object); ok {
				out[day] = row
			}
		}
	}
	return out
}

func orderedMetadataColumns(raw json.RawMessage) []string {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	token, err := decoder.Token()
	if err != nil {
		return nil
	}
	switch token {
	case json.Delim('{'):
		out := []string{}
		for decoder.More() {
			key, err := decoder.Token()
			if err != nil {
				return nil
			}
			name, ok := key.(string)
			if !ok {
				return nil
			}
			var discard json.RawMessage
			if decoder.Decode(&discard) != nil {
				return nil
			}
			out = append(out, name)
		}
		return out
	case json.Delim('['):
		var values []any
		if err := json.Unmarshal(raw, &values); err != nil {
			return nil
		}
		out := []string{}
		for _, value := range values {
			switch item := value.(type) {
			case string:
				out = append(out, item)
			case map[string]any:
				if name, ok := item["name"].(string); ok {
					out = append(out, name)
				}
			}
		}
		return out
	default:
		return nil
	}
}

func collectSegmentationRows(value any, out map[string]sensorsReconciliationDay) {
	switch node := value.(type) {
	case []any:
		for _, item := range node {
			collectSegmentationRows(item, out)
		}
	case map[string]any:
		if day := segmentationDate(node); day != "" {
			if row, ok := segmentationRow(day, node); ok {
				out[day] = row
			}
		}
		for _, item := range node {
			collectSegmentationRows(item, out)
		}
	}
}

func segmentationDate(row map[string]any) string {
	for _, key := range []string{"date", "by_value"} {
		value, ok := row[key]
		if !ok {
			continue
		}
		if text, ok := value.(string); ok {
			if parsed, err := time.Parse("2006-01-02", text); err == nil {
				return parsed.Format("2006-01-02")
			}
			if len(text) >= 10 {
				if parsed, err := time.Parse("2006-01-02", text[:10]); err == nil {
					return parsed.Format("2006-01-02")
				}
			}
		}
	}
	return ""
}

func segmentationRow(day string, value map[string]any) (sensorsReconciliationDay, bool) {
	allEvents, eventsOK := sensorUint(value["all_events"])
	allUsers, usersOK := sensorUint(value["all_users"])
	byEvent := map[string]uint64{}
	for _, event := range reconciliationEvents {
		if metric, ok := sensorUint(value[reconciliationMetricName(event)]); ok {
			byEvent[event] = metric
		}
	}
	if !eventsOK && !usersOK && len(byEvent) == 0 {
		return sensorsReconciliationDay{}, false
	}
	return sensorsReconciliationDay{Date: day, SensorsEvents: allEvents, SensorsMergedUsers: allUsers, SensorsByEvent: byEvent}, true
}

func sensorUint(value any) (uint64, bool) {
	switch raw := value.(type) {
	case json.Number:
		if integer, err := strconv.ParseUint(raw.String(), 10, 64); err == nil {
			return integer, true
		}
		if number, err := strconv.ParseFloat(raw.String(), 64); err == nil && number >= 0 {
			return uint64(number), true
		}
	case string:
		if integer, err := strconv.ParseUint(raw, 10, 64); err == nil {
			return integer, true
		}
		if number, err := strconv.ParseFloat(raw, 64); err == nil && number >= 0 {
			return uint64(number), true
		}
	case float64:
		if raw >= 0 {
			return uint64(raw), true
		}
	}
	return 0, false
}
