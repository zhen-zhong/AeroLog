package handler

import (
	"net/http"
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
		sumIf(toFloat64OrZero(JSONExtractString(a.properties, ?)), a.event=?) AS revenue
	FROM cohort AS c
	LEFT JOIN activity AS a ON c.distinct_id=a.distinct_id
	GROUP BY c.dimension
	ORDER BY revenue DESC, ad_shows DESC
	LIMIT ?`
	args := []any{body.Dimension, uint32(pid), body.AttributionEvent, body.From, body.To, body.Dimension, uint32(pid), body.From, body.To, body.ShowEvent, body.ShowEvent, body.CompleteEvent, body.RevenueProperty, body.RevenueEvent, uint32(body.Limit)}
	rows, err := h.CH.Query(c, q, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	defer rows.Close()
	type row struct {
		Raw         string  `json:"raw"`
		Label       string  `json:"label"`
		Installs    uint64  `json:"installs"`
		AdShows     uint64  `json:"ad_shows"`
		ShowUsers   uint64  `json:"show_users"`
		AdCompletes uint64  `json:"ad_completes"`
		Revenue     float64 `json:"revenue"`
		LTV         float64 `json:"ltv"`
	}
	out := make([]row, 0)
	for rows.Next() {
		var item row
		if err := rows.Scan(&item.Raw, &item.Installs, &item.AdShows, &item.ShowUsers, &item.AdCompletes, &item.Revenue); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
			return
		}
		_, item.Label = parsePropertyValue(item.Raw)
		if item.Installs > 0 {
			item.LTV = item.Revenue / float64(item.Installs)
		}
		out = append(out, item)
	}
	if err := rows.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"rows": out, "cost_available": false}})
}
