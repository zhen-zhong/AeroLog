package handler

import "context"

// projectTimezone returns a closed set of ClickHouse timezone names, safe for SQL literals.
func (h *AnalyticsHandler) projectTimezone(ctx context.Context, projectID uint32) string {
	var timezone string
	if h.PG == nil || h.PG.QueryRow(ctx, `SELECT COALESCE(timezone,'Asia/Shanghai') FROM projects WHERE id=$1`, projectID).Scan(&timezone) != nil {
		return defaultProjectTimezone
	}
	if normalized, ok := normalizeProjectTimezone(timezone); ok {
		return normalized
	}
	return defaultProjectTimezone
}

func clickHouseTimezone(timezone string) string {
	if timezone == "UTC" {
		return "'UTC'"
	}
	return "'Asia/Shanghai'"
}
