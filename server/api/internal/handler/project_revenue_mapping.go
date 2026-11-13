package handler

import (
	"context"
	"errors"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ProjectRevenueMapping 定义一条广告收入事件与金额字段的映射规则。
type ProjectRevenueMapping struct {
	ID               int64     `json:"id"`
	ProjectID        int64     `json:"project_id"`
	Name             string    `json:"name"`
	Event            string    `json:"event"`
	AmountProperty   string    `json:"amount_property"`
	CurrencyProperty string    `json:"currency_property"`
	Multiplier       float64   `json:"multiplier"`
	IncludeInLTV     bool      `json:"include_in_ltv"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type projectRevenueMappingInput struct {
	Name             string  `json:"name"`
	Event            string  `json:"event"`
	AmountProperty   string  `json:"amount_property"`
	CurrencyProperty string  `json:"currency_property"`
	Multiplier       float64 `json:"multiplier"`
	IncludeInLTV     bool    `json:"include_in_ltv"`
}

func (h *ProjectHandler) listRevenueMappings(c *gin.Context) {
	items, err := listProjectRevenueMappings(c, h.PG, atoi64(c.Param("id")))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

func (h *ProjectHandler) createRevenueMapping(c *gin.Context) {
	projectID := atoi64(c.Param("id"))
	var input projectRevenueMappingInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	if err := normalizeRevenueMappingInput(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	var item ProjectRevenueMapping
	err := h.PG.QueryRow(c, `
		INSERT INTO project_revenue_mappings(project_id,name,event,amount_property,currency_property,multiplier,include_in_ltv)
		VALUES($1,$2,$3,$4,$5,$6,$7)
		RETURNING id,project_id,name,event,amount_property,currency_property,multiplier,include_in_ltv,created_at,updated_at
	`, projectID, input.Name, input.Event, input.AmountProperty, input.CurrencyProperty, input.Multiplier, input.IncludeInLTV).Scan(
		&item.ID, &item.ProjectID, &item.Name, &item.Event, &item.AmountProperty, &item.CurrencyProperty,
		&item.Multiplier, &item.IncludeInLTV, &item.CreatedAt, &item.UpdatedAt,
	)
	if err != nil {
		if strings.Contains(err.Error(), "project_revenue_mappings_project_id_event_amount_property_key") {
			c.JSON(http.StatusConflict, gin.H{"err": "相同事件和金额字段的收入规则已存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": item})
}

func (h *ProjectHandler) updateRevenueMapping(c *gin.Context) {
	projectID := atoi64(c.Param("id"))
	mappingID := atoi64(c.Param("mapping_id"))
	var input projectRevenueMappingInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	if err := normalizeRevenueMappingInput(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	var item ProjectRevenueMapping
	err := h.PG.QueryRow(c, `
		UPDATE project_revenue_mappings
		SET name=$3,event=$4,amount_property=$5,currency_property=$6,multiplier=$7,include_in_ltv=$8,updated_at=now()
		WHERE project_id=$1 AND id=$2
		RETURNING id,project_id,name,event,amount_property,currency_property,multiplier,include_in_ltv,created_at,updated_at
	`, projectID, mappingID, input.Name, input.Event, input.AmountProperty, input.CurrencyProperty, input.Multiplier, input.IncludeInLTV).Scan(
		&item.ID, &item.ProjectID, &item.Name, &item.Event, &item.AmountProperty, &item.CurrencyProperty,
		&item.Multiplier, &item.IncludeInLTV, &item.CreatedAt, &item.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"err": "广告收入规则不存在"})
			return
		}
		if strings.Contains(err.Error(), "project_revenue_mappings_project_id_event_amount_property_key") {
			c.JSON(http.StatusConflict, gin.H{"err": "相同事件和金额字段的收入规则已存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": item})
}

func (h *ProjectHandler) deleteRevenueMapping(c *gin.Context) {
	result, err := h.PG.Exec(c, `DELETE FROM project_revenue_mappings WHERE project_id=$1 AND id=$2`, atoi64(c.Param("id")), atoi64(c.Param("mapping_id")))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": err.Error()})
		return
	}
	if result.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"err": "广告收入规则不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"deleted": true}})
}

func normalizeRevenueMappingInput(input *projectRevenueMappingInput) error {
	input.Name = strings.TrimSpace(input.Name)
	input.Event = strings.TrimSpace(input.Event)
	input.AmountProperty = strings.TrimSpace(input.AmountProperty)
	input.CurrencyProperty = strings.TrimSpace(input.CurrencyProperty)
	if input.Name == "" {
		input.Name = input.Event
	}
	if input.Event == "" || input.AmountProperty == "" {
		return errors.New("收入事件和金额字段不能为空")
	}
	if len(input.Name) > 128 || len(input.Event) > 128 || len(input.AmountProperty) > 128 || len(input.CurrencyProperty) > 128 {
		return errors.New("规则名称、事件和字段长度不能超过 128")
	}
	if input.Multiplier == 0 {
		input.Multiplier = 1
	}
	if input.Multiplier <= 0 || math.IsNaN(input.Multiplier) || math.IsInf(input.Multiplier, 0) || input.Multiplier > 1e12 {
		return errors.New("换算系数必须大于 0 且不超过 1000000000000")
	}
	return nil
}

func listProjectRevenueMappings(ctx context.Context, pg *pgxpool.Pool, projectID int64) ([]ProjectRevenueMapping, error) {
	if pg == nil {
		return []ProjectRevenueMapping{}, nil
	}
	rows, err := pg.Query(ctx, `
		SELECT id,project_id,name,event,amount_property,currency_property,multiplier,include_in_ltv,created_at,updated_at
		FROM project_revenue_mappings WHERE project_id=$1 ORDER BY updated_at DESC,id DESC
	`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]ProjectRevenueMapping, 0)
	for rows.Next() {
		var item ProjectRevenueMapping
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.Name, &item.Event, &item.AmountProperty, &item.CurrencyProperty, &item.Multiplier, &item.IncludeInLTV, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (h *AnalyticsHandler) projectRevenueMappings(ctx context.Context, projectID int64) ([]ProjectRevenueMapping, error) {
	return listProjectRevenueMappings(ctx, h.PG, projectID)
}
