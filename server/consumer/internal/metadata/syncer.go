// Package metadata keeps Postgres-side governance tables in sync with events.
package metadata

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math"
	"strings"
	"time"

	"github.com/aerolog/server/pkg/model"
	"github.com/aerolog/server/pkg/privacy"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Syncer updates event/property dictionaries and identity mappings.
type Syncer struct {
	pg *pgxpool.Pool
}

// New creates a metadata syncer.
func New(pg *pgxpool.Pool) *Syncer {
	return &Syncer{pg: pg}
}

// Sync discovers event names, properties, and anonymous_id -> user_id links.
func (s *Syncer) Sync(ctx context.Context, events []*model.EnvelopedEvent) error {
	if s == nil || s.pg == nil || len(events) == 0 {
		return nil
	}

	issuesByIndex, issues, err := s.validateSchemas(ctx, events)
	if err != nil {
		return err
	}
	if err := s.insertDebugEvents(ctx, events, issuesByIndex); err != nil {
		return err
	}
	if err := s.insertSchemaIssues(ctx, issues); err != nil {
		return err
	}

	eventDefs := map[eventKey]seenAt{}
	propDefs := map[propKey]seenProp{}
	identities := map[identityKey]seenAt{}

	for _, env := range events {
		if env == nil {
			continue
		}
		at := observedAt(env)
		e := env.Event

		if e.Type == model.EventTypeTrack && e.Event != "" {
			mergeSeen(eventDefs, eventKey{projectID: env.ProjectID, name: e.Event}, at)
			for name, value := range e.Properties {
				if name == "" {
					continue
				}
				mergeProp(propDefs, propKey{projectID: env.ProjectID, name: name, scope: "event"}, inferType(value), at)
			}
		}

		if isProfileEvent(e.Type) {
			for name, value := range e.Properties {
				if !isUserProfileProperty(name) {
					continue
				}
				mergeProp(propDefs, propKey{projectID: env.ProjectID, name: name, scope: "user"}, inferType(value), at)
			}
		}

		anonID := firstNonEmpty(e.AnonymousID, propString(e.Properties, "$anonymous_id"))
		if anonID != "" && e.UserID != "" && anonID != e.UserID {
			mergeSeen(identities, identityKey{
				projectID:   env.ProjectID,
				anonymousID: anonID,
				userID:      e.UserID,
			}, at)
		}
	}

	var batch pgx.Batch
	queued := 0
	for k, v := range eventDefs {
		batch.Queue(upsertEventDefinitionSQL, int64(k.projectID), k.name, v.first, v.last)
		queued++
	}
	for k, v := range propDefs {
		batch.Queue(upsertPropertyDefinitionSQL, int64(k.projectID), k.name, k.scope, v.dataType, v.first, v.last)
		queued++
	}
	for k, v := range identities {
		batch.Queue(upsertIdentityMappingSQL, int64(k.projectID), k.anonymousID, k.userID, v.first, v.last)
		queued++
	}
	if queued == 0 {
		return nil
	}

	br := s.pg.SendBatch(ctx, &batch)
	defer br.Close()
	for i := 0; i < queued; i++ {
		if _, err := br.Exec(); err != nil {
			return err
		}
	}
	return nil
}

type eventKey struct {
	projectID uint32
	name      string
}

type propKey struct {
	projectID uint32
	name      string
	scope     string
}

type identityKey struct {
	projectID   uint32
	anonymousID string
	userID      string
}

type seenAt struct {
	first time.Time
	last  time.Time
}

type seenProp struct {
	first    time.Time
	last     time.Time
	dataType string
}

type schemaProperty struct {
	name     string
	dataType string
	required bool
	enums    []string
	locked   bool
}

type eventSchema struct {
	name          string
	status        int16
	requiredProps []string
	locked        bool
}

type schemaIssue struct {
	projectID    uint32
	event        string
	property     string
	expectedType string
	actualType   string
	severity     string
	message      string
	payload      []byte
	observedAt   time.Time
}

func (s *Syncer) validateSchemas(ctx context.Context, events []*model.EnvelopedEvent) (map[int][]schemaIssue, []schemaIssue, error) {
	projectIDs := map[uint32]struct{}{}
	for _, env := range events {
		if env != nil {
			projectIDs[env.ProjectID] = struct{}{}
		}
	}
	// defsByProject[projectID][eventName] = props，eventName="" 为全局默认规则
	defsByProject := map[uint32]map[string]map[string]schemaProperty{}
	eventDefsByProject := map[uint32]map[string]eventSchema{}
	for projectID := range projectIDs {
		defs, err := s.loadSchemaProperties(ctx, projectID)
		if err != nil {
			return nil, nil, err
		}
		defsByProject[projectID] = defs
		eventDefs, err := s.loadEventSchemas(ctx, projectID)
		if err != nil {
			return nil, nil, err
		}
		eventDefsByProject[projectID] = eventDefs
	}

	byIndex := map[int][]schemaIssue{}
	all := []schemaIssue{}
	for idx, env := range events {
		if env == nil || env.Event.Type != model.EventTypeTrack {
			continue
		}
		defs := mergeSchemaDefs(defsByProject[env.ProjectID][""], defsByProject[env.ProjectID][env.Event.Event])
		if len(defs) == 0 {
			continue
		}
		payload, _ := json.Marshal(privacy.RedactJSON(env))
		at := observedAt(env)
		props := env.Event.Properties
		if props == nil {
			props = map[string]interface{}{}
		}

		if eventDef, ok := eventDefsByProject[env.ProjectID][env.Event.Event]; ok {
			if eventDef.status == 0 {
				issue := schemaIssue{
					projectID:    env.ProjectID,
					event:        env.Event.Event,
					property:     "",
					expectedType: "enabled_event",
					actualType:   "disabled_event",
					severity:     "error",
					message:      "事件已被禁用",
					payload:      payload,
					observedAt:   at,
				}
				byIndex[idx] = append(byIndex[idx], issue)
				all = append(all, issue)
			}
			for _, requiredProp := range eventDef.requiredProps {
				if requiredProp == "" {
					continue
				}
				if _, ok := props[requiredProp]; ok {
					continue
				}
				issue := schemaIssue{
					projectID:    env.ProjectID,
					event:        env.Event.Event,
					property:     requiredProp,
					expectedType: "required",
					actualType:   "missing",
					severity:     "error",
					message:      "事件必带参数缺失",
					payload:      payload,
					observedAt:   at,
				}
				byIndex[idx] = append(byIndex[idx], issue)
				all = append(all, issue)
			}
		}

		for name, def := range defs {
			_, ok := props[name]
			if def.required && !ok {
				issue := schemaIssue{
					projectID:    env.ProjectID,
					event:        env.Event.Event,
					property:     name,
					expectedType: def.dataType,
					actualType:   "missing",
					severity:     "error",
					message:      "必填参数缺失",
					payload:      payload,
					observedAt:   at,
				}
				byIndex[idx] = append(byIndex[idx], issue)
				all = append(all, issue)
			}
		}

		for name, value := range props {
			def, ok := defs[name]
			if !ok {
				continue
			}
			actual := inferType(value)
			if isStrictExpectedType(def.dataType) && actual != "unknown" && actual != def.dataType {
				issue := schemaIssue{
					projectID:    env.ProjectID,
					event:        env.Event.Event,
					property:     name,
					expectedType: def.dataType,
					actualType:   actual,
					severity:     severityForProperty(def),
					message:      "参数类型不符合 Schema",
					payload:      payload,
					observedAt:   at,
				}
				byIndex[idx] = append(byIndex[idx], issue)
				all = append(all, issue)
			}
			if len(def.enums) > 0 && !valueInEnum(value, def.enums) {
				issue := schemaIssue{
					projectID:    env.ProjectID,
					event:        env.Event.Event,
					property:     name,
					expectedType: def.dataType,
					actualType:   actual,
					severity:     "warning",
					message:      "参数值不在允许枚举内",
					payload:      payload,
					observedAt:   at,
				}
				byIndex[idx] = append(byIndex[idx], issue)
				all = append(all, issue)
			}
		}
	}
	return byIndex, all, nil
}

func (s *Syncer) loadSchemaProperties(ctx context.Context, projectID uint32) (map[string]map[string]schemaProperty, error) {
	rows, err := s.pg.Query(ctx, `
		SELECT name, COALESCE(event,''), data_type, schema_required, enum_values, schema_locked
		FROM property_definitions
		WHERE project_id=$1 AND scope='event' AND status=1
	`, int64(projectID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := map[string]map[string]schemaProperty{}
	for rows.Next() {
		var p schemaProperty
		var event string
		var raw []byte
		if err := rows.Scan(&p.name, &event, &p.dataType, &p.required, &raw, &p.locked); err != nil {
			return nil, err
		}
		p.enums = parseStringEnums(raw)
		bucket, ok := out[event]
		if !ok {
			bucket = map[string]schemaProperty{}
			out[event] = bucket
		}
		bucket[p.name] = p
	}
	return out, rows.Err()
}

// mergeSchemaDefs 把全局默认规则与事件专属规则合并，事件级覆盖全局。
func mergeSchemaDefs(global, eventScoped map[string]schemaProperty) map[string]schemaProperty {
	if len(global) == 0 && len(eventScoped) == 0 {
		return nil
	}
	out := make(map[string]schemaProperty, len(global)+len(eventScoped))
	for k, v := range global {
		out[k] = v
	}
	for k, v := range eventScoped {
		out[k] = v
	}
	return out
}

func (s *Syncer) loadEventSchemas(ctx context.Context, projectID uint32) (map[string]eventSchema, error) {
	rows, err := s.pg.Query(ctx, `
		SELECT name, status, schema_required_props, schema_locked
		FROM event_definitions
		WHERE project_id=$1
	`, int64(projectID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := map[string]eventSchema{}
	for rows.Next() {
		var item eventSchema
		var raw []byte
		if err := rows.Scan(&item.name, &item.status, &raw, &item.locked); err != nil {
			return nil, err
		}
		item.requiredProps = parseStringEnums(raw)
		out[item.name] = item
	}
	return out, rows.Err()
}

func (s *Syncer) insertDebugEvents(ctx context.Context, events []*model.EnvelopedEvent, issuesByIndex map[int][]schemaIssue) error {
	var batch pgx.Batch
	queued := 0
	for idx, env := range events {
		if env == nil {
			continue
		}
		payload, _ := json.Marshal(privacy.RedactJSON(env))
		result := "accepted"
		reason := ""
		if issues := issuesByIndex[idx]; len(issues) > 0 {
			result = "schema_warning"
			reason = summarizeIssues(issues)
		}
		batch.Queue(`
			INSERT INTO debug_events(project_id, event, event_type, distinct_id, user_id, anonymous_id, result, reason, payload, received_at)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		`, int64(env.ProjectID), env.Event.Event, string(env.Event.Type), env.Event.DistinctID, env.Event.UserID, env.Event.AnonymousID, result, reason, payload, observedAt(env))
		queued++
	}
	if queued == 0 {
		return nil
	}
	br := s.pg.SendBatch(ctx, &batch)
	defer br.Close()
	for i := 0; i < queued; i++ {
		if _, err := br.Exec(); err != nil {
			return err
		}
	}
	return nil
}

func (s *Syncer) insertSchemaIssues(ctx context.Context, issues []schemaIssue) error {
	if len(issues) == 0 {
		return nil
	}
	var batch pgx.Batch
	for _, issue := range issues {
		batch.Queue(`
			INSERT INTO schema_issues(project_id, event, property, expected_type, actual_type, severity, message, payload, observed_at)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
		`, int64(issue.projectID), issue.event, issue.property, issue.expectedType, issue.actualType, issue.severity, issue.message, issue.payload, issue.observedAt)
		batch.Queue(`
			INSERT INTO schema_issue_groups(
				project_id, event, property, expected_type, actual_type, severity, message, fingerprint,
				count, sample_payload, first_seen, last_seen
			)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$10,$10)
			ON CONFLICT(project_id, fingerprint) DO UPDATE SET
				count = schema_issue_groups.count + 1,
				severity = EXCLUDED.severity,
				message = EXCLUDED.message,
				sample_payload = EXCLUDED.sample_payload,
				last_seen = GREATEST(COALESCE(schema_issue_groups.last_seen, EXCLUDED.last_seen), EXCLUDED.last_seen),
				first_seen = COALESCE(LEAST(schema_issue_groups.first_seen, EXCLUDED.first_seen), EXCLUDED.first_seen),
				updated_at = now()
		`, int64(issue.projectID), issue.event, issue.property, issue.expectedType, issue.actualType, issue.severity, issue.message, issueFingerprint(issue), issue.payload, issue.observedAt)
	}
	br := s.pg.SendBatch(ctx, &batch)
	defer br.Close()
	for range issues {
		if _, err := br.Exec(); err != nil {
			return err
		}
		if _, err := br.Exec(); err != nil {
			return err
		}
	}
	return nil
}

func issueFingerprint(issue schemaIssue) string {
	raw := strings.Join([]string{
		issue.event,
		issue.property,
		issue.expectedType,
		issue.actualType,
		issue.severity,
		issue.message,
	}, "\x00")
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func parseStringEnums(raw []byte) []string {
	if len(raw) == 0 {
		return nil
	}
	var values []string
	if err := json.Unmarshal(raw, &values); err == nil {
		return values
	}
	var loose []interface{}
	if err := json.Unmarshal(raw, &loose); err != nil {
		return nil
	}
	out := make([]string, 0, len(loose))
	for _, v := range loose {
		out = append(out, strings.TrimSpace(toSchemaString(v)))
	}
	return out
}

func toSchemaString(v interface{}) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case bool:
		if x {
			return "true"
		}
		return "false"
	default:
		raw, _ := json.Marshal(x)
		return string(raw)
	}
}

func valueInEnum(v interface{}, enums []string) bool {
	actual := strings.TrimSpace(toSchemaString(v))
	for _, allowed := range enums {
		if strings.TrimSpace(allowed) == actual {
			return true
		}
	}
	return false
}

func isStrictExpectedType(dataType string) bool {
	switch dataType {
	case "", "unknown", "mixed":
		return false
	default:
		return true
	}
}

func severityForProperty(def schemaProperty) string {
	if def.locked || def.required {
		return "error"
	}
	return "warning"
}

func summarizeIssues(issues []schemaIssue) string {
	if len(issues) == 0 {
		return ""
	}
	parts := make([]string, 0, len(issues))
	for i, issue := range issues {
		if i >= 3 {
			parts = append(parts, "...")
			break
		}
		parts = append(parts, issue.property+":"+issue.message)
	}
	return strings.Join(parts, "; ")
}

func mergeSeen[T comparable](m map[T]seenAt, k T, at time.Time) {
	cur, ok := m[k]
	if !ok {
		m[k] = seenAt{first: at, last: at}
		return
	}
	if at.Before(cur.first) {
		cur.first = at
	}
	if at.After(cur.last) {
		cur.last = at
	}
	m[k] = cur
}

func mergeProp(m map[propKey]seenProp, k propKey, dataType string, at time.Time) {
	cur, ok := m[k]
	if !ok {
		m[k] = seenProp{first: at, last: at, dataType: dataType}
		return
	}
	if at.Before(cur.first) {
		cur.first = at
	}
	if at.After(cur.last) {
		cur.last = at
	}
	cur.dataType = mergeType(cur.dataType, dataType)
	m[k] = cur
}

func observedAt(env *model.EnvelopedEvent) time.Time {
	if env.Event.Time > 0 {
		return time.UnixMilli(env.Event.Time).UTC()
	}
	if env.ReceivedAt > 0 {
		return time.UnixMilli(env.ReceivedAt).UTC()
	}
	return time.Now().UTC()
}

func isProfileEvent(t model.EventType) bool {
	switch t {
	case model.EventTypeProfileSet,
		model.EventTypeProfileSetOnce,
		model.EventTypeProfileIncrement,
		model.EventTypeProfileUnset,
		model.EventTypeProfileDelete:
		return true
	default:
		return false
	}
}

func isUserProfileProperty(name string) bool {
	return name != "" && !strings.HasPrefix(name, "$")
}

func propString(props map[string]interface{}, key string) string {
	if props == nil {
		return ""
	}
	if v, ok := props[key].(string); ok {
		return v
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func inferType(v interface{}) string {
	switch x := v.(type) {
	case nil:
		return "unknown"
	case bool:
		return "bool"
	case float64:
		if math.IsNaN(x) || math.IsInf(x, 0) {
			return "unknown"
		}
		return "number"
	case float32, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
		return "number"
	case string:
		if _, err := time.Parse(time.RFC3339, x); err == nil {
			return "datetime"
		}
		return "string"
	case []interface{}:
		return "list"
	case map[string]interface{}:
		return "object"
	default:
		return "string"
	}
}

func mergeType(a, b string) string {
	if a == "" || a == "unknown" {
		return b
	}
	if b == "" || b == "unknown" || a == b {
		return a
	}
	return "mixed"
}

const upsertEventDefinitionSQL = `
INSERT INTO event_definitions(project_id, name, first_seen, last_seen)
VALUES($1, $2, $3, $4)
ON CONFLICT (project_id, name) DO UPDATE SET
	first_seen = COALESCE(LEAST(event_definitions.first_seen, EXCLUDED.first_seen), EXCLUDED.first_seen),
	last_seen = GREATEST(COALESCE(event_definitions.last_seen, EXCLUDED.last_seen), EXCLUDED.last_seen),
	updated_at = now()
`

const upsertPropertyDefinitionSQL = `
INSERT INTO property_definitions(project_id, name, scope, event, data_type, first_seen, last_seen)
VALUES($1, $2, $3, '', $4, $5, $6)
ON CONFLICT (project_id, name, scope, event) DO UPDATE SET
	data_type = CASE
		WHEN property_definitions.schema_locked THEN property_definitions.data_type
		WHEN property_definitions.data_type = EXCLUDED.data_type THEN property_definitions.data_type
		WHEN property_definitions.data_type = 'unknown' THEN EXCLUDED.data_type
		WHEN EXCLUDED.data_type = 'unknown' THEN property_definitions.data_type
		ELSE 'mixed'
	END,
	first_seen = COALESCE(LEAST(property_definitions.first_seen, EXCLUDED.first_seen), EXCLUDED.first_seen),
	last_seen = GREATEST(COALESCE(property_definitions.last_seen, EXCLUDED.last_seen), EXCLUDED.last_seen),
	updated_at = now()
`

const upsertIdentityMappingSQL = `
INSERT INTO identity_mappings(project_id, anonymous_id, user_id, first_seen, last_seen)
VALUES($1, $2, $3, $4, $5)
ON CONFLICT (project_id, anonymous_id, user_id) DO UPDATE SET
	first_seen = COALESCE(LEAST(identity_mappings.first_seen, EXCLUDED.first_seen), EXCLUDED.first_seen),
	last_seen = GREATEST(COALESCE(identity_mappings.last_seen, EXCLUDED.last_seen), EXCLUDED.last_seen),
	updated_at = now()
`
