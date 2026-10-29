package handler

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const sensorsDataSubscriptionPath = "/api/v3/horizon/v1/data-subscription"

// SensorsIntegrationHandler configures one Sensors Data source for one AeroLog project.
// The receiver application is shared: every source creates only its own subscription.
type SensorsIntegrationHandler struct {
	PG              *pgxpool.Pool
	EncryptionKey   string
	ApplicationName string
	HTTPClient      *http.Client
}

type SensorsIntegration struct {
	ProjectID       int64      `json:"project_id"`
	SourceProjectID string     `json:"source_project_id"`
	SourceProject   string     `json:"source_project"`
	Endpoint        string     `json:"endpoint"`
	ApplicationID   string     `json:"application_id"`
	Subscriber      string     `json:"subscriber"`
	SubscriptionID  *int64     `json:"subscription_id,omitempty"`
	APIKeyHint      string     `json:"api_key_hint"`
	Status          int16      `json:"status"`
	LastError       string     `json:"last_error"`
	LastVerifiedAt  *time.Time `json:"last_verified_at,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

func (h *SensorsIntegrationHandler) Register(r *gin.RouterGroup) {
	owner := r.Group("", ProjectRoleRequired(h.PG, RoleOwner))
	owner.GET("/projects/:id/integrations/sensorsdata", h.get)
	owner.PUT("/projects/:id/integrations/sensorsdata", h.connect)
}

func (h *SensorsIntegrationHandler) get(c *gin.Context) {
	row := h.PG.QueryRow(c, `
		SELECT project_id, source_project_id, source_project, endpoint, application_id, subscriber,
		       subscription_id, api_key_hint, status, last_error, last_verified_at, created_at, updated_at
		FROM sensors_integrations WHERE project_id=$1
	`, c.Param("id"))
	item, err := scanSensorsIntegration(row)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"err": "未配置神策接入"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": item})
}

type sensorsConnectRequest struct {
	Endpoint          string `json:"endpoint" binding:"required"`
	Project           string `json:"project" binding:"required"`
	APIKey            string `json:"api_key"`
	SourceProjectID   string `json:"source_project_id"`
	ReuseSubscription bool   `json:"reuse_subscription"`
}

type storedSensorsIntegration struct {
	SourceProjectID  string
	SourceProject    string
	Endpoint         string
	SubscriptionID   *int64
	APIKeyCiphertext string
}

func (h *SensorsIntegrationHandler) connect(c *gin.Context) {
	if strings.TrimSpace(h.EncryptionKey) == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"err": "服务端未配置 AEROLOG_INTEGRATION_ENCRYPTION_KEY"})
		return
	}
	if strings.TrimSpace(h.ApplicationName) == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"err": "服务端未配置共享神策订阅应用"})
		return
	}
	var req sensorsConnectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": "请完整填写神策地址和项目英文名"})
		return
	}
	endpoint, err := normalizeSensorsEndpoint(req.Endpoint)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"err": err.Error()})
		return
	}
	project := strings.TrimSpace(req.Project)
	apiKey := strings.TrimSpace(req.APIKey)
	if project == "" {
		c.JSON(http.StatusBadRequest, gin.H{"err": "请填写神策项目英文名"})
		return
	}
	var stored storedSensorsIntegration
	storedErr := h.PG.QueryRow(c, `
		SELECT source_project_id, source_project, endpoint, subscription_id, api_key_ciphertext
		FROM sensors_integrations WHERE project_id=$1
	`, c.Param("id")).Scan(
		&stored.SourceProjectID, &stored.SourceProject, &stored.Endpoint, &stored.SubscriptionID, &stored.APIKeyCiphertext,
	)
	if storedErr != nil && !errors.Is(storedErr, pgx.ErrNoRows) {
		c.JSON(http.StatusInternalServerError, gin.H{"err": "读取已有神策接入配置失败"})
		return
	}
	hasStored := storedErr == nil
	if apiKey == "" && hasStored {
		apiKey, err = decryptIntegrationSecret(h.EncryptionKey, stored.APIKeyCiphertext)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"err": "无法读取已保存的 API Key，请重新填写"})
			return
		}
	}
	if apiKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"err": "请填写神策 API Key"})
		return
	}

	client := newSensorsClient(endpoint, project, apiKey, h.HTTPClient)
	applicationID, err := client.applicationID(c, h.ApplicationName)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"err": "神策订阅应用校验失败：" + safeSensorsError(err)})
		return
	}

	sourceProjectID := strings.TrimSpace(req.SourceProjectID)
	subscriber := fmt.Sprintf("aerolog-project-%s", c.Param("id"))
	var subscriptionID *int64
	if req.ReuseSubscription {
		if sourceProjectID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"err": "复用已有订阅时必须填写神策项目 ID"})
			return
		}
	} else if hasStored && project == stored.SourceProject {
		// Editing address or API Key must not create a duplicate subscription for the same source project.
		sourceProjectID = stored.SourceProjectID
		subscriptionID = stored.SubscriptionID
	} else {
		var sourceID string
		var id int64
		sourceID, id, err = client.createAllEventsSubscription(c, applicationID, subscriber)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"err": "创建神策实时订阅失败：" + safeSensorsError(err)})
			return
		}
		sourceProjectID = sourceID
		subscriptionID = &id
	}
	if sourceProjectID == "" {
		c.JSON(http.StatusBadGateway, gin.H{"err": "神策未返回项目 ID，无法建立数据路由"})
		return
	}

	var occupiedBy int64
	err = h.PG.QueryRow(c, `SELECT project_id FROM sensors_integrations WHERE source_project_id=$1 AND project_id<>$2`, sourceProjectID, c.Param("id")).Scan(&occupiedBy)
	if err == nil {
		c.JSON(http.StatusConflict, gin.H{"err": "该神策项目已接入另一个 AeroLog 项目"})
		return
	}

	ciphertext, err := encryptIntegrationSecret(h.EncryptionKey, apiKey)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": "无法安全保存 API Key"})
		return
	}
	keyHint := maskAPIKey(apiKey)
	row := h.PG.QueryRow(c, `
		INSERT INTO sensors_integrations(
			project_id, source_project_id, source_project, endpoint, application_id, subscriber,
			subscription_id, api_key_ciphertext, api_key_hint, status, last_error, last_verified_at, created_by
		) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1,'',now(),$10)
		ON CONFLICT (project_id) DO UPDATE SET
			source_project_id=EXCLUDED.source_project_id, source_project=EXCLUDED.source_project,
			endpoint=EXCLUDED.endpoint, application_id=EXCLUDED.application_id, subscriber=EXCLUDED.subscriber,
			subscription_id=EXCLUDED.subscription_id, api_key_ciphertext=EXCLUDED.api_key_ciphertext,
			api_key_hint=EXCLUDED.api_key_hint, status=1, last_error='', last_verified_at=now(), updated_at=now()
		RETURNING project_id, source_project_id, source_project, endpoint, application_id, subscriber,
		          subscription_id, api_key_hint, status, last_error, last_verified_at, created_at, updated_at
	`, c.Param("id"), sourceProjectID, project, endpoint, applicationID, subscriber, subscriptionID, ciphertext, keyHint, CurrentUserID(c))
	item, err := scanSensorsIntegration(row)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"err": "保存神策接入配置失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": item})
}

type rowScanner interface{ Scan(...any) error }

func scanSensorsIntegration(row rowScanner) (SensorsIntegration, error) {
	var item SensorsIntegration
	err := row.Scan(&item.ProjectID, &item.SourceProjectID, &item.SourceProject, &item.Endpoint, &item.ApplicationID, &item.Subscriber,
		&item.SubscriptionID, &item.APIKeyHint, &item.Status, &item.LastError, &item.LastVerifiedAt, &item.CreatedAt, &item.UpdatedAt)
	return item, err
}

func normalizeSensorsEndpoint(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", errors.New("神策地址必须是 http(s)://host:port")
	}
	u.Path = strings.TrimRight(u.Path, "/")
	if u.Path != "" {
		return "", errors.New("神策地址不能包含路径")
	}
	return strings.TrimRight(u.String(), "/"), nil
}

func encryptIntegrationSecret(key, value string) (string, error) {
	sum := sha256.Sum256([]byte(key))
	block, err := aes.NewCipher(sum[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(append(nonce, gcm.Seal(nil, nonce, []byte(value), nil)...)), nil
}

func decryptIntegrationSecret(key, ciphertext string) (string, error) {
	sum := sha256.Sum256([]byte(key))
	block, err := aes.NewCipher(sum[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	raw, err := base64.RawURLEncoding.DecodeString(ciphertext)
	if err != nil || len(raw) < gcm.NonceSize() {
		return "", errors.New("API Key 密文无效")
	}
	plain, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

func maskAPIKey(value string) string {
	if len(value) <= 8 {
		return "已保存"
	}
	return value[:4] + "…" + value[len(value)-4:]
}

type sensorsClient struct {
	endpoint, project, apiKey string
	http                      *http.Client
}

func newSensorsClient(endpoint, project, apiKey string, client *http.Client) *sensorsClient {
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	return &sensorsClient{endpoint: endpoint, project: project, apiKey: apiKey, http: client}
}

func (s *sensorsClient) applicationID(ctx context.Context, applicationName string) (string, error) {
	var out struct {
		Application struct {
			ApplicationID string `json:"application_id"`
		} `json:"application"`
	}
	if err := s.post(ctx, "/application/get", map[string]string{"application_name": applicationName}, &out); err != nil {
		return "", err
	}
	if out.Application.ApplicationID == "" {
		return "", errors.New("订阅应用未返回 application_id")
	}
	return out.Application.ApplicationID, nil
}

func (s *sensorsClient) createAllEventsSubscription(ctx context.Context, applicationID, subscriber string) (string, int64, error) {
	body := map[string]any{"subscription": map[string]any{
		"application": applicationID, "subscriber": subscriber, "target_type": "ENTITY_DATA",
		"entity_data_subscription_config": map[string]any{"entity_name": "user", "attribute_type": "EVENTS", "events_attribute_config": map[string]any{"event_name": "*", "attribute_names": []string{"*"}}},
	}}
	var out struct {
		SubscriptionID json.RawMessage `json:"subscription_id"`
		ProjectID      json.RawMessage `json:"project_id"`
	}
	if err := s.post(ctx, "/create", body, &out); err != nil {
		return "", 0, err
	}
	var subscriptionID int64
	if err := json.Unmarshal(out.SubscriptionID, &subscriptionID); err != nil || subscriptionID == 0 {
		return "", 0, errors.New("订阅未返回 subscription_id")
	}
	projectID := rawJSONIdentifier(out.ProjectID)
	if projectID == "" {
		return "", 0, errors.New("订阅未返回 project_id")
	}
	return projectID, subscriptionID, nil
}

func (s *sensorsClient) post(ctx context.Context, path string, body any, out any) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.endpoint+sensorsDataSubscriptionPath+path, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json;charset=UTF-8")
	req.Header.Set("api-key", s.apiKey)
	req.Header.Set("sensorsdata-project", s.project)
	res, err := s.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	response, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("HTTP %d", res.StatusCode)
	}
	var envelope struct {
		Code    string          `json:"code"`
		Message string          `json:"message"`
		Data    json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(response, &envelope); err != nil {
		return errors.New("响应不是 JSON")
	}
	if envelope.Code != "SUCCESS" {
		return fmt.Errorf("%s", strings.TrimSpace(envelope.Code))
	}
	if err := json.Unmarshal(envelope.Data, out); err != nil {
		return errors.New("响应数据格式无效")
	}
	return nil
}

func rawJSONIdentifier(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var str string
	if json.Unmarshal(raw, &str) == nil {
		return strings.TrimSpace(str)
	}
	var num json.Number
	if json.Unmarshal(raw, &num) == nil {
		return num.String()
	}
	var n int64
	if json.Unmarshal(raw, &n) == nil {
		return strconv.FormatInt(n, 10)
	}
	return ""
}

func safeSensorsError(err error) string {
	if err == nil {
		return ""
	}
	return strings.TrimSpace(err.Error())
}
