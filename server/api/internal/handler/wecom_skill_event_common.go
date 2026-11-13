package handler

import (
	"context"
	"errors"
	"strings"
	"time"
)

func (h *WeComBotHandler) wecomKnownEvents(ctx context.Context, projectID uint32) ([]string, error) {
	rows, err := h.PG.Query(ctx, `SELECT name FROM event_definitions WHERE project_id=$1 AND status=1 ORDER BY last_seen DESC NULLS LAST, name LIMIT 500`, projectID)
	if err != nil {
		return nil, errors.New("读取事件清单失败")
	}
	defer rows.Close()
	items := []string{}
	for rows.Next() {
		var name string
		if rows.Scan(&name) == nil && strings.TrimSpace(name) != "" {
			items = append(items, name)
		}
	}
	return items, rows.Err()
}

func resolveWecomEvents(question string, requested, known []string, min, max int) ([]string, error) {
	lookup := make(map[string]string, len(known))
	for _, event := range known {
		lookup[strings.ToLower(event)] = event
	}
	candidates := requested
	if len(candidates) == 0 {
		lower := strings.ToLower(question)
		for _, event := range known {
			if strings.Contains(lower, strings.ToLower(event)) {
				candidates = append(candidates, event)
			}
		}
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		event, ok := lookup[strings.ToLower(strings.TrimSpace(candidate))]
		if !ok || seen[event] {
			continue
		}
		seen[event] = true
		out = append(out, event)
	}
	if len(out) < min || len(out) > max {
		return nil, errors.New("请提供已存在的事件名称")
	}
	return out, nil
}

func (h *WeComBotHandler) resolveWecomEventProperty(ctx context.Context, projectID uint32, event, requested, question string) (string, error) {
	rows, err := h.PG.Query(ctx, `SELECT name FROM property_definitions WHERE project_id=$1 AND scope='event' AND status=1 AND (event='' OR event=$2) ORDER BY event DESC, name LIMIT 500`, projectID, event)
	if err != nil {
		return "", errors.New("读取事件属性清单失败")
	}
	defer rows.Close()
	properties := []string{}
	for rows.Next() {
		var property string
		if rows.Scan(&property) == nil && strings.TrimSpace(property) != "" {
			properties = append(properties, property)
		}
	}
	needle := strings.ToLower(strings.TrimSpace(requested))
	if needle == "" {
		lower := strings.ToLower(question)
		for _, property := range properties {
			if strings.Contains(lower, strings.ToLower(property)) {
				needle = strings.ToLower(property)
				break
			}
		}
	}
	for _, property := range properties {
		if strings.EqualFold(property, needle) {
			return property, nil
		}
	}
	return "", errors.New("请提供当前事件已登记的属性名")
}

func wecomDaysRange(project wecomProject, days int) (time.Time, time.Time, error) {
	days, err := wecomTrendDays(days)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	loc := wecomProjectLocation(project.Timezone)
	now := time.Now().In(loc)
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc).AddDate(0, 0, -(days - 1))
	return start, now, nil
}
