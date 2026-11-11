package handler

import (
	"context"
	"errors"
	"time"

	"github.com/gin-gonic/gin"
)

// executeKafkaStatus 查询 Kafka 消费者、积压及死信队列。
func (h *WeComBotHandler) executeKafkaStatus(ctx context.Context, _ wecomSkillInput) (gin.H, error) {
	if h.Monitor == nil {
		return nil, errors.New("Kafka 监控不可用")
	}
	queue := h.Monitor.sharedQueueHealth(ctx)
	return gin.H{"skill": "kafka_status", "checked_at": time.Now().In(time.FixedZone("UTC+8", 8*3600)).Format("2006-01-02 15:04:05 UTC+08:00"), "available": queue.Available, "consumers_up": queue.ConsumersUp, "kafka_lag": queue.KafkaLag, "dlq_last_hour": queue.DLQLastHour, "error": queue.Error}, nil
}
