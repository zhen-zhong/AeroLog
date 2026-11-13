package handler

import (
	"context"
	"errors"

	"github.com/gin-gonic/gin"
)

// executeProjectList 查询当前 AeroLog 中的项目清单，不依赖问题中的项目名或时间范围。
func (h *WeComBotHandler) executeProjectList(ctx context.Context, _ wecomSkillInput) (gin.H, error) {
	if h.PG == nil {
		return nil, errors.New("项目数据库不可用")
	}
	type project struct {
		ID         int64  `json:"id"`
		Name       string `json:"name"`
		Status     int16  `json:"status"`
		DataSource string `json:"data_source"`
	}
	rows, err := h.PG.Query(ctx, `
		SELECT p.id, p.name, p.status,
		       CASE WHEN si.project_id IS NULL THEN 'aerolog' ELSE 'sensorsdata' END
		FROM projects p
		LEFT JOIN sensors_integrations si ON si.project_id=p.id AND si.status=1
		ORDER BY p.id
	`)
	if err != nil {
		return nil, errors.New("读取项目失败")
	}
	defer rows.Close()
	items := make([]project, 0)
	enabled := 0
	for rows.Next() {
		var item project
		if err := rows.Scan(&item.ID, &item.Name, &item.Status, &item.DataSource); err != nil {
			return nil, errors.New("读取项目失败")
		}
		if item.Status == ProjectStatusEnabled {
			enabled++
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, errors.New("读取项目失败")
	}
	return gin.H{"skill": "project_list", "total": len(items), "enabled": enabled, "projects": items}, nil
}
