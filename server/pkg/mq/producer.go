// Package mq 提供 Kafka 生产者/消费者的薄封装。
package mq

import (
	"context"
	"errors"
	"time"

	"github.com/IBM/sarama"
)

// Producer 异步批量生产
type Producer struct {
	p sarama.AsyncProducer
}

// NewProducer 创建一个异步生产者，已启用 Snappy 压缩与重试。
func NewProducer(brokers []string) (*Producer, error) {
	cfg := sarama.NewConfig()
	cfg.Version = sarama.V2_2_0_0 // 兼容 Redpanda v24.1，封顶 Metadata API v7
	cfg.Producer.RequiredAcks = sarama.WaitForLocal
	cfg.Producer.Compression = sarama.CompressionSnappy
	cfg.Producer.Flush.Frequency = 50 * time.Millisecond
	cfg.Producer.Flush.Messages = 200
	cfg.Producer.Retry.Max = 5
	cfg.Producer.Return.Errors = true
	cfg.Producer.Return.Successes = false

	p, err := sarama.NewAsyncProducer(brokers, cfg)
	if err != nil {
		return nil, err
	}
	// 异步消费 errors，避免内部 channel 阻塞
	go func() {
		for e := range p.Errors() {
			_ = e // TODO: 接入 logger / metrics
		}
	}()
	return &Producer{p: p}, nil
}

// Send 非阻塞发送
func (p *Producer) Send(ctx context.Context, topic string, key, value []byte) error {
	if p == nil || p.p == nil {
		return errors.New("producer not initialized")
	}
	msg := &sarama.ProducerMessage{
		Topic: topic,
		Value: sarama.ByteEncoder(value),
	}
	if key != nil {
		msg.Key = sarama.ByteEncoder(key)
	}
	select {
	case p.p.Input() <- msg:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Close 关闭生产者
func (p *Producer) Close() error {
	if p == nil || p.p == nil {
		return nil
	}
	return p.p.Close()
}
