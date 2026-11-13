package handler

import (
	"context"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// channelBusiness 按首次归因事件的统一渠道字段汇总广告经营指标。
func (h *AnalyticsHandler) channelBusiness(c *gin.Context) {
	pid, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	var body struct {
		Dimension        string `json:"dimension"`
		AttributionEvent string `json:"attribution_event"`
		ShowEvent        string `json:"show_event"`
		CompleteEvent    string `json:"complete_event"`
		RevenueEvent     string `json:"revenue_event"`
		RevenueProperty  string `json:"revenue_property"`
		From             int64  `json:"from"`
		To               int64  `json:"to"`
		Limit            int    `json:"limit"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	body.Dimension = strings.TrimSpace(body.Dimension)
	if body.Dimension == "" {
		body.Dimension = "mmp_media_source"
	}
	if body.Dimension != "mmp_media_source" && body.Dimension != "mmp_campaign_name" {
		c.JSON(http.StatusBadRequest, gin.H{"err": "dimension must be mmp_media_source or mmp_campaign_name"})
		return
	}
	for _, value := range []*string{&body.AttributionEvent, &body.ShowEvent, &body.CompleteEvent, &body.RevenueEvent, &body.RevenueProperty} {
		*value = strings.TrimSpace(*value)
		if len(*value) > 128 {
			c.JSON(http.StatusBadRequest, gin.H{"err": "event and property length must be <= 128"})
			return
		}
	}
	if body.AttributionEvent == "" || body.ShowEvent == "" {
		c.JSON(http.StatusBadRequest, gin.H{"err": "attribution_event and show_event are required"})
		return
	}
	if (body.RevenueEvent == "") != (body.RevenueProperty == "") {
		c.JSON(http.StatusBadRequest, gin.H{"err": "revenue_event and revenue_property must be provided together"})
		return
	}
	if body.To == 0 {
		body.To = time.Now().UnixMilli()
	}
	if body.From == 0 {
		body.From = body.To - 7*24*3600*1000
	}
	if body.From >= body.To {
		c.JSON(http.StatusBadRequest, gin.H{"err": "from must be before to"})
		return
	}
	body.Limit = clampLimit(strconv.Itoa(body.Limit), 1, 100)

	mappings, err := h.projectRevenueMappings(c, int64(pid))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": "读取广告收入规则失败"})
		return
	}
	// 已配置项目级规则时，优先使用全部规则；旧请求参数仅作为未配置时的兼容兜底。
	configuredRevenue := len(mappings) > 0
	if !configuredRevenue && body.RevenueEvent != "" {
		mappings = []ProjectRevenueMapping{{
			Event: body.RevenueEvent, AmountProperty: body.RevenueProperty, Multiplier: 1, IncludeInLTV: true,
		}}
	}
	revenueExpr, revenueArgs := revenueMappingExpression(mappings, false)
	ltvRevenueExpr, ltvRevenueArgs := revenueMappingExpression(mappings, true)
	costFrom, costTo := h.channelCostDateRange(c, uint32(pid), body.From, body.To)
	costs, err := h.channelCostsForRange(c, int64(pid), body.Dimension, costFrom, costTo)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": "读取渠道成本失败"})
		return
	}
	costAvailable := len(costs) > 0

	q := `WITH cohort AS (
		SELECT distinct_id, argMin(JSONExtractRaw(properties, ?), time) AS dimension
		FROM events
		WHERE project_id=? AND event=? AND time BETWEEN fromUnixTimestamp64Milli(?) AND fromUnixTimestamp64Milli(?)
		  AND JSONExtractString(properties, ?) != ''
		GROUP BY distinct_id
	), activity AS (
		SELECT distinct_id, event, properties
		FROM events
		WHERE project_id=? AND time BETWEEN fromUnixTimestamp64Milli(?) AND fromUnixTimestamp64Milli(?)
	)
	SELECT c.dimension,
		uniqExact(c.distinct_id) AS installs,
		countIf(a.event=?) AS ad_shows,
		uniqExactIf(c.distinct_id, a.event=?) AS show_users,
		countIf(a.event=?) AS ad_completes,
		` + revenueExpr + ` AS revenue,
		` + ltvRevenueExpr + ` AS ltv_revenue
	FROM cohort AS c
	LEFT JOIN activity AS a ON c.distinct_id=a.distinct_id
	GROUP BY c.dimension
	ORDER BY revenue DESC, ad_shows DESC
	LIMIT ?`
	args := []any{body.Dimension, uint32(pid), body.AttributionEvent, body.From, body.To, body.Dimension, uint32(pid), body.From, body.To, body.ShowEvent, body.ShowEvent, body.CompleteEvent}
	args = append(args, revenueArgs...)
	args = append(args, ltvRevenueArgs...)
	args = append(args, uint32(body.Limit))
	rows, err := h.CH.Query(c, q, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	defer rows.Close()
	type row struct {
		Raw          string   `json:"raw"`
		Label        string   `json:"label"`
		Installs     uint64   `json:"installs"`
		AdShows      uint64   `json:"ad_shows"`
		ShowUsers    uint64   `json:"show_users"`
		AdCompletes  uint64   `json:"ad_completes"`
		Revenue      float64  `json:"revenue"`
		LTVRevenue   float64  `json:"-"`
		LTV          float64  `json:"ltv"`
		Cost         *float64 `json:"cost,omitempty"`
		CostCurrency string   `json:"cost_currency,omitempty"`
		ROI          *float64 `json:"roi,omitempty"`
		ROAS         *float64 `json:"roas,omitempty"`
	}
	out := make([]row, 0)
	for rows.Next() {
		var item row
		if err := rows.Scan(&item.Raw, &item.Installs, &item.AdShows, &item.ShowUsers, &item.AdCompletes, &item.Revenue, &item.LTVRevenue); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
			return
		}
		_, item.Label = parsePropertyValue(item.Raw)
		if item.Installs > 0 {
			item.LTV = item.LTVRevenue / float64(item.Installs)
		}
		if cost, ok := costs[item.Label]; ok {
			costValue := cost.Cost
			item.Cost = &costValue
			item.CostCurrency = cost.Currency
			if costValue > 0 && !strings.Contains(cost.Currency, ",") {
				roi := (item.Revenue - costValue) / costValue
				roas := item.Revenue / costValue
				item.ROI = &roi
				item.ROAS = &roas
			}
			delete(costs, item.Label)
		}
		out = append(out, item)
	}
	if err := rows.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	for label, cost := range costs {
		costValue := cost.Cost
		out = append(out, row{Raw: label, Label: label, Cost: &costValue, CostCurrency: cost.Currency})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Revenue == out[j].Revenue {
			left, right := 0.0, 0.0
			if out[i].Cost != nil {
				left = *out[i].Cost
			}
			if out[j].Cost != nil {
				right = *out[j].Cost
			}
			return left > right
		}
		return out[i].Revenue > out[j].Revenue
	})
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"rows": out, "cost_available": costAvailable, "revenue_mapping_count": len(mappings), "revenue_configured": configuredRevenue, "cost_from": costFrom, "cost_to": costTo}})
}

func (h *AnalyticsHandler) channelCostDateRange(ctx context.Context, projectID uint32, from, to int64) (string, string) {
	location, err := time.LoadLocation(h.projectTimezone(ctx, projectID))
	if err != nil {
		location = time.Local
	}
	return time.UnixMilli(from).In(location).Format("2006-01-02"), time.UnixMilli(to).In(location).Format("2006-01-02")
}

func revenueMappingExpression(mappings []ProjectRevenueMapping, ltvOnly bool) (string, []any) {
	terms := make([]string, 0, len(mappings))
	args := make([]any, 0, len(mappings)*3)
	for _, mapping := range mappings {
		if ltvOnly && !mapping.IncludeInLTV {
			continue
		}
		terms = append(terms, "sumIf(toFloat64OrZero(JSONExtractString(a.properties, ?)) * ?, a.event=?)")
		args = append(args, mapping.AmountProperty, mapping.Multiplier, mapping.Event)
	}
	if len(terms) == 0 {
		return "toFloat64(0)", args
	}
	return "(" + strings.Join(terms, " + ") + ")", args
}
