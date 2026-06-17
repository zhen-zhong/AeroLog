// Package metadata keeps Postgres-side governance tables in sync with events.
package metadata

import (
	"context"
	"math"
	"strings"
	"time"

	"github.com/aerolog/server/pkg/model"
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
INSERT INTO property_definitions(project_id, name, scope, data_type, first_seen, last_seen)
VALUES($1, $2, $3, $4, $5, $6)
ON CONFLICT (project_id, name, scope) DO UPDATE SET
	data_type = CASE
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
