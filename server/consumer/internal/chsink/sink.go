// Package chsink 负责把 EnvelopedEvent 批量写入 ClickHouse events_buffer
package chsink

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"net"
	"strings"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/aerolog/server/pkg/model"

	"github.com/aerolog/server/consumer/internal/etl"
)

// Sink ClickHouse 批量写入器
type Sink struct {
	conn driver.Conn
}

// New 创建 Sink
func New(addr, db, user, password string) (*Sink, error) {
	conn, err := clickhouse.Open(&clickhouse.Options{
		Addr: []string{addr},
		Auth: clickhouse.Auth{Database: db, Username: user, Password: password},
		Settings: clickhouse.Settings{
			"async_insert":          1,
			"wait_for_async_insert": 0,
		},
		DialTimeout:     5 * time.Second,
		MaxOpenConns:    8,
		MaxIdleConns:    4,
		ConnMaxLifetime: 30 * time.Minute,
	})
	if err != nil {
		return nil, err
	}
	if err := conn.Ping(context.Background()); err != nil {
		return nil, err
	}
	return &Sink{conn: conn}, nil
}

// WriteBatch 批量写入 events_buffer 表
func (s *Sink) WriteBatch(ctx context.Context, evts []*model.EnvelopedEvent) error {
	if len(evts) == 0 {
		return nil
	}
	batch, err := s.conn.PrepareBatch(ctx, `INSERT INTO events_buffer (
		project_id, event, distinct_id, user_id, anonymous_id,
		time, lib, lib_version, os, os_version, device_model,
		app_version, network, screen_w, screen_h,
		ip, country, province, city, browser, browser_ver,
		properties, received_at
	)`)
	if err != nil {
		return err
	}
	for _, e := range evts {
		props := e.Event.Properties
		ua := etl.ParseUA(e.UserAgent)
		geo := etl.ResolveGeo(e.IP)

		propsJSON, _ := json.Marshal(props)
		ip := net.ParseIP(e.IP)
		if ip == nil {
			ip = net.IPv4zero
		} else if v4 := ip.To4(); v4 != nil {
			ip = v4
		}

		err = batch.Append(
			e.ProjectID,
			e.Event.Event,
			e.Event.DistinctID,
			e.Event.UserID,
			e.Event.AnonymousID,
			time.UnixMilli(e.Event.Time).UTC(),
			e.Event.Lib.Name,
			e.Event.Lib.Version,
			pickStr(props, "$os", ua.OS),
			pickStr(props, "$os_version", ua.OSVersion),
			pickStr(props, "$model", ""),
			pickStr(props, "$app_version", ""),
			pickStr(props, "$network_type", ""),
			pickU16(props, "$screen_width"),
			pickU16(props, "$screen_height"),
			ip,
			geo.Country,
			geo.Province,
			geo.City,
			pickStr(props, "$browser", ua.Browser),
			pickStr(props, "$browser_version", ua.BrowserVer),
			string(propsJSON),
			time.UnixMilli(e.ReceivedAt),
		)
		if err != nil {
			return err
		}
	}
	return batch.Send()
}

// WriteProfiles merges profile events into the latest user profile snapshot.
func (s *Sink) WriteProfiles(ctx context.Context, evts []*model.EnvelopedEvent) error {
	if len(evts) == 0 {
		return nil
	}

	states := map[profileKey]*profileState{}
	order := make([]profileKey, 0, len(evts))
	for _, e := range evts {
		if e == nil || e.Event.DistinctID == "" {
			continue
		}
		key := profileKey{projectID: e.ProjectID, distinctID: e.Event.DistinctID}
		state := states[key]
		if state == nil {
			props, err := s.loadProfile(ctx, key.projectID, key.distinctID)
			if err != nil {
				return err
			}
			state = &profileState{properties: props}
			states[key] = state
			order = append(order, key)
		}
		state.userID = pickNonEmpty(e.Event.UserID, state.userID)
		state.anonymousID = pickNonEmpty(e.Event.AnonymousID, state.anonymousID)
		state.updatedAt = maxTime(state.updatedAt, eventTime(e))
		applyProfileEvent(state.properties, e.Event.Type, e.Event.Properties)
	}
	if len(order) == 0 {
		return nil
	}

	batch, err := s.conn.PrepareBatch(ctx, `INSERT INTO users (
		project_id, distinct_id, user_id, anonymous_id, properties, updated_at
	)`)
	if err != nil {
		return err
	}
	for _, key := range order {
		state := states[key]
		if state.updatedAt.IsZero() {
			state.updatedAt = time.Now().UTC()
		}
		raw, err := json.Marshal(state.properties)
		if err != nil {
			return err
		}
		if err := batch.Append(
			key.projectID,
			key.distinctID,
			state.userID,
			state.anonymousID,
			string(raw),
			state.updatedAt,
		); err != nil {
			return err
		}
	}
	return batch.Send()
}

// Close 关闭连接
func (s *Sink) Close() error { return s.conn.Close() }

func pickStr(p map[string]interface{}, key, fallback string) string {
	if v, ok := p[key].(string); ok && v != "" {
		return v
	}
	return fallback
}

func pickU16(p map[string]interface{}, key string) uint16 {
	switch v := p[key].(type) {
	case float64:
		return uint16(v)
	case int:
		return uint16(v)
	case int64:
		return uint16(v)
	}
	return 0
}

type profileKey struct {
	projectID  uint32
	distinctID string
}

type profileState struct {
	properties  map[string]interface{}
	userID      string
	anonymousID string
	updatedAt   time.Time
}

func (s *Sink) loadProfile(ctx context.Context, projectID uint32, distinctID string) (map[string]interface{}, error) {
	var raw string
	err := s.conn.QueryRow(ctx, `
		SELECT properties
		FROM users FINAL
		WHERE project_id = ? AND distinct_id = ?
		ORDER BY updated_at DESC
		LIMIT 1
	`, projectID, distinctID).Scan(&raw)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return map[string]interface{}{}, nil
		}
		return nil, err
	}
	out := map[string]interface{}{}
	if raw == "" {
		return out, nil
	}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return map[string]interface{}{}, nil
	}
	return out, nil
}

func applyProfileEvent(dst map[string]interface{}, eventType model.EventType, props map[string]interface{}) {
	switch eventType {
	case model.EventTypeProfileDelete:
		for k := range dst {
			delete(dst, k)
		}
		return
	case model.EventTypeProfileUnset:
		for k := range props {
			if isProfileProperty(k) {
				delete(dst, k)
			}
		}
		return
	}

	for k, v := range props {
		if !isProfileProperty(k) {
			continue
		}
		switch eventType {
		case model.EventTypeProfileSet:
			dst[k] = v
		case model.EventTypeProfileSetOnce:
			if _, ok := dst[k]; !ok {
				dst[k] = v
			}
		case model.EventTypeProfileIncrement:
			dst[k] = addNumbers(dst[k], v)
		}
	}
}

func isProfileProperty(key string) bool {
	return key != "" && !strings.HasPrefix(key, "$")
}

func addNumbers(oldValue, delta interface{}) interface{} {
	ov, okOld := toFloat64(oldValue)
	dv, okDelta := toFloat64(delta)
	if !okDelta {
		return oldValue
	}
	if !okOld {
		return dv
	}
	return ov + dv
}

func toFloat64(v interface{}) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, !math.IsNaN(x) && !math.IsInf(x, 0)
	case float32:
		f := float64(x)
		return f, !math.IsNaN(f) && !math.IsInf(f, 0)
	case int:
		return float64(x), true
	case int8:
		return float64(x), true
	case int16:
		return float64(x), true
	case int32:
		return float64(x), true
	case int64:
		return float64(x), true
	case uint:
		return float64(x), true
	case uint8:
		return float64(x), true
	case uint16:
		return float64(x), true
	case uint32:
		return float64(x), true
	case uint64:
		return float64(x), true
	default:
		return 0, false
	}
}

func pickNonEmpty(v, fallback string) string {
	if v != "" {
		return v
	}
	return fallback
}

func eventTime(e *model.EnvelopedEvent) time.Time {
	if e.Event.Time > 0 {
		return time.UnixMilli(e.Event.Time).UTC()
	}
	if e.ReceivedAt > 0 {
		return time.UnixMilli(e.ReceivedAt).UTC()
	}
	return time.Now().UTC()
}

func maxTime(a, b time.Time) time.Time {
	if a.IsZero() || b.After(a) {
		return b
	}
	return a
}
