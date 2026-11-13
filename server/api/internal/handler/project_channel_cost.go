package handler

import (
	"context"
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ProjectChannelCost 是按日期、媒体来源和广告活动保存的渠道成本。
type ProjectChannelCost struct {
	ID           int64     `json:"id"`
	ProjectID    int64     `json:"project_id"`
	CostDate     string    `json:"cost_date"`
	MediaSource  string    `json:"media_source"`
	CampaignName string    `json:"campaign_name"`
	Cost         float64   `json:"cost"`
	Currency     string    `json:"currency"`
	Source       string    `json:"source"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type projectChannelCostInput struct {
	CostDate     string  `json:"cost_date"`
	MediaSource  string  `json:"media_source"`
	CampaignName string  `json:"campaign_name"`
	Cost         float64 `json:"cost"`
	Currency     string  `json:"currency"`
	Source       string  `json:"source"`
}

func (h *ProjectHandler) listChannelCosts(c *gin.Context) {
	items, err := listProjectChannelCosts(c, h.PG, atoi64(c.Param("id")), c.Query("from"), c.Query("to"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

func (h *ProjectHandler) createChannelCost(c *gin.Context) {
	projectID := atoi64(c.Param("id"))
	var input projectChannelCostInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	input.Source = "manual"
	item, err := upsertProjectChannelCost(c, h.PG, projectID, input)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": item})
}

func (h *ProjectHandler) importChannelCosts(c *gin.Context) {
	projectID := atoi64(c.Param("id"))
	var body struct {
		Rows []projectChannelCostInput `json:"rows"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	if len(body.Rows) == 0 || len(body.Rows) > 1000 {
		c.JSON(http.StatusBadRequest, gin.H{"err": "导入行数必须在 1 到 1000 之间"})
		return
	}
	tx, err := h.PG.BeginTx(c, pgx.TxOptions{})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	defer func() { _ = tx.Rollback(c) }()
	for index, row := range body.Rows {
		row.Source = "csv"
		if err := normalizeProjectChannelCostInput(&row); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"err": "第 " + strconv.Itoa(index+1) + " 行：" + err.Error()})
			return
		}
		if _, err := tx.Exec(c, channelCostUpsertSQL, projectID, row.CostDate, row.MediaSource, row.CampaignName, row.Cost, row.Currency, row.Source); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
			return
		}
	}
	if err := tx.Commit(c); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"imported": len(body.Rows)}})
}

func (h *ProjectHandler) deleteChannelCost(c *gin.Context) {
	result, err := h.PG.Exec(c, `DELETE FROM project_channel_costs WHERE project_id=$1 AND id=$2`, atoi64(c.Param("id")), atoi64(c.Param("cost_id")))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	if result.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"err": "渠道成本记录不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"deleted": true}})
}

const channelCostUpsertSQL = `
	INSERT INTO project_channel_costs(project_id,cost_date,media_source,campaign_name,cost,currency,source)
	VALUES($1,$2,$3,$4,$5,$6,$7)
	ON CONFLICT(project_id,cost_date,media_source,campaign_name)
	DO UPDATE SET cost=EXCLUDED.cost,currency=EXCLUDED.currency,source=EXCLUDED.source,updated_at=now()`

func upsertProjectChannelCost(ctx context.Context, pg *pgxpool.Pool, projectID int64, input projectChannelCostInput) (ProjectChannelCost, error) {
	if err := normalizeProjectChannelCostInput(&input); err != nil {
		return ProjectChannelCost{}, err
	}
	var item ProjectChannelCost
	err := pg.QueryRow(ctx, `
		INSERT INTO project_channel_costs(project_id,cost_date,media_source,campaign_name,cost,currency,source)
		VALUES($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT(project_id,cost_date,media_source,campaign_name)
		DO UPDATE SET cost=EXCLUDED.cost,currency=EXCLUDED.currency,source=EXCLUDED.source,updated_at=now()
		RETURNING id,project_id,cost_date::text,media_source,campaign_name,cost,currency,source,created_at,updated_at
	`, projectID, input.CostDate, input.MediaSource, input.CampaignName, input.Cost, input.Currency, input.Source).Scan(
		&item.ID, &item.ProjectID, &item.CostDate, &item.MediaSource, &item.CampaignName, &item.Cost, &item.Currency, &item.Source, &item.CreatedAt, &item.UpdatedAt,
	)
	return item, err
}

func normalizeProjectChannelCostInput(input *projectChannelCostInput) error {
	input.CostDate = strings.TrimSpace(input.CostDate)
	input.MediaSource = strings.TrimSpace(input.MediaSource)
	input.CampaignName = strings.TrimSpace(input.CampaignName)
	input.Currency = strings.ToUpper(strings.TrimSpace(input.Currency))
	input.Source = strings.TrimSpace(input.Source)
	if _, err := time.Parse("2006-01-02", input.CostDate); err != nil {
		return errors.New("日期必须为 YYYY-MM-DD")
	}
	if input.MediaSource == "" {
		return errors.New("媒体来源不能为空")
	}
	if len(input.MediaSource) > 255 || len(input.CampaignName) > 255 || len(input.Currency) > 32 {
		return errors.New("渠道、活动或币种字段过长")
	}
	if input.Cost < 0 || math.IsNaN(input.Cost) || math.IsInf(input.Cost, 0) {
		return errors.New("成本必须大于或等于 0")
	}
	if input.Source == "" {
		input.Source = "manual"
	}
	if input.Source != "manual" && input.Source != "csv" {
		return errors.New("成本来源无效")
	}
	return nil
}

func listProjectChannelCosts(ctx context.Context, pg *pgxpool.Pool, projectID int64, from, to string) ([]ProjectChannelCost, error) {
	if pg == nil {
		return []ProjectChannelCost{}, nil
	}
	args := []any{projectID}
	where := "project_id=$1"
	if from = strings.TrimSpace(from); from != "" {
		if _, err := time.Parse("2006-01-02", from); err != nil {
			return nil, errors.New("from 必须为 YYYY-MM-DD")
		}
		args = append(args, from)
		where += " AND cost_date >= $" + strconv.Itoa(len(args))
	}
	if to = strings.TrimSpace(to); to != "" {
		if _, err := time.Parse("2006-01-02", to); err != nil {
			return nil, errors.New("to 必须为 YYYY-MM-DD")
		}
		args = append(args, to)
		where += " AND cost_date <= $" + strconv.Itoa(len(args))
	}
	rows, err := pg.Query(ctx, `SELECT id,project_id,cost_date::text,media_source,campaign_name,cost,currency,source,created_at,updated_at FROM project_channel_costs WHERE `+where+` ORDER BY cost_date DESC,id DESC LIMIT 1000`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]ProjectChannelCost, 0)
	for rows.Next() {
		var item ProjectChannelCost
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.CostDate, &item.MediaSource, &item.CampaignName, &item.Cost, &item.Currency, &item.Source, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

type channelCostTotal struct {
	Cost     float64
	Currency string
}

func (h *AnalyticsHandler) channelCostsForRange(ctx context.Context, projectID int64, dimension, from, to string) (map[string]channelCostTotal, error) {
	if h.PG == nil {
		return map[string]channelCostTotal{}, nil
	}
	column := "media_source"
	if dimension == "mmp_campaign_name" {
		column = "campaign_name"
	}
	rows, err := h.PG.Query(ctx, `
		SELECT `+column+`, COALESCE(sum(cost),0), COALESCE(string_agg(DISTINCT NULLIF(currency,''), ','),'')
		FROM project_channel_costs
		WHERE project_id=$1 AND cost_date >= $2::date AND cost_date <= $3::date AND `+column+` <> ''
		GROUP BY `+column, projectID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make(map[string]channelCostTotal)
	for rows.Next() {
		var label string
		var total channelCostTotal
		if err := rows.Scan(&label, &total.Cost, &total.Currency); err != nil {
			return nil, err
		}
		items[label] = total
	}
	return items, rows.Err()
}
