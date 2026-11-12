package handler

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type wecomProject struct {
	ID       uint32
	Name     string
	Timezone string
}

type wecomTrendPoint struct {
	Label string  `json:"label"`
	Value float64 `json:"value"`
}

var wecomTrendMetrics = map[string]struct {
	Label string
	Event string
	Sum   string
}{
	"new_users":               {Label: "新增用户"},
	"ad_impressions":          {Label: "广告展示次数", Event: "ad_show"},
	"ad_impressions_per_user": {Label: "人均广告展示", Event: "ad_show"},
	"ad_coin_revenue":         {Label: "广告收入（金）", Event: "coin_earned", Sum: "coin_amount"},
}

// executeReportTrend 使用自定义报表相同口径查询核心指标的按天趋势。
func (h *WeComBotHandler) executeReportTrend(ctx context.Context, input wecomSkillInput) (gin.H, error) {
	if h.Analytics == nil {
		return nil, errors.New("分析服务未配置")
	}
	metric, ok := wecomTrendMetrics[input.Params.Metric]
	if !ok {
		return nil, errors.New("不支持的趋势指标")
	}
	p, err := h.wecomProjectForQuestion(ctx, input.Question)
	if err != nil {
		return nil, err
	}
	days, err := wecomTrendDays(input.Params.Days)
	if err != nil {
		return nil, err
	}
	chart := input.Params.Chart
	if chart == "" {
		chart = "line"
	}
	if chart != "line" && chart != "bar" {
		return nil, errors.New("图表仅支持折线图或柱状图")
	}
	loc := wecomProjectLocation(p.Timezone)
	now := time.Now().In(loc)
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc).AddDate(0, 0, -(days - 1))
	points, err := h.reportTrendPoints(ctx, p, metric, start, now)
	if err != nil {
		return nil, err
	}
	return wecomTrendResult("report_trend", p, metric.Label, chart, start, now, points), nil
}

func (h *WeComBotHandler) reportTrendPoints(ctx context.Context, p wecomProject, metric struct {
	Label string
	Event string
	Sum   string
}, start, end time.Time) ([]wecomTrendPoint, error) {
	if metric.Label == "新增用户" {
		rows, err := h.Analytics.computeCohortTable(ctx, p.ID, clickHouseTimezone(p.Timezone), &CohortTableBody{
			CohortEvent: "$AppStart", CohortProperty: "$is_first_day", CohortValue: true,
			MetricEvent: "$AppStart", From: start.UnixMilli(), To: end.UnixMilli(), Offsets: []int{0},
		}, []int{0})
		if err != nil {
			return nil, errors.New("查询新增用户趋势失败")
		}
		values := make(map[string]float64, len(rows))
		for _, row := range rows {
			values[row.Cohort] = float64(row.Users)
		}
		return fillWecomTrendDates(start, end, values), nil
	}
	body := &QueryTableBody{Events: []string{metric.Event}, From: start.UnixMilli(), To: end.UnixMilli(), Limit: 100}
	body.Dimensions = append(body.Dimensions, struct {
		Type string `json:"type"`
		Key  string `json:"key"`
	}{Type: "time", Key: "day"})
	if metric.Sum != "" {
		body.SumProperties = []string{metric.Sum}
	}
	rows, _, err := h.Analytics.executeQueryTable(ctx, p.ID, body, 100)
	if err != nil {
		return nil, errors.New("查询指标趋势失败")
	}
	values := make(map[string]float64, len(rows))
	for _, row := range rows {
		if len(row.Dimensions) == 0 {
			continue
		}
		value := float64(row.Count)
		if metric.Label == "人均广告展示" {
			if row.Users > 0 {
				value = float64(row.Count) / float64(row.Users)
			} else {
				value = 0
			}
		}
		if metric.Sum != "" {
			value = row.Sums[metric.Sum]
		}
		values[row.Dimensions[0].Label] = value
	}
	return fillWecomTrendDates(start, end, values), nil
}

func (h *WeComBotHandler) wecomProjectForQuestion(ctx context.Context, question string) (wecomProject, error) {
	rows, err := h.PG.Query(ctx, `SELECT id, name, COALESCE(timezone, 'Asia/Shanghai') FROM projects ORDER BY id`)
	if err != nil {
		return wecomProject{}, errors.New("读取项目失败")
	}
	defer rows.Close()
	matched := []wecomProject{}
	lowerQuestion := strings.ToLower(question)
	for rows.Next() {
		var project wecomProject
		if rows.Scan(&project.ID, &project.Name, &project.Timezone) == nil && strings.Contains(lowerQuestion, strings.ToLower(project.Name)) {
			matched = append(matched, project)
		}
	}
	if len(matched) != 1 {
		return wecomProject{}, errors.New("趋势查询需包含唯一项目名称")
	}
	return matched[0], nil
}

func wecomProjectLocation(timezone string) *time.Location {
	if timezone == "UTC" {
		return time.UTC
	}
	return time.FixedZone("UTC+8", 8*3600)
}

func wecomTrendDays(days int) (int, error) {
	if days == 0 {
		return 7, nil
	}
	if days < 1 || days > 30 {
		return 0, errors.New("趋势天数仅支持 1 到 30 天")
	}
	return days, nil
}

func fillWecomTrendDates(start, end time.Time, values map[string]float64) []wecomTrendPoint {
	points := []wecomTrendPoint{}
	for day := time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, start.Location()); !day.After(end); day = day.AddDate(0, 0, 1) {
		label := day.Format("2006-01-02")
		points = append(points, wecomTrendPoint{Label: label, Value: values[label]})
	}
	return points
}

func wecomTrendResult(skill string, project wecomProject, metric, chart string, start, end time.Time, points []wecomTrendPoint) gin.H {
	labels := make([]string, 0, len(points))
	values := make([]float64, 0, len(points))
	var total float64
	for _, point := range points {
		labels = append(labels, point.Label)
		values = append(values, point.Value)
		total += point.Value
	}
	return gin.H{
		"skill": skill, "project_name": project.Name, "timezone": project.Timezone,
		"metric": metric, "from": start.Format("2006-01-02 15:04:05 MST"), "to": end.Format("2006-01-02 15:04:05 MST"),
		"points": points, "total": total,
		"chart": gin.H{"type": chart, "title": project.Name + " · " + metric, "labels": labels, "values": values},
	}
}
