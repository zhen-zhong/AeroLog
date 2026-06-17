// Package model 定义 SDK 上报与服务端流转的统一事件结构。
package model

import (
	"encoding/json"
	"errors"
)

// EventType 上报事件类型
type EventType string

const (
	EventTypeTrack            EventType = "track"
	EventTypeProfileSet       EventType = "profile_set"
	EventTypeProfileSetOnce   EventType = "profile_set_once"
	EventTypeProfileIncrement EventType = "profile_increment"
	EventTypeProfileUnset     EventType = "profile_unset"
	EventTypeProfileDelete    EventType = "profile_delete"
)

// Lib SDK 标识
type Lib struct {
	Name    string `json:"name"`
	Version string `json:"version,omitempty"`
}

// Event SDK 上报到 Collector 的原始事件
type Event struct {
	Type        EventType              `json:"type"`
	Event       string                 `json:"event"`
	DistinctID  string                 `json:"distinct_id"`
	AnonymousID string                 `json:"anonymous_id,omitempty"`
	UserID      string                 `json:"user_id,omitempty"`
	Time        int64                  `json:"time"`
	Lib         Lib                    `json:"lib"`
	Properties  map[string]interface{} `json:"properties,omitempty"`
}

// Validate 进行最基础的字段校验；详细校验放在 Consumer。
func (e *Event) Validate() error {
	if e.Type == "" {
		return errors.New("type is required")
	}
	if e.Type == EventTypeTrack && e.Event == "" {
		return errors.New("event is required for track")
	}
	if e.DistinctID == "" {
		return errors.New("distinct_id is required")
	}
	if e.Time <= 0 {
		return errors.New("time is required")
	}
	if len(e.DistinctID) > 255 {
		return errors.New("distinct_id too long")
	}
	if len(e.Event) > 128 {
		return errors.New("event too long")
	}
	return nil
}

// EnvelopedEvent Collector → Kafka 的事件（包装上下文，避免 Consumer 再解析 HTTP 头）。
type EnvelopedEvent struct {
	ProjectID  uint32 `json:"project_id"`
	IP         string `json:"ip,omitempty"`
	UserAgent  string `json:"ua,omitempty"`
	ReceivedAt int64  `json:"received_at"`
	Event      Event  `json:"event"`
}

// MarshalKafka 序列化 EnvelopedEvent 为 Kafka 消息体。
func (e *EnvelopedEvent) MarshalKafka() ([]byte, error) {
	return json.Marshal(e)
}

// UnmarshalKafka 反序列化 Kafka 消息体。
func UnmarshalKafka(data []byte) (*EnvelopedEvent, error) {
	var e EnvelopedEvent
	if err := json.Unmarshal(data, &e); err != nil {
		return nil, err
	}
	return &e, nil
}
