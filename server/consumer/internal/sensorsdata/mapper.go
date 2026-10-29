// Package sensorsdata converts Sensors Data Kafka FLATTEN_JSON records into
// AeroLog's internal event envelope.
package sensorsdata

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/aerolog/server/pkg/model"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DecodeFlatten converts one event from a Sensors Data event Kafka topic.
// targetProjectID is deliberately supplied by deployment configuration: a
// Sensors Data project ID is not an AeroLog project ID.
func DecodeFlatten(data []byte, targetProjectID uint32) (*model.EnvelopedEvent, error) {
	var record map[string]interface{}
	if err := json.Unmarshal(data, &record); err != nil {
		return nil, fmt.Errorf("decode sensors flatten json: %w", err)
	}
	return decodeFlattenRecord(record, targetProjectID)
}

// DecodeFlattenRouted maps a Sensors Data record using its source project_id.
// The source ID belongs to Sensors Data; router resolves it to AeroLog project ID.
func DecodeFlattenRouted(data []byte, router *ProjectRouter) (*model.EnvelopedEvent, error) {
	var record map[string]interface{}
	if err := json.Unmarshal(data, &record); err != nil {
		return nil, fmt.Errorf("decode sensors flatten json: %w", err)
	}
	targetProjectID, err := router.Resolve(sourceProjectID(record))
	if err != nil {
		return nil, err
	}
	return decodeFlattenRecord(record, targetProjectID)
}

func decodeFlattenRecord(record map[string]interface{}, targetProjectID uint32) (*model.EnvelopedEvent, error) {
	if targetProjectID == 0 {
		return nil, errors.New("sensors target project id is required")
	}

	eventName := stringValue(record["event"])
	distinctID := stringValue(record["distinct_id"])
	eventTime, ok := millis(record["time"])
	if eventName == "" || distinctID == "" || !ok || eventTime <= 0 {
		return nil, errors.New("sensors event requires event, distinct_id, and time")
	}

	props := objectValue(record["properties"])
	if props == nil {
		props = map[string]interface{}{}
	}
	props["$aerolog_source"] = "sensorsdata"
	copySourceMetadata(props, record, "organization_id", "$sensorsdata_organization_id")
	copySourceMetadata(props, record, "project", "$sensorsdata_project")
	copySourceMetadata(props, record, "project_id", "$sensorsdata_project_id")
	copySourceMetadata(props, record, "trace_id", "$sensorsdata_trace_id")
	copySourceMetadata(props, record, "operation_type", "$sensorsdata_operation_type")

	identities := objectValue(record["identities"])
	userID := stringValue(identities["$identity_login_id"])
	anonymousID := stringValue(identities["$identity_anonymous_id"])
	if anonymousID == "" && distinctID != userID {
		anonymousID = stringValue(identities["$identity_distinct_id"])
	}

	receivedAt, ok := millis(props["$receive_time"])
	if !ok || receivedAt <= 0 {
		receivedAt, ok = millis(record["update_time"])
	}
	if !ok || receivedAt <= 0 {
		receivedAt = eventTime
	}

	env := &model.EnvelopedEvent{
		ProjectID:  targetProjectID,
		IP:         stringValue(props["$ip"]),
		ReceivedAt: receivedAt,
		Event: model.Event{
			Type:        model.EventTypeTrack,
			Event:       eventName,
			DistinctID:  distinctID,
			AnonymousID: anonymousID,
			UserID:      userID,
			Time:        eventTime,
			Lib: model.Lib{
				Name:    firstString(props["$lib"], props["lib"], "sensorsdata"),
				Version: firstString(props["$lib_version"], props["lib_version"]),
			},
			Properties: props,
		},
	}
	if err := env.Event.Validate(); err != nil {
		return nil, fmt.Errorf("validate mapped sensors event: %w", err)
	}
	return env, nil
}

// DecodeFlattenProfile converts a Sensors Data profile record from a
// FLATTEN_JSON profile topic into an AeroLog profile event.
func DecodeFlattenProfile(data []byte, targetProjectID uint32) (*model.EnvelopedEvent, error) {
	var record map[string]interface{}
	if err := json.Unmarshal(data, &record); err != nil {
		return nil, fmt.Errorf("decode sensors flatten profile json: %w", err)
	}
	return decodeFlattenProfileRecord(record, targetProjectID)
}

// DecodeFlattenProfileRouted maps profile records with same source-project route.
func DecodeFlattenProfileRouted(data []byte, router *ProjectRouter) (*model.EnvelopedEvent, error) {
	var record map[string]interface{}
	if err := json.Unmarshal(data, &record); err != nil {
		return nil, fmt.Errorf("decode sensors flatten profile json: %w", err)
	}
	targetProjectID, err := router.Resolve(sourceProjectID(record))
	if err != nil {
		return nil, err
	}
	return decodeFlattenProfileRecord(record, targetProjectID)
}

func decodeFlattenProfileRecord(record map[string]interface{}, targetProjectID uint32) (*model.EnvelopedEvent, error) {
	if targetProjectID == 0 {
		return nil, errors.New("sensors target project id is required")
	}

	props := objectValue(record["properties"])
	if props == nil {
		props = map[string]interface{}{}
	}
	identities := objectValue(record["identities"])
	distinctID := firstString(
		record["distinct_id"],
		identities["$identity_distinct_id"],
		identities["$identity_login_id"],
		identities["$identity_anonymous_id"],
	)
	profileType, ok := sensorsProfileType(stringValue(record["operation_type"]))
	if !ok || distinctID == "" {
		return nil, errors.New("sensors profile requires supported operation_type and distinct_id")
	}

	timestamp, ok := millis(record["time"])
	if !ok || timestamp <= 0 {
		timestamp, ok = millis(record["update_time"])
	}
	if !ok || timestamp <= 0 {
		timestamp, ok = millis(props["$receive_time"])
	}
	if !ok || timestamp <= 0 {
		return nil, errors.New("sensors profile requires time or update_time")
	}

	copySourceMetadata(props, record, "organization_id", "$sensorsdata_organization_id")
	copySourceMetadata(props, record, "project", "$sensorsdata_project")
	copySourceMetadata(props, record, "project_id", "$sensorsdata_project_id")
	copySourceMetadata(props, record, "trace_id", "$sensorsdata_trace_id")
	copySourceMetadata(props, record, "operation_type", "$sensorsdata_operation_type")

	receivedAt, ok := millis(props["$receive_time"])
	if !ok || receivedAt <= 0 {
		receivedAt = timestamp
	}
	env := &model.EnvelopedEvent{
		ProjectID:  targetProjectID,
		ReceivedAt: receivedAt,
		Event: model.Event{
			Type:        profileType,
			DistinctID:  distinctID,
			UserID:      stringValue(identities["$identity_login_id"]),
			AnonymousID: stringValue(identities["$identity_anonymous_id"]),
			Time:        timestamp,
			Lib:         model.Lib{Name: "sensorsdata"},
			Properties:  props,
		},
	}
	if err := env.Event.Validate(); err != nil {
		return nil, fmt.Errorf("validate mapped sensors profile: %w", err)
	}
	return env, nil
}

func sensorsProfileType(operation string) (model.EventType, bool) {
	switch strings.ToUpper(strings.TrimSpace(operation)) {
	case "SET", "UPSERT", "PROFILE_SET":
		return model.EventTypeProfileSet, true
	case "SET_ONCE", "PROFILE_SET_ONCE":
		return model.EventTypeProfileSetOnce, true
	case "INCREMENT", "PROFILE_INCREMENT":
		return model.EventTypeProfileIncrement, true
	case "UNSET", "PROFILE_UNSET":
		return model.EventTypeProfileUnset, true
	case "DELETE", "PROFILE_DELETE":
		return model.EventTypeProfileDelete, true
	default:
		return "", false
	}
}

func copySourceMetadata(props, record map[string]interface{}, from, to string) {
	if value, ok := record[from]; ok && value != nil {
		props[to] = value
	}
}

func objectValue(value interface{}) map[string]interface{} {
	object, _ := value.(map[string]interface{})
	return object
}

func stringValue(value interface{}) string {
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v)
	case json.Number:
		return v.String()
	case float64:
		return strconv.FormatInt(int64(v), 10)
	default:
		return ""
	}
}

func firstString(values ...interface{}) string {
	for _, value := range values {
		if text := stringValue(value); text != "" {
			return text
		}
	}
	return ""
}

func millis(value interface{}) (int64, bool) {
	switch v := value.(type) {
	case float64:
		if math.Trunc(v) != v || v > math.MaxInt64 || v < math.MinInt64 {
			return 0, false
		}
		return int64(v), true
	case json.Number:
		parsed, err := v.Int64()
		return parsed, err == nil
	case string:
		parsed, err := strconv.ParseInt(v, 10, 64)
		return parsed, err == nil
	default:
		return 0, false
	}
}

func sourceProjectID(record map[string]interface{}) string {
	return stringValue(record["project_id"])
}

type cacheEntry struct {
	projectID uint32
	expiresAt time.Time
}

// ProjectRouter keeps a short positive cache and resolves new source projects
// immediately. Existing static deployments can retain a fallback during migration.
type ProjectRouter struct {
	pg       *pgxpool.Pool
	fallback uint32
	mu       sync.RWMutex
	cache    map[string]cacheEntry
}

func NewProjectRouter(pg *pgxpool.Pool, fallback uint32) *ProjectRouter {
	return &ProjectRouter{pg: pg, fallback: fallback, cache: map[string]cacheEntry{}}
}

func (r *ProjectRouter) Resolve(sourceID string) (uint32, error) {
	sourceID = strings.TrimSpace(sourceID)
	if sourceID == "" {
		return 0, errors.New("sensors record has no project_id")
	}
	now := time.Now()
	r.mu.RLock()
	entry, ok := r.cache[sourceID]
	r.mu.RUnlock()
	if ok && now.Before(entry.expiresAt) {
		return entry.projectID, nil
	}
	if r.pg != nil {
		var projectID uint32
		err := r.pg.QueryRow(context.Background(), `SELECT project_id FROM sensors_integrations WHERE source_project_id=$1 AND status=1`, sourceID).Scan(&projectID)
		if err == nil && projectID > 0 {
			r.mu.Lock()
			r.cache[sourceID] = cacheEntry{projectID: projectID, expiresAt: now.Add(time.Minute)}
			r.mu.Unlock()
			return projectID, nil
		}
	}
	if r.fallback > 0 {
		return r.fallback, nil
	}
	return 0, fmt.Errorf("no AeroLog project mapping for Sensors Data project_id %q", sourceID)
}
