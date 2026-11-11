package handler

import (
	"context"
	"fmt"
	"log"
	"time"
)

const (
	serverDiskAlertPercent   = 85
	serverMemoryAlertPercent = 85
	kafkaLagAlertThreshold   = 1000
)

// StartOperationalAlertMonitor monitors host metrics and shared Sensors Kafka
// pipeline state. Notifications fire only on failure/recovery transitions.
func (h *DataQualityHandler) StartOperationalAlertMonitor(ctx context.Context) {
	if h.WeComWebhookURL == "" || h.PrometheusURL == "" {
		return
	}
	go func() {
		run := func() {
			checkCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
			defer cancel()
			h.checkOperationalAlerts(checkCtx)
		}
		run()
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				run()
			case <-ctx.Done():
				return
			}
		}
	}()
}

func (h *DataQualityHandler) checkOperationalAlerts(ctx context.Context) {
	if disk, err := h.prometheusNumber(ctx, `100 * (1 - node_filesystem_avail_bytes{job="aerolog-node",mountpoint="/"} / node_filesystem_size_bytes{job="aerolog-node",mountpoint="/"})`); err == nil {
		h.transitionWeComAlert(ctx, "server-disk", disk >= serverDiskAlertPercent, "服务器磁盘告警", fmt.Sprintf("根分区使用率：%.1f%%", disk), fmt.Sprintf("阈值：%d%%", serverDiskAlertPercent))
	}
	if memory, err := h.prometheusNumber(ctx, `100 * (1 - node_memory_MemAvailable_bytes{job="aerolog-node"} / node_memory_MemTotal_bytes{job="aerolog-node"})`); err == nil {
		h.transitionWeComAlert(ctx, "server-memory", memory >= serverMemoryAlertPercent, "服务器内存告警", fmt.Sprintf("内存使用率：%.1f%%", memory), fmt.Sprintf("阈值：%d%%", serverMemoryAlertPercent))
	}
	queue := h.sharedQueueHealth(ctx)
	h.transitionWeComAlert(ctx, "kafka-monitor", !queue.Available, "Kafka 监控异常", queue.Error)
	if !queue.Available {
		return
	}
	h.transitionWeComAlert(ctx, "kafka-consumer", !queue.ConsumersUp, "Kafka 消费者异常", "神策事件或用户属性消费者不可用")
	h.transitionWeComAlert(ctx, "kafka-lag", queue.KafkaLag > kafkaLagAlertThreshold, "Kafka 积压告警", fmt.Sprintf("当前 lag：%.0f", queue.KafkaLag), fmt.Sprintf("阈值：%d", kafkaLagAlertThreshold))
	h.transitionWeComAlert(ctx, "kafka-dlq", queue.DLQLastHour > 0, "Kafka 死信告警", fmt.Sprintf("近 1 小时 DLQ：%d", queue.DLQLastHour))
}

func (h *DataQualityHandler) transitionWeComAlert(ctx context.Context, key string, active bool, title string, lines ...string) {
	h.alertMu.Lock()
	previous, known := h.alertStates[key]
	if h.alertStates == nil {
		h.alertStates = map[string]bool{}
	}
	h.alertStates[key] = active
	h.alertMu.Unlock()
	if known && previous == active || !known && !active {
		return
	}
	if !active {
		title = title + "已恢复"
		lines = []string{"监控指标已恢复正常"}
	}
	notifyCtx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	if err := h.sendWeComAlert(notifyCtx, "AeroLog "+title, lines); err != nil {
		log.Printf("send WeCom operational alert key=%s err: %v", key, err)
	}
}
