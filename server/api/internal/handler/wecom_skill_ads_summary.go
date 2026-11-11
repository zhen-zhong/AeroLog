package handler

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// executeAdsSummary 查询指定项目的广告事件汇总。
func (h *WeComBotHandler) executeAdsSummary(ctx context.Context, input wecomSkillInput) (gin.H, error) {
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
		if rows.Scan(&p.ID, &p.Name, &p.Timezone) == nil && strings.Contains(strings.ToLower(input.Question), strings.ToLower(p.Name)) {
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
	timeRange := input.Params.TimeRange
	if timeRange == "" && (strings.Contains(input.Question, "昨天") || strings.Contains(strings.ToLower(input.Question), "yesterday")) {
		timeRange = "yesterday"
	}
	switch timeRange {
	case "", "today":
		// 默认查询项目时区的当天数据，兼容未升级的调用方。
	case "yesterday":
		start = start.AddDate(0, 0, -1)
		now = start.Add(24 * time.Hour)
	case "last_hours":
		if input.Params.Hours < 1 || input.Params.Hours > 168 {
			return nil, errors.New("近几小时仅支持 1 到 168 小时")
		}
		start = now.Add(-time.Duration(input.Params.Hours) * time.Hour)
	default:
		return nil, errors.New("不支持的广告数据时间范围")
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
	return gin.H{"skill": "ads_summary", "project_name": p.Name, "timezone": p.Timezone, "time_range": timeRange, "hours": input.Params.Hours, "from": start.Format("2006-01-02 15:04:05 MST"), "to": now.Format("2006-01-02 15:04:05 MST"), "metric": "广告事件（事件名包含 ad）", "total_count": total, "events": events}, nil
}
