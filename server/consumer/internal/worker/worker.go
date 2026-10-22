// Package worker 负责 Kafka 消费 + 批处理 + 写 CH + DLQ
package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/IBM/sarama"
	"github.com/aerolog/server/pkg/metrics"
	"github.com/aerolog/server/pkg/model"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/aerolog/server/consumer/internal/chsink"
	"github.com/aerolog/server/consumer/internal/metadata"
)

var (
	mConsumed = metrics.Counter(
		"aerolog_consumer_messages_total",
		"消费的消息总数",
		"result", // ok / invalid
	)
	mFlushDuration = metrics.Histogram(
		"aerolog_consumer_flush_duration_seconds",
		"批量写 ClickHouse 耗时",
		"result",
	)
	mFlushBatchSize = metrics.Histogram(
		"aerolog_consumer_flush_batch_size",
		"每次 flush 的批大小",
	)
	mDLQ = metrics.Counter(
		"aerolog_consumer_dlq_total",
		"进入 DLQ 的消息总数",
	)
)

// Worker Kafka group consumer
type Worker struct {
	brokers      []string
	topic        string
	groupID      string
	dlqProjectID uint32
	batchSize    int
	batchMs      int
	writeTimeout time.Duration
	retryInitial time.Duration
	retryMax     time.Duration
	sink         *chsink.Sink
	meta         *metadata.Syncer
	pgPool       *pgxpool.Pool
	decode       DecodeFunc
}

// DecodeFunc converts an input Kafka record into AeroLog's internal envelope.
type DecodeFunc func([]byte) (*model.EnvelopedEvent, error)

// New 构造 Worker
func New(brokers []string, topic, group string, dlqProjectID uint32, batchSize, batchMs int, writeTimeout, retryInitial, retryMax time.Duration, sink *chsink.Sink, meta *metadata.Syncer, pg *pgxpool.Pool, decode DecodeFunc) *Worker {
	if decode == nil {
		decode = model.UnmarshalKafka
	}
	if batchSize < 1 {
		batchSize = 1
	}
	if batchMs < 1 {
		batchMs = 1000
	}
	if writeTimeout <= 0 {
		writeTimeout = 15 * time.Second
	}
	if retryInitial <= 0 {
		retryInitial = time.Second
	}
	if retryMax < retryInitial {
		retryMax = 30 * time.Second
	}
	return &Worker{
		brokers: brokers, topic: topic, groupID: group, dlqProjectID: dlqProjectID,
		batchSize: batchSize, batchMs: batchMs,
		writeTimeout: writeTimeout, retryInitial: retryInitial, retryMax: retryMax,
		sink: sink, meta: meta, pgPool: pg, decode: decode,
	}
}

// Run 阻塞运行直到 ctx 结束
func (w *Worker) Run(ctx context.Context) error {
	cfg := sarama.NewConfig()
	cfg.Version = sarama.V2_2_0_0 // 兼容 Redpanda v24.1，封顶 Metadata API v7
	cfg.Consumer.Offsets.Initial = sarama.OffsetOldest
	cfg.Consumer.Group.Rebalance.GroupStrategies = []sarama.BalanceStrategy{sarama.NewBalanceStrategyRange()}

	cg, err := sarama.NewConsumerGroup(w.brokers, w.groupID, cfg)
	if err != nil {
		return err
	}
	defer cg.Close()

	h := &handler{w: w}

	for {
		if err := cg.Consume(ctx, []string{w.topic}, h); err != nil {
			log.Printf("consume err: %v", err)
			time.Sleep(time.Second)
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
	}
}

type handler struct {
	w *Worker
}

func (h *handler) Setup(_ sarama.ConsumerGroupSession) error   { return nil }
func (h *handler) Cleanup(_ sarama.ConsumerGroupSession) error { return nil }

func (h *handler) ConsumeClaim(sess sarama.ConsumerGroupSession, claim sarama.ConsumerGroupClaim) error {
	batch := make([]*model.EnvelopedEvent, 0, h.w.batchSize)
	var lastMsg *sarama.ConsumerMessage

	flush := func() bool {
		if len(batch) == 0 {
			return true
		}
		n := len(batch)
		for attempt := 0; ; attempt++ {
			start := time.Now()
			ctx, cancel := context.WithTimeout(sess.Context(), h.w.writeTimeout)
			err := h.w.flushBatch(ctx, batch)
			cancel()
			if err == nil {
				mFlushDuration.WithLabelValues("ok").Observe(time.Since(start).Seconds())
				mFlushBatchSize.WithLabelValues().Observe(float64(n))
				if lastMsg != nil {
					sess.MarkMessage(lastMsg, "")
				}
				batch = batch[:0]
				lastMsg = nil
				return true
			}

			mFlushDuration.WithLabelValues("error").Observe(time.Since(start).Seconds())
			log.Printf("flush batch err: %v; retaining %d Kafka messages for retry", err, n)
			delay := retryDelay(attempt, h.w.retryInitial, h.w.retryMax)
			select {
			case <-time.After(delay):
			case <-sess.Context().Done():
				return false
			}
		}
	}

	ticker := time.NewTicker(time.Duration(h.w.batchMs) * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case msg, ok := <-claim.Messages():
			if !ok {
				flush()
				return nil
			}
			env, err := h.w.decode(msg.Value)
			if err != nil {
				// Do not commit an invalid record until its original payload has
				// reached the DLQ. Otherwise a source schema change can silently
				// discard Sensors Data records.
				if dlqErr := h.w.toDLQ(sess.Context(), h.w.dlqProjectID, msg.Value, fmt.Sprintf("decode input: %v", err)); dlqErr != nil {
					return fmt.Errorf("save invalid message to DLQ: %w", dlqErr)
				}
				mConsumed.WithLabelValues("invalid").Inc()
				log.Printf("invalid msg stored in DLQ: %v", err)
				sess.MarkMessage(msg, "")
				continue
			}
			mConsumed.WithLabelValues("ok").Inc()
			batch = append(batch, env)
			lastMsg = msg
			full := len(batch) >= h.w.batchSize
			if full {
				flush()
			}
		case <-ticker.C:
			flush()
		case <-sess.Context().Done():
			flush()
			return nil
		}
	}
}

func retryDelay(attempt int, initial, max time.Duration) time.Duration {
	if attempt <= 0 {
		return initial
	}
	delay := initial
	for i := 0; i < attempt && delay < max; i++ {
		delay *= 2
		if delay > max {
			return max
		}
	}
	return delay
}

func (w *Worker) flushBatch(ctx context.Context, batch []*model.EnvelopedEvent) error {
	if len(batch) == 0 {
		return nil
	}
	if w.meta != nil {
		if err := w.meta.Sync(ctx, batch); err != nil {
			return err
		}
	}

	tracks := make([]*model.EnvelopedEvent, 0, len(batch))
	profiles := make([]*model.EnvelopedEvent, 0)
	for _, e := range batch {
		if e == nil {
			continue
		}
		switch e.Event.Type {
		case model.EventTypeTrack:
			tracks = append(tracks, e)
		case model.EventTypeProfileSet,
			model.EventTypeProfileSetOnce,
			model.EventTypeProfileIncrement,
			model.EventTypeProfileUnset,
			model.EventTypeProfileDelete:
			profiles = append(profiles, e)
		}
	}
	if err := w.sink.WriteBatch(ctx, tracks); err != nil {
		return err
	}
	if err := w.sink.WriteObservedUsers(ctx, tracks); err != nil {
		return err
	}
	if err := w.sink.WriteProfiles(ctx, profiles); err != nil {
		return err
	}
	return nil
}

// toDLQ stores an original Kafka payload in Postgres before its offset is committed.
// The wrapper keeps malformed JSON representable in the JSONB payload column.
func (w *Worker) toDLQ(ctx context.Context, projectID uint32, payload []byte, reason string) error {
	if w.pgPool == nil {
		return fmt.Errorf("DLQ is unavailable: Postgres pool is nil")
	}
	raw, err := encodeDLQPayload(payload)
	if err != nil {
		return fmt.Errorf("encode DLQ payload: %w", err)
	}
	_, err = w.pgPool.Exec(ctx,
		`INSERT INTO event_dlq(project_id, payload, reason) VALUES($1, $2, $3)`,
		projectID, raw, reason)
	if err != nil {
		return err
	}
	mDLQ.WithLabelValues().Inc()
	return nil
}

func encodeDLQPayload(payload []byte) ([]byte, error) {
	return json.Marshal(map[string]string{"raw_message": string(payload)})
}
