package config

import (
	"os"
	"strconv"
	"strings"
)

// Config Consumer 配置
type Config struct {
	KafkaBrokers       []string
	KafkaTopic         string
	GroupID            string
	ClickHouse         ClickHouseConf
	PostgresDSN        string
	BatchSize          int
	BatchMs            int
	MetricsAddr        string
	DebugRetentionDays int
}

// ClickHouseConf CH 连接
type ClickHouseConf struct {
	Addr     string
	Database string
	Username string
	Password string
}

// FromEnv 读取环境变量构造配置
func FromEnv() *Config {
	return &Config{
		KafkaBrokers: strings.Split(getEnv("AEROLOG_KAFKA_BROKERS", "localhost:19092"), ","),
		KafkaTopic:   getEnv("AEROLOG_KAFKA_TOPIC", "events.raw"),
		GroupID:      getEnv("AEROLOG_GROUP_ID", "aerolog-consumer"),
		ClickHouse: ClickHouseConf{
			Addr:     getEnv("AEROLOG_CH_ADDR", "localhost:9000"),
			Database: getEnv("AEROLOG_CH_DB", "aerolog"),
			Username: getEnv("AEROLOG_CH_USER", "aerolog"),
			Password: getEnv("AEROLOG_CH_PASSWORD", "aerolog"),
		},
		PostgresDSN:        getEnv("AEROLOG_PG_DSN", "postgres://aerolog:aerolog@localhost:5432/aerolog?sslmode=disable"),
		BatchSize:          1000,
		BatchMs:            1000,
		MetricsAddr:        getEnv("AEROLOG_METRICS_ADDR", ":9102"),
		DebugRetentionDays: getEnvInt("AEROLOG_DEBUG_RETENTION_DAYS", 7),
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
