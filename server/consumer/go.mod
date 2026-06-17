module github.com/aerolog/server/consumer

go 1.22

require (
	github.com/IBM/sarama v1.43.2
	github.com/ClickHouse/clickhouse-go/v2 v2.27.0
	github.com/aerolog/server/pkg v0.0.0
	github.com/jackc/pgx/v5 v5.6.0
)

replace github.com/aerolog/server/pkg => ../pkg
