package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// executeDirectoryUsage 查询只读主机巡检服务中的白名单目录占用。
func (h *WeComBotHandler) executeDirectoryUsage(ctx context.Context, _ wecomSkillInput) (gin.H, error) {
	if h.HostInspectorURL == "" || h.HostInspectorToken == "" {
		return nil, errors.New("目录巡检服务未配置")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, h.HostInspectorURL+"/v1/disk-usage", nil)
	if err != nil {
		return nil, errors.New("创建目录巡检请求失败")
	}
	req.Header.Set("X-AeroLog-Host-Inspector-Token", h.HostInspectorToken)
	resp, err := (&http.Client{Timeout: 25 * time.Second}).Do(req)
	if err != nil {
		return nil, errors.New("目录巡检服务不可用")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, errors.New("目录巡检服务返回异常")
	}
	var payload struct {
		CheckedAt   string `json:"checked_at"`
		Scope       string `json:"scope"`
		Directories []struct {
			Path      string `json:"path"`
			Bytes     int64  `json:"bytes"`
			Completed bool   `json:"completed"`
		} `json:"directories"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, errors.New("目录巡检数据无效")
	}
	directories := make([]gin.H, 0, len(payload.Directories))
	for _, item := range payload.Directories {
		directories = append(directories, gin.H{"path": item.Path, "bytes": item.Bytes, "completed": item.Completed})
	}
	return gin.H{"skill": "directory_usage", "checked_at": payload.CheckedAt, "scope": payload.Scope, "directories": directories}, nil
}
