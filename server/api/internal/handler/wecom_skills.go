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

// WeComSkillDefinition 是固定只读机器人能力的元数据。
// 新增 Skill 在此注册，无需修改消息传输层。
type WeComSkillDefinition struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Aliases     []string `json:"aliases"`
}

type wecomSkill struct {
	definition WeComSkillDefinition
	match      func(question string) bool
	execute    func(ctx context.Context, question string) (gin.H, error)
}

func (h *WeComBotHandler) registeredSkills() []wecomSkill {
	return []wecomSkill{
		{definition: WeComSkillDefinition{Name: "directory_usage", Description: "查询服务器白名单目录的占用空间", Aliases: []string{"目录", "哪些占用", "占用空间"}}, match: matchesAny("目录", "哪些占用", "占用空间"), execute: h.executeDirectoryUsage},
		{definition: WeComSkillDefinition{Name: "disk_usage", Description: "查询服务器各挂载点磁盘空间占用", Aliases: []string{"磁盘", "磁碟", "空间占用", "磁盘占用"}}, match: matchesAny("磁盘", "磁碟", "空间占用", "磁盘占用"), execute: h.executeDiskUsage},
		{definition: WeComSkillDefinition{Name: "server_status", Description: "查询服务器资源和核心服务存活状态", Aliases: []string{"服务器", "主机", "server"}}, match: matchesAny("服务器", "主机", "server"), execute: h.executeServerStatus},
		{definition: WeComSkillDefinition{Name: "kafka_status", Description: "查询神策 Kafka 消费者、lag 和死信队列", Aliases: []string{"kafka", "消息队列", "积压", "dlq"}}, match: matchesAny("kafka", "消息队列", "积压", "dlq"), execute: h.executeKafkaStatus},
		{definition: WeComSkillDefinition{Name: "ads_summary", Description: "查询项目当天或昨天广告事件汇总", Aliases: []string{"广告", "ad_show", "广告数据"}}, match: matchesAny("广告", "ad_show", "广告数据"), execute: h.executeAdsSummary},
	}
}

func (h *WeComBotHandler) executeDirectoryUsage(ctx context.Context, _ string) (gin.H, error) {
	if h.HostInspectorURL == "" || h.HostInspectorToken == "" {
		return nil, errors.New("目录巡检服务未配置")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, h.HostInspectorURL+"/v1/disk-usage", nil)
	if err != nil {
		return nil, errors.New("创建目录巡检请求失败")
	}
	req.Header.Set("X-AeroLog-Host-Inspector-Token", h.HostInspectorToken)
	client := &http.Client{Timeout: 25 * time.Second}
	resp, err := client.Do(req)
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

func matchesAny(words ...string) func(string) bool {
	return func(question string) bool {
		lower := strings.ToLower(question)
		for _, word := range words {
			if strings.Contains(lower, strings.ToLower(word)) {
				return true
			}
		}
		return false
	}
}

func (h *WeComBotHandler) executeSkill(ctx context.Context, question string) (gin.H, error) {
	for _, skill := range h.registeredSkills() {
		if skill.match(question) {
			return skill.execute(ctx, question)
		}
	}
	return nil, errors.New("未匹配可用 Skill；可查询服务器状态、Kafka 状态或项目广告数据")
}

func (h *WeComBotHandler) executeServerStatus(ctx context.Context, _ string) (gin.H, error) {
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

func (h *WeComBotHandler) executeDiskUsage(ctx context.Context, _ string) (gin.H, error) {
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
		mounts = append(mounts, gin.H{
			"mountpoint":   value.Metric["mountpoint"],
			"device":       value.Metric["device"],
			"fstype":       value.Metric["fstype"],
			"used_percent": value.Value,
		})
	}
	return gin.H{
		"skill":      "disk_usage",
		"checked_at": time.Now().In(time.FixedZone("UTC+8", 8*3600)).Format("2006-01-02 15:04:05 UTC+08:00"),
		"scope":      "挂载点文件系统，不含目录级明细",
		"mounts":     mounts,
	}, nil
}

func (h *WeComBotHandler) executeKafkaStatus(ctx context.Context, _ string) (gin.H, error) {
	if h.Monitor == nil {
		return nil, errors.New("Kafka 监控不可用")
	}
	queue := h.Monitor.sharedQueueHealth(ctx)
	return gin.H{
		"skill":         "kafka_status",
		"checked_at":    time.Now().In(time.FixedZone("UTC+8", 8*3600)).Format("2006-01-02 15:04:05 UTC+08:00"),
		"available":     queue.Available,
		"consumers_up":  queue.ConsumersUp,
		"kafka_lag":     queue.KafkaLag,
		"dlq_last_hour": queue.DLQLastHour,
		"error":         queue.Error,
	}, nil
}

func (h *WeComBotHandler) executeAdsSummary(ctx context.Context, question string) (gin.H, error) {
	type project struct {
		ID       uint32
		Name     string
		Timezone string
	}
	rows, err := h.PG.Query(ctx, `SELECT id, name, COALESCE(timezone, 'Asia/Shanghai') FROM projects ORDER BY id`)
	if err != nil {
		return nil, errors.New("读取项目失败")
	}
	defer rows.Close()
	var matched []project
	for rows.Next() {
		var p project
		if rows.Scan(&p.ID, &p.Name, &p.Timezone) == nil && strings.Contains(strings.ToLower(question), strings.ToLower(p.Name)) {
			matched = append(matched, p)
		}
	}
	if len(matched) != 1 {
		return nil, errors.New("广告数据需包含唯一项目名称")
	}
	p := matched[0]
	loc := time.FixedZone("UTC+8", 8*3600)
	if p.Timezone == "UTC" {
		loc = time.UTC
	}
	now := time.Now().In(loc)
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	if strings.Contains(question, "昨天") || strings.Contains(strings.ToLower(question), "yesterday") {
		start = start.AddDate(0, 0, -1)
		now = start.Add(24 * time.Hour)
	}
	const query = `SELECT event, count() AS c, uniqExact(distinct_id) AS u FROM events WHERE project_id = ? AND time >= ? AND time < ? AND lower(event) LIKE '%ad%' GROUP BY event ORDER BY c DESC LIMIT 20`
	result, err := h.CH.Query(ctx, query, p.ID, start.UTC(), now.UTC())
	if err != nil {
		return nil, errors.New("查询广告数据失败")
	}
	defer result.Close()
	events := make([]wecomBotEvent, 0)
	var total uint64
	for result.Next() {
		var item wecomBotEvent
		if result.Scan(&item.Event, &item.Count, &item.Users) == nil {
			total += item.Count
			events = append(events, item)
		}
	}
	return gin.H{"skill": "ads_summary", "project_name": p.Name, "timezone": p.Timezone, "from": start.Format("2006-01-02 15:04:05 MST"), "to": now.Format("2006-01-02 15:04:05 MST"), "metric": "广告事件（事件名包含 ad）", "total_count": total, "events": events}, nil
}
