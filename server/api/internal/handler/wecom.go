package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const weComWebhookHost = "qyapi.weixin.qq.com"

func (h *DataQualityHandler) sendWeComAlert(ctx context.Context, title string, lines []string) error {
	rawURL := strings.TrimSpace(h.WeComWebhookURL)
	if rawURL == "" {
		return errors.New("未配置企业微信机器人")
	}
	u, err := url.Parse(rawURL)
	if err != nil || u.Scheme != "https" || !strings.EqualFold(u.Hostname(), weComWebhookHost) || u.Path != "/cgi-bin/webhook/send" || u.Query().Get("key") == "" {
		return errors.New("企业微信机器人地址无效")
	}
	content := "## " + title
	for _, line := range lines {
		if text := strings.TrimSpace(line); text != "" {
			content += "\n> " + text
		}
	}
	payload, _ := json.Marshal(map[string]any{"msgtype": "markdown", "markdown": map[string]string{"content": content}})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	var result struct {
		ErrCode int    `json:"errcode"`
		ErrMsg  string `json:"errmsg"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&result); err != nil {
		return err
	}
	if result.ErrCode != 0 {
		return fmt.Errorf("errcode %d", result.ErrCode)
	}
	return nil
}
