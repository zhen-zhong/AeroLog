package config

import (
	"os"
	"strconv"
	"strings"
)

// Config Collector 配置
type Config struct {
	Addr               string
	MetricsAddr        string
	KafkaBrokers       []string
	KafkaTopic         string
	PostgresDSN        string
	RedisAddr          string
	MaxBodyBytes       int64
	DebugRetentionDays int
	RequireSignature   bool
}

// FromEnv 读取环境变量构造配置
func FromEnv() *Config {
	return &Config{
		Addr:               getEnv("AEROLOG_ADDR", ":8081"),
		MetricsAddr:        getEnv("AEROLOG_METRICS_ADDR", ":9101"),
		KafkaBrokers:       strings.Split(getEnv("AEROLOG_KAFKA_BROKERS", "localhost:19092"), ","),
		KafkaTopic:         getEnv("AEROLOG_KAFKA_TOPIC", "events.raw"),
		PostgresDSN:        getEnv("AEROLOG_PG_DSN", "postgres://aerolog:aerolog@localhost:5432/aerolog?sslmode=disable"),
		RedisAddr:          getEnv("AEROLOG_REDIS_ADDR", "localhost:6379"),
		MaxBodyBytes:       5 * 1024 * 1024,
		DebugRetentionDays: getEnvInt("AEROLOG_DEBUG_RETENTION_DAYS", 7),
		RequireSignature:   getEnv("AEROLOG_REQUIRE_SIGNATURE", "") == "1" || strings.EqualFold(getEnv("AEROLOG_REQUIRE_SIGNATURE", ""), "true"),
	}
}

func getEnv(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return def
}

func getEnvInt(key string, def int) int {
	raw := getEnv(key, "")
	if raw == "" {
		return def
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		return def
	}
	return v
}
