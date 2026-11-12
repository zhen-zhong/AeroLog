package handler

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
)

// executeRetentionTrend 使用留存页相同的 $AppStart 同期与回访口径生成 DayN 留存趋势。
func (h *WeComBotHandler) executeRetentionTrend(ctx context.Context, input wecomSkillInput) (gin.H, error) {
	if h.Analytics == nil {
		return nil, errors.New("分析服务未配置")
	}
	p, err := h.wecomProjectForQuestion(ctx, input.Question)
	if err != nil {
		return nil, err
	}
	days, err := wecomTrendDays(input.Params.Days)
	if err != nil {
		return nil, err
	}
	loc := wecomProjectLocation(p.Timezone)
	now := time.Now().In(loc)
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc).AddDate(0, 0, -(days - 1))
	rows, err := h.Analytics.computeRetention(ctx, p.ID, clickHouseTimezone(p.Timezone), "$AppStart", "$AppStart", start.UnixMilli(), now.UnixMilli(), days)
	if err != nil {
		return nil, errors.New("查询留存趋势失败")
	}
	var users uint64
	counts := make([]uint64, days)
	for _, row := range rows {
		users += row.Size
		for index, value := range row.Values {
			counts[index] += value
		}
	}
	points := make([]wecomTrendPoint, 0, days)
	for day := 0; day < days; day++ {
		rate := float64(0)
		if users > 0 {
			rate = float64(counts[day]) * 100 / float64(users)
		}
		points = append(points, wecomTrendPoint{Label: "Day" + strconv.Itoa(day), Value: rate})
	}
	return wecomTrendResult("retention_trend", p, "新用户留存率（$AppStart）", "line", start, now, points), nil
}
