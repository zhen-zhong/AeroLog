// Package privacy provides small redaction helpers for debug payloads.
package privacy

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"regexp"
	"strings"
)

var (
	emailRE = regexp.MustCompile(`(?i)([a-z0-9._%+\-])[a-z0-9._%+\-]*(@[a-z0-9.\-]+\.[a-z]{2,})`)
	phoneRE = regexp.MustCompile(`(1[3-9]\d{2})\d{4}(\d{4})`)
)

// RedactJSON recursively redacts sensitive fields in arbitrary JSON-like values.
func RedactJSON(v any) any {
	switch x := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(x))
		for k, v := range x {
			if sensitiveKey(k) {
				out[k] = "[REDACTED]"
				continue
			}
			out[k] = RedactJSON(v)
		}
		return out
	case []any:
		out := make([]any, 0, len(x))
		for _, item := range x {
			out = append(out, RedactJSON(item))
		}
		return out
	case string:
		return redactString(x)
	default:
		raw, err := json.Marshal(x)
		if err != nil {
			return x
		}
		var loose any
		if err := json.Unmarshal(raw, &loose); err != nil {
			return x
		}
		if _, ok := loose.(map[string]any); ok {
			return RedactJSON(loose)
		}
		if _, ok := loose.([]any); ok {
			return RedactJSON(loose)
		}
		return x
	}
}

// RedactBody returns a redacted JSON value for request bodies, or a trimmed string for invalid JSON.
func RedactBody(raw []byte, limit int) any {
	if limit <= 0 {
		limit = 4096
	}
	if len(raw) > limit {
		raw = raw[:limit]
	}
	var loose any
	if err := json.Unmarshal(raw, &loose); err != nil {
		return redactString(string(raw))
	}
	return RedactJSON(loose)
}

// TokenFingerprint stores a stable non-secret token identifier.
func TokenFingerprint(token string) string {
	token = strings.TrimSpace(token)
	if token == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(token))
	return "sha256:" + hex.EncodeToString(sum[:])[:12]
}

func sensitiveKey(key string) bool {
	k := strings.ToLower(strings.TrimSpace(key))
	switch {
	case k == "token", k == "secret", k == "password", k == "passwd":
		return true
	case k == "authorization", k == "cookie", k == "set-cookie", k == "x-aerolog-signature":
		return true
	case strings.Contains(k, "token"), strings.Contains(k, "secret"), strings.Contains(k, "password"):
		return true
	case strings.Contains(k, "phone"), strings.Contains(k, "mobile"), strings.Contains(k, "email"):
		return true
	case strings.Contains(k, "id_card"), strings.Contains(k, "identity_card"):
		return true
	default:
		return false
	}
}

func redactString(raw string) string {
	raw = emailRE.ReplaceAllString(raw, `${1}***${2}`)
	raw = phoneRE.ReplaceAllString(raw, `${1}****${2}`)
	return raw
}
