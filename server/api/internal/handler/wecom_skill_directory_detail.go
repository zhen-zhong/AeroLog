package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

var directoryDetailAliases = []struct {
	path    string
	aliases []string
}{
	{path: "/var/lib/aerolog", aliases: []string{"/var/lib/aerolog", "var/lib/aerolog"}},
	{path: "/var/lib/docker", aliases: []string{"/var/lib/docker", "var/lib/docker", "docker目录"}},
	{path: "/var/cache", aliases: []string{"/var/cache", "var/cache"}},
	{path: "/var/log", aliases: []string{"/var/log", "var/log"}},
	{path: "/opt", aliases: []string{"/opt", "opt目录"}},
	{path: "/usr", aliases: []string{"/usr", "usr目录", "usr 目录"}},
	{path: "/home", aliases: []string{"/home", "home目录"}},
	{path: "/tmp", aliases: []string{"/tmp", "tmp目录"}},
}

// executeDirectoryUsageDetail 只查询固定白名单目录的一级子项，不能由问题传入任意路径。
func (h *WeComBotHandler) executeDirectoryUsageDetail(ctx context.Context, input wecomSkillInput) (gin.H, error) {
	if h.HostInspectorURL == "" || h.HostInspectorToken == "" {
		return nil, errors.New("目录巡检服务未配置")
	}
	path, err := requestedDirectoryDetailPath(input.Question)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, h.HostInspectorURL+"/v1/directory-usage?path="+path, nil)
	if err != nil {
		return nil, errors.New("创建目录明细请求失败")
	}
	req.Header.Set("X-AeroLog-Host-Inspector-Token", h.HostInspectorToken)
	resp, err := (&http.Client{Timeout: 25 * time.Second}).Do(req)
	if err != nil {
		return nil, errors.New("目录巡检服务不可用")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, errors.New("目录明细服务返回异常")
	}
	var payload struct {
		CheckedAt   string `json:"checked_at"`
		Path        string `json:"path"`
		Scope       string `json:"scope"`
		Directories []struct {
			Path      string `json:"path"`
			Bytes     int64  `json:"bytes"`
			Completed bool   `json:"completed"`
		} `json:"directories"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, errors.New("目录明细数据无效")
	}
	directories := make([]gin.H, 0, len(payload.Directories))
	for _, item := range payload.Directories {
		directories = append(directories, gin.H{"path": item.Path, "bytes": item.Bytes, "completed": item.Completed})
	}
	return gin.H{"skill": "directory_usage_detail", "checked_at": payload.CheckedAt, "path": payload.Path, "scope": payload.Scope, "directories": directories}, nil
}

func requestedDirectoryDetailPath(question string) (string, error) {
	lower := strings.ToLower(question)
	for _, item := range directoryDetailAliases {
		for _, alias := range item.aliases {
			if strings.Contains(lower, alias) {
				return item.path, nil
			}
		}
	}
	return "", errors.New("目录明细仅支持 /usr、/opt、/var/lib/docker、/var/lib/aerolog、/var/log、/var/cache、/tmp、/home")
}
