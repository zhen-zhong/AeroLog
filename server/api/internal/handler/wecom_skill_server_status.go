package handler

import (
	"context"
	"errors"
	"time"

	"github.com/gin-gonic/gin"
)

// executeServerStatus 查询服务器资源及核心服务状态。
func (h *WeComBotHandler) executeServerStatus(ctx context.Context, _ wecomSkillInput) (gin.H, error) {
	if h.Monitor == nil {
		return nil, errors.New("服务器监控不可用")
	}
	metrics := gin.H{"skill": "server_status", "checked_at": time.Now().In(time.FixedZone("UTC+8", 8*3600)).Format("2006-01-02 15:04:05 UTC+08:00")}
	queries := map[string]string{
		"cpu_percent":    `100 * (1 - avg(rate(node_cpu_seconds_total{job="aerolog-node",mode="idle"}[5m])))`,
		"memory_percent": `100 * (1 - node_memory_MemAvailable_bytes{job="aerolog-node"} / node_memory_MemTotal_bytes{job="aerolog-node"})`,
		"disk_percent":   `100 * (1 - node_filesystem_avail_bytes{job="aerolog-node",mountpoint="/"} / node_filesystem_size_bytes{job="aerolog-node",mountpoint="/"})`,
		"api_up":         `up{job="aerolog-api"}`,
		"collector_up":   `up{job="aerolog-collector"}`,
	}
	for key, query := range queries {
		if value, err := h.Monitor.prometheusNumber(ctx, query); err == nil {
			metrics[key] = value
		} else {
			metrics[key] = "unavailable"
		}
	}
	return metrics, nil
}
