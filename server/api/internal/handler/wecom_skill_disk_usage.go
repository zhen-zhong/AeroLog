package handler

import (
	"context"
	"errors"
	"time"

	"github.com/gin-gonic/gin"
)

// executeDiskUsage 查询服务器挂载点使用率。
func (h *WeComBotHandler) executeDiskUsage(ctx context.Context, _ wecomSkillInput) (gin.H, error) {
	if h.Monitor == nil {
		return nil, errors.New("服务器监控不可用")
	}
	const query = `topk(10, 100 * (1 - node_filesystem_avail_bytes{job="aerolog-node",fstype!~"tmpfs|overlay|squashfs"} / node_filesystem_size_bytes{job="aerolog-node",fstype!~"tmpfs|overlay|squashfs"}))`
	values, err := h.Monitor.prometheusVector(ctx, query)
	if err != nil {
		return nil, errors.New("暂时无法读取磁盘空间")
	}
	mounts := make([]gin.H, 0, len(values))
	for _, value := range values {
		mounts = append(mounts, gin.H{"mountpoint": value.Metric["mountpoint"], "device": value.Metric["device"], "fstype": value.Metric["fstype"], "used_percent": value.Value})
	}
	return gin.H{"skill": "disk_usage", "checked_at": time.Now().In(time.FixedZone("UTC+8", 8*3600)).Format("2006-01-02 15:04:05 UTC+08:00"), "scope": "挂载点文件系统，不含目录级明细", "mounts": mounts}, nil
}
