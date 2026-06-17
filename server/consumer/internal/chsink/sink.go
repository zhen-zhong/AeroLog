// Package chsink 负责把 EnvelopedEvent 批量写入 ClickHouse events_buffer
package chsink

import (
	"context"
	"encoding/json"
	"net"
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
