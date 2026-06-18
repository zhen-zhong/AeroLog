package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Addr               string
	MetricsAddr        string
	PostgresDSN        string
	ClickHouse         ClickHouseConf
	JWTSecret          string
	AllowOrigins       []string
	DebugRetentionDays int
}

type ClickHouseConf struct {
	Addr     string
	Database string
	Username string
	Password string
}

func FromEnv() *Config {
	return &Config{
		Addr:        getEnv("AEROLOG_API_ADDR", ":8082"),
		MetricsAddr: getEnv("AEROLOG_METRICS_ADDR", ":9103"),
		PostgresDSN: getEnv("AEROLOG_PG_DSN", "postgres://aerolog:aerolog@localhost:5432/aerolog?sslmode=disable"),
		ClickHouse: ClickHouseConf{
			Addr:     getEnv("AEROLOG_CH_ADDR", "localhost:9000"),
			Database: getEnv("AEROLOG_CH_DB", "aerolog"),
			Username: getEnv("AEROLOG_CH_USER", "aerolog"),
			Password: getEnv("AEROLOG_CH_PASSWORD", "aerolog"),
		},
		JWTSecret:          getEnv("AEROLOG_JWT_SECRET", "change-me"),
		AllowOrigins:       strings.Split(getEnv("AEROLOG_CORS", "*"), ","),
		DebugRetentionDays: getEnvInt("AEROLOG_DEBUG_RETENTION_DAYS", 7),
	}
}

func getEnv(k, def string) string {
	if v, ok := os.LookupEnv(k); ok && v != "" {
		return v
	}
	return def
}

func getEnvInt(k string, def int) int {
	raw := getEnv(k, "")
	if raw == "" {
		return def
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		return def
	}
	return v
}
