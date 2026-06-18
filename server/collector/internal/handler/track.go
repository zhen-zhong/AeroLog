package handler

import (
	"compress/gzip"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/aerolog/server/pkg/metrics"
	"github.com/aerolog/server/pkg/model"
	"github.com/aerolog/server/pkg/mq"
	"github.com/aerolog/server/pkg/privacy"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/aerolog/server/collector/internal/projectcache"
)

var (
	mEventsReceived = metrics.Counter(
		"aerolog_collector_events_received_total",
		"接收的事件总数（含被拒）",
		"project", "result",
	)
	mRequestDuration = metrics.Histogram(
		"aerolog_collector_request_duration_seconds",
		"/v1/track 请求耗时",
		"status",
	)
	mKafkaSendErrors = metrics.Counter(
		"aerolog_collector_kafka_send_errors_total",
		"写 Kafka 失败总数",
	)
)

// TrackHandler 处理 /v1/track
type TrackHandler struct {
	Cache            *projectcache.Cache
	Producer         *mq.Producer
	PG               *pgxpool.Pool
	RequireSignature bool
	Topic            string
	MaxBody          int64
}

// Register 路由注册
func (h *TrackHandler) Register(r *gin.Engine) {
	r.POST("/v1/track", h.handle)
	r.GET("/healthz", func(c *gin.Context) { c.String(http.StatusOK, "ok") })
}

type trackResp struct {
	Code     int    `json:"code"`
	Msg      string `json:"msg"`
	Accepted int    `json:"accepted"`
	Rejected int    `json:"rejected,omitempty"`
}

func (h *TrackHandler) handle(c *gin.Context) {
	start := time.Now()
	status := "ok"
	defer func() {
		mRequestDuration.WithLabelValues(status).Observe(time.Since(start).Seconds())
	}()

	token := c.Query("token")
	if token == "" {
		token = c.GetHeader("X-AeroLog-Token")
	}
	pid, secret, projectRequireSignature, err := h.Cache.ResolveProject(c.Request.Context(), token)
	if err != nil {
		status = "unauthorized"
		h.recordRejected(c.Request.Context(), nil, nil, token, "invalid token", nil, c)
		c.JSON(http.StatusUnauthorized, trackResp{Code: 4001, Msg: "invalid token"})
		return
	}

	body, err := readBody(c.Request, h.MaxBody)
	if err != nil {
		status = "bad_request"
		h.recordRejected(c.Request.Context(), &pid, nil, token, err.Error(), nil, c)
		c.JSON(http.StatusBadRequest, trackResp{Code: 4004, Msg: err.Error()})
		return
	}
	requireSignature := h.RequireSignature || projectRequireSignature
	if ok, reason := validSignature(c, secret, body, requireSignature); !ok {
		status = "unauthorized"
		h.recordRejected(c.Request.Context(), &pid, nil, token, reason, body, c)
		c.JSON(http.StatusUnauthorized, trackResp{Code: 4002, Msg: reason})
		return
	}

	events, err := parseBody(body)
	if err != nil {
		status = "bad_request"
		h.recordRejected(c.Request.Context(), &pid, nil, token, err.Error(), body, c)
		c.JSON(http.StatusBadRequest, trackResp{Code: 4004, Msg: err.Error()})
		return
	}

	ip := clientIP(c)
	ua := c.GetHeader("User-Agent")
	now := time.Now().UnixMilli()
	accepted := 0
	rejected := 0

	projectLabel := strconvUint32(pid)
	for i := range events {
		e := &events[i]
		if err := e.Validate(); err != nil {
			rejected++
			mEventsReceived.WithLabelValues(projectLabel, "rejected").Inc()
			h.recordRejected(c.Request.Context(), &pid, e, token, err.Error(), nil, c)
			continue
		}
		env := model.EnvelopedEvent{
			ProjectID:  pid,
			IP:         ip,
			UserAgent:  ua,
			ReceivedAt: now,
			Event:      *e,
		}
		raw, err := env.MarshalKafka()
		if err != nil {
			rejected++
			mEventsReceived.WithLabelValues(projectLabel, "rejected").Inc()
			h.recordRejected(c.Request.Context(), &pid, e, token, err.Error(), nil, c)
			continue
		}
		// 用 distinct_id 做 key，保证同用户事件落到同分区
		ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
		err = h.Producer.Send(ctx, h.Topic, []byte(e.DistinctID), raw)
		cancel()
		if err != nil {
			mKafkaSendErrors.WithLabelValues().Inc()
			status = "queue_unavailable"
			c.JSON(http.StatusServiceUnavailable, trackResp{Code: 5001, Msg: "queue unavailable"})
			return
		}
		accepted++
		mEventsReceived.WithLabelValues(projectLabel, "accepted").Inc()
	}
	c.JSON(http.StatusOK, trackResp{Code: 0, Msg: "ok", Accepted: accepted, Rejected: rejected})
}

func validSignature(c *gin.Context, secret string, body []byte, required bool) (bool, string) {
	signature := strings.TrimSpace(c.GetHeader("X-AeroLog-Signature"))
	if signature == "" {
		if required {
			return false, "missing signature"
		}
		return true, ""
	}
	if secret == "" {
		return false, "invalid signature"
	}
	signature = strings.TrimPrefix(signature, "sha256=")
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(strings.ToLower(signature)), []byte(expected)) {
		return false, "invalid signature"
	}
	return true, ""
}

func (h *TrackHandler) recordRejected(ctx context.Context, projectID *uint32, event *model.Event, token string, reason string, rawBody []byte, c *gin.Context) {
	if h == nil || h.PG == nil {
		return
	}
	debugCtx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()

	payload := map[string]interface{}{
		"reason":                 reason,
		"credential_fingerprint": privacy.TokenFingerprint(token),
		"ip":                     clientIP(c),
		"ua":                     c.GetHeader("User-Agent"),
	}
	if event != nil {
		payload["event"] = privacy.RedactJSON(event)
	}
	if len(rawBody) > 0 {
		payload["raw_body"] = privacy.RedactBody(rawBody, 4096)
	}
	rawPayload, _ := json.Marshal(privacy.RedactJSON(payload))

	var projectArg interface{}
	if projectID != nil {
		projectArg = int64(*projectID)
	}
	eventName := ""
	eventType := "track"
	distinctID := ""
	userID := ""
	anonymousID := ""
	if event != nil {
		eventName = event.Event
		eventType = string(event.Type)
		if eventType == "" {
			eventType = "track"
		}
		distinctID = event.DistinctID
		userID = event.UserID
		anonymousID = event.AnonymousID
	}
	if _, err := h.PG.Exec(debugCtx, `
		INSERT INTO debug_events(project_id, event, event_type, distinct_id, user_id, anonymous_id, result, reason, payload, received_at)
		VALUES($1,$2,$3,$4,$5,$6,'rejected',$7,$8,now())
	`, projectArg, eventName, eventType, distinctID, userID, anonymousID, reason, rawPayload); err != nil {
		log.Printf("debug rejected insert err: %v", err)
	}
}

func strconvUint32(v uint32) string {
	// 小型 helper 避免额外 import "strconv" 冲突
	if v == 0 {
		return "0"
	}
	buf := [10]byte{}
	i := len(buf)
	for v > 0 {
		i--
		buf[i] = byte('0' + v%10)
		v /= 10
	}
	return string(buf[i:])
}

func readBody(r *http.Request, max int64) ([]byte, error) {
	r.Body = http.MaxBytesReader(nil, r.Body, max)
	var reader io.Reader = r.Body
	if strings.EqualFold(r.Header.Get("Content-Encoding"), "gzip") {
		gz, err := gzip.NewReader(r.Body)
		if err != nil {
			return nil, errors.New("invalid gzip body")
		}
		defer gz.Close()
		reader = gz
	}
	return io.ReadAll(reader)
}

// parseBody 兼容单条对象与数组
func parseBody(body []byte) ([]model.Event, error) {
	body = trimSpace(body)
	if len(body) == 0 {
		return nil, errors.New("empty body")
	}
	if body[0] == '[' {
		var arr []model.Event
		if err := json.Unmarshal(body, &arr); err != nil {
			return nil, err
		}
		return arr, nil
	}
	var one model.Event
	if err := json.Unmarshal(body, &one); err != nil {
		return nil, err
	}
	return []model.Event{one}, nil
}

func trimSpace(b []byte) []byte {
	i, j := 0, len(b)
	for i < j && (b[i] == ' ' || b[i] == '\n' || b[i] == '\r' || b[i] == '\t') {
		i++
	}
	for j > i && (b[j-1] == ' ' || b[j-1] == '\n' || b[j-1] == '\r' || b[j-1] == '\t') {
		j--
	}
	return b[i:j]
}

func clientIP(c *gin.Context) string {
	if xff := c.GetHeader("X-Forwarded-For"); xff != "" {
		if i := strings.Index(xff, ","); i > 0 {
			return strings.TrimSpace(xff[:i])
		}
		return strings.TrimSpace(xff)
	}
	if rip := c.GetHeader("X-Real-IP"); rip != "" {
		return rip
	}
	host, _, err := net.SplitHostPort(c.Request.RemoteAddr)
	if err != nil {
		return c.Request.RemoteAddr
	}
	return host
}
