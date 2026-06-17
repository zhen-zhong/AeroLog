module github.com/aerolog/server/collector

go 1.22

require (
	github.com/aerolog/server/pkg v0.0.0
	github.com/gin-gonic/gin v1.10.0
	github.com/jackc/pgx/v5 v5.6.0
	github.com/redis/go-redis/v9 v9.5.3
)

replace github.com/aerolog/server/pkg => ../pkg
