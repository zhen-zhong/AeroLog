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

const maxBehaviorEvents = 200000

type behaviorEvent struct {
	DistinctID string
	Event      string
	Time       time.Time
}

type behaviorSession struct {
	DistinctID string
	Start      time.Time
	End        time.Time
	Events     []string
}

type behaviorQueryBody struct {
	Events            []string `json:"events"`
	From              int64    `json:"from"`
	To                int64    `json:"to"`
	SessionGapSeconds int64    `json:"session_gap_seconds"`
}

func (h *AnalyticsHandler) loadBehaviorEvents(ctx context.Context, pid uint32, body *behaviorQueryBody) ([]behaviorEvent, bool, error) {
	if body.To == 0 {
		body.To = time.Now().UnixMilli()
	}
	if body.From == 0 {
		body.From = body.To - 7*24*3600*1000
	}
	if len(body.Events) > 20 {
		return nil, false, &queryTableError{Status: http.StatusBadRequest, Msg: "events length must be <= 20"}
	}
	where := "project_id = ? AND time BETWEEN fromUnixTimestamp64Milli(?) AND fromUnixTimestamp64Milli(?)"
	args := []any{pid, body.From, body.To}
	if len(body.Events) > 0 {
		holders := make([]string, 0, len(body.Events))
		for _, event := range body.Events {
			if event == "" {
				continue
			}
			holders = append(holders, "?")
			args = append(args, event)
		}
		if len(holders) > 0 {
			where += " AND event IN (" + joinStrs(holders, ", ") + ")"
		}
	}
	args = append(args, uint32(maxBehaviorEvents+1))
	rows, err := h.CH.Query(ctx, `SELECT distinct_id, event, time FROM events WHERE `+where+` ORDER BY distinct_id, time LIMIT ?`, args...)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	out := make([]behaviorEvent, 0)
	for rows.Next() {
		var event behaviorEvent
		if err := rows.Scan(&event.DistinctID, &event.Event, &event.Time); err == nil {
			out = append(out, event)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	truncated := len(out) > maxBehaviorEvents
	if truncated {
		out = out[:maxBehaviorEvents]
	}
	return out, truncated, nil
}

func normalizeSessionGap(seconds int64) int64 {
	if seconds < 60 || seconds > 4*3600 {
		return 20 * 60
	}
	return seconds
}

func splitBehaviorSessions(events []behaviorEvent, gapSeconds int64) []behaviorSession {
	gap := time.Duration(normalizeSessionGap(gapSeconds)) * time.Second
	out := make([]behaviorSession, 0)
	for _, event := range events {
		if event.DistinctID == "" || event.Event == "" {
			continue
		}
		if len(out) == 0 || out[len(out)-1].DistinctID != event.DistinctID || event.Time.Sub(out[len(out)-1].End) > gap {
			out = append(out, behaviorSession{DistinctID: event.DistinctID, Start: event.Time, End: event.Time, Events: []string{event.Event}})
			continue
		}
		current := &out[len(out)-1]
		current.End = event.Time
		if len(current.Events) == 0 || current.Events[len(current.Events)-1] != event.Event {
			current.Events = append(current.Events, event.Event)
		}
	}
	return out
}

type pathNode struct {
	Name  string `json:"name"`
	Count uint64 `json:"count"`
}

type pathEdge struct {
	Source string `json:"source"`
	Target string `json:"target"`
	Count  uint64 `json:"count"`
}

// /v1/projects/:id/analytics/paths
// body: {events?, from, to, session_gap_seconds?, start_event?, max_steps?, max_nodes?}
func (h *AnalyticsHandler) paths(c *gin.Context) {
	pid, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	var body struct {
		behaviorQueryBody
		StartEvent string `json:"start_event"`
		MaxSteps   int    `json:"max_steps"`
		MaxNodes   int    `json:"max_nodes"`
	}
	if err := c.BindJSON(&body); err != nil {
		writeQueryTableError(c, &queryTableError{Status: http.StatusBadRequest, Msg: err.Error()})
		return
	}
	if body.MaxSteps < 2 || body.MaxSteps > 12 {
		body.MaxSteps = 5
	}
	if body.MaxNodes < 3 || body.MaxNodes > 30 {
		body.MaxNodes = 12
	}
	events, truncated, err := h.loadBehaviorEvents(c.Request.Context(), uint32(pid), &body.behaviorQueryBody)
	if err != nil {
		writeQueryTableError(c, err)
		return
	}
	sessions := splitBehaviorSessions(events, body.SessionGapSeconds)
	nodes, edges, matched := buildPaths(sessions, body.StartEvent, body.MaxSteps, body.MaxNodes)
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"sessions": matched, "nodes": nodes, "edges": edges, "truncated": truncated}})
}

func buildPaths(sessions []behaviorSession, startEvent string, maxSteps, maxNodes int) ([]pathNode, []pathEdge, uint64) {
	nodeCounts := map[string]uint64{}
	edgeCounts := map[string]uint64{}
	matched := uint64(0)
	for _, session := range sessions {
		sequence := session.Events
		if startEvent != "" {
			start := -1
			for index, event := range sequence {
				if event == startEvent {
					start = index
					break
				}
			}
			if start < 0 {
				continue
			}
			sequence = sequence[start:]
		}
		if len(sequence) == 0 {
			continue
		}
		if len(sequence) > maxSteps {
			sequence = sequence[:maxSteps]
		}
		matched++
		for _, event := range sequence {
			nodeCounts[event]++
		}
		for index := 1; index < len(sequence); index++ {
			edgeCounts[sequence[index-1]+"\x00"+sequence[index]]++
		}
	}
	nodes := make([]pathNode, 0, len(nodeCounts))
	for name, count := range nodeCounts {
		nodes = append(nodes, pathNode{Name: name, Count: count})
	}
	sort.Slice(nodes, func(i, j int) bool {
		if nodes[i].Count != nodes[j].Count {
			return nodes[i].Count > nodes[j].Count
		}
		if nodes[i].Name == startEvent {
			return true
		}
		if nodes[j].Name == startEvent {
			return false
		}
		return nodes[i].Name < nodes[j].Name
	})
	if len(nodes) > maxNodes {
		nodes = nodes[:maxNodes]
	}
	allowed := map[string]bool{}
	for _, node := range nodes {
		allowed[node.Name] = true
	}
	edges := make([]pathEdge, 0, len(edgeCounts))
	for key, count := range edgeCounts {
		parts := strings.SplitN(key, "\x00", 2)
		if len(parts) == 2 && allowed[parts[0]] && allowed[parts[1]] {
			edges = append(edges, pathEdge{Source: parts[0], Target: parts[1], Count: count})
		}
	}
	sort.Slice(edges, func(i, j int) bool {
		if edges[i].Count != edges[j].Count {
			return edges[i].Count > edges[j].Count
		}
		if edges[i].Source != edges[j].Source {
			return edges[i].Source < edges[j].Source
		}
		return edges[i].Target < edges[j].Target
	})
	return nodes, edges, matched
}

type sessionDay struct {
	Day                string  `json:"day"`
	Sessions           uint64  `json:"sessions"`
	Users              uint64  `json:"users"`
	AverageEvents      float64 `json:"average_events"`
	AverageDurationSec float64 `json:"average_duration_seconds"`
}

// /v1/projects/:id/analytics/sessions
// body: {events?, from, to, session_gap_seconds?}
func (h *AnalyticsHandler) sessionAnalysis(c *gin.Context) {
	pid, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	var body behaviorQueryBody
	if err := c.BindJSON(&body); err != nil {
		writeQueryTableError(c, &queryTableError{Status: http.StatusBadRequest, Msg: err.Error()})
		return
	}
	events, truncated, err := h.loadBehaviorEvents(c.Request.Context(), uint32(pid), &body)
	if err != nil {
		writeQueryTableError(c, err)
		return
	}
	timezone, _ := time.LoadLocation(h.projectTimezone(c.Request.Context(), uint32(pid)))
	if timezone == nil {
		timezone = time.UTC
	}
	sessions := splitBehaviorSessions(events, body.SessionGapSeconds)
	totalDuration := float64(0)
	totalEvents := uint64(0)
	users := map[string]bool{}
	type aggregate struct {
		sessions, events uint64
		duration         float64
		users            map[string]bool
	}
	byDay := map[string]*aggregate{}
	for _, session := range sessions {
		users[session.DistinctID] = true
		duration := session.End.Sub(session.Start).Seconds()
		totalDuration += duration
		totalEvents += uint64(len(session.Events))
		day := session.Start.In(timezone).Format("2006-01-02")
		if byDay[day] == nil {
			byDay[day] = &aggregate{users: map[string]bool{}}
		}
		item := byDay[day]
		item.sessions++
		item.events += uint64(len(session.Events))
		item.duration += duration
		item.users[session.DistinctID] = true
	}
	days := make([]sessionDay, 0, len(byDay))
	for day, item := range byDay {
		averageEvents, averageDuration := float64(0), float64(0)
		if item.sessions > 0 {
			averageEvents = float64(item.events) / float64(item.sessions)
			averageDuration = item.duration / float64(item.sessions)
		}
		days = append(days, sessionDay{Day: day, Sessions: item.sessions, Users: uint64(len(item.users)), AverageEvents: averageEvents, AverageDurationSec: averageDuration})
	}
	sort.Slice(days, func(i, j int) bool { return days[i].Day < days[j].Day })
	averageEvents, averageDuration := float64(0), float64(0)
	if len(sessions) > 0 {
		averageEvents = float64(totalEvents) / float64(len(sessions))
		averageDuration = totalDuration / float64(len(sessions))
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"sessions": len(sessions), "users": len(users), "average_events": averageEvents, "average_duration_seconds": averageDuration, "days": days, "truncated": truncated}})
}
