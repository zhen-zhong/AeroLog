// Package worker 负责 Kafka 消费 + 批处理 + 写 CH + DLQ
package worker

import (
	"context"
	"encoding/json"
	"log"
	"sync"
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
	brokers   []string
	topic     string
	groupID   string
	batchSize int
	batchMs   int
	sink      *chsink.Sink
	meta      *metadata.Syncer
	pgPool    *pgxpool.Pool
}

// New 构造 Worker
func New(brokers []string, topic, group string, batchSize, batchMs int, sink *chsink.Sink, meta *metadata.Syncer, pg *pgxpool.Pool) *Worker {
	return &Worker{
		brokers: brokers, topic: topic, groupID: group,
		batchSize: batchSize, batchMs: batchMs, sink: sink, meta: meta, pgPool: pg,
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
	var mu sync.Mutex

	flush := func() {
		mu.Lock()
		defer mu.Unlock()
		if len(batch) == 0 {
			return
		}
		start := time.Now()
		n := len(batch)
		ctx, cancel := context.WithTimeout(sess.Context(), 5*time.Second)
		defer cancel()
		result := "ok"
		if err := h.w.flushBatch(ctx, batch); err != nil {
			result = "error"
			log.Printf("flush batch err: %v", err)
			h.w.toDLQ(ctx, batch, err.Error())
		}
		mFlushDuration.WithLabelValues(result).Observe(time.Since(start).Seconds())
		mFlushBatchSize.WithLabelValues().Observe(float64(n))
		if lastMsg != nil {
			sess.MarkMessage(lastMsg, "")
		}
		batch = batch[:0]
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
			env, err := model.UnmarshalKafka(msg.Value)
			if err != nil {
				mConsumed.WithLabelValues("invalid").Inc()
				log.Printf("invalid msg, drop: %v", err)
				sess.MarkMessage(msg, "")
				continue
			}
			mConsumed.WithLabelValues("ok").Inc()
			mu.Lock()
			batch = append(batch, env)
			lastMsg = msg
			full := len(batch) >= h.w.batchSize
			mu.Unlock()
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
	if err := w.sink.WriteProfiles(ctx, profiles); err != nil {
		return err
	}
	return nil
}

// toDLQ 落到 Postgres event_dlq 表
func (w *Worker) toDLQ(ctx context.Context, batch []*model.EnvelopedEvent, reason string) {
	if w.pgPool == nil {
		return
	}
	for _, e := range batch {
		raw, _ := json.Marshal(e)
		_, err := w.pgPool.Exec(ctx,
			`INSERT INTO event_dlq(project_id, payload, reason) VALUES($1, $2, $3)`,
			e.ProjectID, raw, reason)
		if err != nil {
			log.Printf("dlq insert err: %v", err)
			continue
		}
		mDLQ.WithLabelValues().Inc()
	}
}
