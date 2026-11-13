package handler

import (
	"context"
	"errors"
	"strings"

	"github.com/gin-gonic/gin"
)

type wecomPropertyBreakdownRow struct {
	Value string `json:"value"`
	Count uint64 `json:"count"`
	Users uint64 `json:"users"`
}

// executeEventPropertyBreakdown 按已登记的事件属性统计取值分布。
func (h *WeComBotHandler) executeEventPropertyBreakdown(ctx context.Context, input wecomSkillInput) (gin.H, error) {
	project, err := h.wecomProjectForQuestion(ctx, input.Question)
	if err != nil {
		return nil, err
	}
	known, err := h.wecomKnownEvents(ctx, project.ID)
	if err != nil {
		return nil, err
	}
	eventInput := input.Params.Event
	if eventInput == "" && len(input.Params.Events) == 1 {
		eventInput = input.Params.Events[0]
	}
	events, err := resolveWecomEvents(input.Question, []string{eventInput}, known, 1, 1)
	if err != nil {
		return nil, err
	}
	event := events[0]
	property, err := h.resolveWecomEventProperty(ctx, project.ID, event, input.Params.Property, input.Question)
	if err != nil {
		return nil, err
	}
	start, end, err := wecomDaysRange(project, input.Params.Days)
	if err != nil {
		return nil, err
	}
	rows, err := h.CH.Query(ctx, `
		SELECT if(JSONExtractRaw(properties, ?)='', '(未设置)', JSONExtractRaw(properties, ?)) AS value,
		       count() AS count, uniqExact(distinct_id) AS users
		FROM events
		WHERE project_id=? AND event=? AND time >= ? AND time < ?
		GROUP BY value ORDER BY count DESC LIMIT 20`, property, property, project.ID, event, start.UTC(), end.UTC())
	if err != nil {
		return nil, errors.New("查询事件属性拆解失败")
	}
	defer rows.Close()
	items := make([]wecomPropertyBreakdownRow, 0)
	for rows.Next() {
		var item wecomPropertyBreakdownRow
		if err := rows.Scan(&item.Value, &item.Count, &item.Users); err != nil {
			return nil, errors.New("读取事件属性拆解失败")
		}
		item.Value = strings.Trim(item.Value, `"`)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, errors.New("读取事件属性拆解失败")
	}
	return gin.H{"skill": "event_property_breakdown", "project_name": project.Name, "timezone": project.Timezone, "event": event, "property": property, "from": start.Format("2006-01-02 15:04:05 MST"), "to": end.Format("2006-01-02 15:04:05 MST"), "values": items}, nil
}
