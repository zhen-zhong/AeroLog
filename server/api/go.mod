module github.com/aerolog/server/api

go 1.22

require (
	github.com/aerolog/server/pkg v0.0.0
	github.com/gin-gonic/gin v1.10.0
	github.com/jackc/pgx/v5 v5.6.0
	github.com/ClickHouse/clickhouse-go/v2 v2.27.0
)

replace github.com/aerolog/server/pkg => ../pkg
