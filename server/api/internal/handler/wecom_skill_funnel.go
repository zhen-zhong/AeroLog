package handler

import (
	"context"
	"errors"

	"github.com/gin-gonic/gin"
)

// executeFunnelSummary 按固定时间窗计算已登记事件组成的顺序漏斗。
func (h *WeComBotHandler) executeFunnelSummary(ctx context.Context, input wecomSkillInput) (gin.H, error) {
	if h.Analytics == nil {
		return nil, errors.New("分析服务未配置")
	}
	project, err := h.wecomProjectForQuestion(ctx, input.Question)
	if err != nil {
		return nil, err
	}
	known, err := h.wecomKnownEvents(ctx, project.ID)
	if err != nil {
		return nil, err
	}
	events, err := resolveWecomEvents(input.Question, input.Params.Events, known, 2, 5)
	if err != nil {
		return nil, errors.New("漏斗需提供 2 到 5 个已存在的事件名称")
	}
	start, end, err := wecomDaysRange(project, input.Params.Days)
	if err != nil {
		return nil, err
	}
	windowHours := input.Params.WindowHours
	if windowHours == 0 {
		windowHours = 24
	}
	if windowHours < 1 || windowHours > 168 {
		return nil, errors.New("漏斗窗口仅支持 1 到 168 小时")
	}
	stepsInput := make([]funnelInputStep, 0, len(events))
	for _, event := range events {
		stepsInput = append(stepsInput, funnelInputStep{Event: event})
	}
	steps, err := h.Analytics.computeFunnel(ctx, project.ID, stepsInput, start.UnixMilli(), end.UnixMilli(), int64(windowHours*3600))
	if err != nil {
		return nil, errors.New("查询漏斗失败")
	}
	return gin.H{"skill": "funnel_summary", "project_name": project.Name, "timezone": project.Timezone, "from": start.Format("2006-01-02 15:04:05 MST"), "to": end.Format("2006-01-02 15:04:05 MST"), "window_hours": windowHours, "steps": steps}, nil
}
