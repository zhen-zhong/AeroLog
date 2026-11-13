package handler

import (
	"context"
	"errors"
	"strings"

	"github.com/gin-gonic/gin"
)

// executeEventMetrics 查询指定事件的总次数和去重用户数。
func (h *WeComBotHandler) executeEventMetrics(ctx context.Context, input wecomSkillInput) (gin.H, error) {
	project, err := h.wecomProjectForQuestion(ctx, input.Question)
	if err != nil {
		return nil, err
	}
	known, err := h.wecomKnownEvents(ctx, project.ID)
	if err != nil {
		return nil, err
	}
	events, err := resolveWecomEvents(input.Question, input.Params.Events, known, 1, 10)
	if err != nil {
		return nil, err
	}
	start, end, err := wecomDaysRange(project, input.Params.Days)
	if err != nil {
		return nil, err
	}
	rows, err := h.CH.Query(ctx, `
		SELECT event, count() AS count, uniqExact(distinct_id) AS users
		FROM events
		WHERE project_id=? AND event IN (?) AND time >= ? AND time < ?
		GROUP BY event ORDER BY count DESC`, project.ID, events, start.UTC(), end.UTC())
	if err != nil {
		return nil, errors.New("查询事件指标失败")
	}
	defer rows.Close()
	metrics := make([]wecomBotEvent, 0, len(events))
	for rows.Next() {
		var item wecomBotEvent
		if err := rows.Scan(&item.Event, &item.Count, &item.Users); err != nil {
			return nil, errors.New("读取事件指标失败")
		}
		metrics = append(metrics, item)
	}
	if err := rows.Err(); err != nil {
		return nil, errors.New("读取事件指标失败")
	}
	return gin.H{"skill": "event_metrics", "project_name": project.Name, "timezone": project.Timezone, "from": start.Format("2006-01-02 15:04:05 MST"), "to": end.Format("2006-01-02 15:04:05 MST"), "events": metrics}, nil
}

func normalizeWecomEventParams(params wecomBotSkillParams) wecomBotSkillParams {
	params.Events = compactWecomStrings(params.Events, 10)
	return params
}

func compactWecomStrings(values []string, max int) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" && len([]rune(value)) <= 128 {
			out = append(out, value)
		}
		if len(out) == max {
			break
		}
	}
	return out
}
