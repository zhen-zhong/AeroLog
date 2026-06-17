package config

import (
	"os"
	"strings"
)

// Config Collector 配置
type Config struct {
	Addr         string
	MetricsAddr  string
	KafkaBrokers []string
	KafkaTopic   string
	PostgresDSN  string
	RedisAddr    string
	MaxBodyBytes int64
}

// FromEnv 读取环境变量构造配置
func FromEnv() *Config {
	return &Config{
		Addr:         getEnv("AEROLOG_ADDR", ":8081"),
		MetricsAddr:  getEnv("AEROLOG_METRICS_ADDR", ":9101"),
		KafkaBrokers: strings.Split(getEnv("AEROLOG_KAFKA_BROKERS", "localhost:19092"), ","),
		KafkaTopic:   getEnv("AEROLOG_KAFKA_TOPIC", "events.raw"),
		PostgresDSN:  getEnv("AEROLOG_PG_DSN", "postgres://aerolog:aerolog@localhost:5432/aerolog?sslmode=disable"),
		RedisAddr:    getEnv("AEROLOG_REDIS_ADDR", "localhost:6379"),
		MaxBodyBytes: 5 * 1024 * 1024,
	}
}

func getEnv(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return def
}
