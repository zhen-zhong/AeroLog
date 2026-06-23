# AeroLog 生产部署与维护手册

本文记录 2026-06-23 在 Ubuntu 服务器上的首次部署方案、已验证结果，以及后续更新和故障处理方式。

## 1. 当前部署概览

服务器：`ubuntu@82.156.142.135`

应用目录：`/opt/aerolog`

生产编排目录：`/opt/aerolog/deploy/production`

代码来源：GitHub `main` 分支。

当前部署的是核心分析链路、Redpanda Console 与监控栈：

```text
浏览器 / SDK
        │
        ▼
      Nginx :80
      ├── /              → Next.js Web
      ├── /api/v1/*      → API
      ├── /collect/v1/*  → Collector
      └── /queue/*       → Redpanda Console（Basic Auth）
      └── /monitor/*     → Grafana（Basic Auth）

Collector → Redpanda → Consumer → ClickHouse
                     ↘
                       PostgreSQL / Redis
```

已运行服务：

| 服务 | 作用 | 是否直接暴露公网 |
|---|---|---|
| Nginx | 唯一入口、反向代理 | 是，仅 `80` |
| Web | AeroLog 控制台与营销页面 | 否 |
| API | 登录、项目、分析接口 | 否 |
| Collector | SDK 埋点接收 | 否，通过 `/collect/` |
| Consumer | 消费事件并写入 ClickHouse | 否 |
| PostgreSQL | 用户、权限、项目等元数据 | 否 |
| Redis | 缓存与辅助状态 | 否 |
| Redpanda | Kafka 兼容消息队列 | 否 |
| Redpanda Console | Topic、消费组查看工具 | 否，通过 `/queue/` 且需认证 |
| ClickHouse | 事件明细与分析查询 | 否 |
| Prometheus | API、Collector、Consumer 运行指标采集（保留 7 天） | 否 |
| Grafana | 监控仪表盘 | 否，通过 `/monitor/` 且需认证 |

MinIO 当前未部署；Prometheus 指标保留期设为 7 天，以控制小规格服务器的资源占用。

## 2. 访问地址与账户

- 控制台：`http://82.156.142.135/`
- API：`http://82.156.142.135/api/v1/`
- 埋点入口：`http://82.156.142.135/collect/v1/track`
- Redpanda Console：`http://82.156.142.135/queue/`
- Grafana 监控面板：`http://82.156.142.135/monitor/`

Grafana 先经过 Nginx Basic Auth，再显示 Grafana 自身登录页；两层认证均使用已配置的管理员账号。当前 Grafana 根地址固定为服务器 IP；接入域名与 HTTPS 时应同步修改 `GF_SERVER_DOMAIN` 和 `GF_SERVER_ROOT_URL`。不要直接开放 Grafana 的 `3000` 端口。

首次启动已创建两个平台管理员账户。账户邮箱和初始密码只保存在服务器的受限环境文件中，不要在代码、Issue、文档或截图中记录明文密码。

环境文件位置：

```bash
sudo ls -l /opt/aerolog/deploy/production/.env
```

它应始终保持 `600` 权限、由 `root` 拥有。该文件包含数据库密码、ClickHouse 密码、JWT 密钥和首次管理员初始化参数。

## 3. 首次部署步骤（已执行）

1. 清空旧 Docker 服务、镜像和卷。
2. 使用 SSH 密钥连接服务器。
3. 从 GitHub 克隆项目到 `/opt/aerolog`。
4. 创建仅 root 可读的 `.env` 和 `queue.htpasswd`。
5. 构建四个应用镜像：Web、API、Collector、Consumer。
6. 启动 Docker Compose 核心栈。
7. 验证首页、管理员登录、Redpanda 健康状态与 Console 认证。

生产编排文件位于仓库：

```text
deploy/production/docker-compose.yml
deploy/production/Dockerfile.go
deploy/production/Dockerfile.web
deploy/production/nginx.conf
```

## 4. 日常检查

登录服务器后执行：

```bash
cd /opt/aerolog/deploy/production
sudo docker compose ps
sudo docker stats --no-stream
free -h
df -h
```

检查网页与 API：

```bash
curl -I http://127.0.0.1/
curl http://127.0.0.1/api/healthz
curl -I http://127.0.0.1/queue/
```

预期结果：

- 首页返回 `200`；
- API 健康检查返回 `ok`；
- 未携带 Redpanda Console 认证时 `/queue/` 返回 `401`；
- `postgres`、`clickhouse`、`redpanda` 显示为 `healthy`。
- Grafana 打开后应能看到 AeroLog 预置监控面板，Prometheus Targets 中 API、Collector、Consumer 应为 `UP`。

## 5. 查看日志

```bash
cd /opt/aerolog/deploy/production

# 查看全部服务最后 200 行日志
sudo docker compose logs --tail=200

# 持续跟踪指定服务
sudo docker compose logs -f api
sudo docker compose logs -f collector
sudo docker compose logs -f consumer
sudo docker compose logs -f redpanda
sudo docker compose logs -f web
```

常见排查方向：

| 现象 | 优先查看 |
|---|---|
| 无法登录 | `api`、`postgres` 日志；确认 API 健康与管理员账户状态 |
| 埋点没有入库 | `collector`、`redpanda`、`consumer` 日志 |
| 分析页面报错或慢 | `api`、`clickhouse` 日志与内存占用 |
| 消息积压 | `/queue/` 中的 Topic 与 Consumer Group |
| 页面 502/无法打开 | `nginx`、`web` 日志 |

## 6. 更新部署

在确认 GitHub `main` 已包含待发布改动后执行：

```bash
cd /opt/aerolog
git pull --ff-only

cd deploy/production
sudo docker compose build
sudo docker compose up -d --no-build
sudo docker compose ps
```

构建 Go 服务时已固定使用 `goproxy.cn`，用于规避服务器无法稳定连接 `proxy.golang.org` 的问题。

仅更新前端时可缩短为：

```bash
cd /opt/aerolog/deploy/production
sudo docker compose build web
sudo docker compose up -d --no-deps --force-recreate web
```

仅重启单个服务：

```bash
sudo docker compose restart api
sudo docker compose restart collector
sudo docker compose restart consumer
```

不要使用 `docker compose down -v`，除非明确要删除所有数据库、队列与分析数据。

## 7. 数据与备份

持久化数据位于：

```text
/opt/aerolog/deploy/production/data/postgres
/opt/aerolog/deploy/production/data/redis
/opt/aerolog/deploy/production/data/redpanda
/opt/aerolog/deploy/production/data/clickhouse
/opt/aerolog/deploy/production/data/prometheus
/opt/aerolog/deploy/production/data/grafana
```

至少应定期备份 PostgreSQL 元数据：

```bash
sudo mkdir -p /var/backups/aerolog
sudo sh -c 'cd /opt/aerolog/deploy/production && \
  set -a && . ./.env && set +a && \
  docker compose exec -T postgres pg_dump -U aerolog aerolog \
  > /var/backups/aerolog/postgres-$(date +%F).sql'
```

ClickHouse 与 Redpanda 保存事件数据，数据量增长较快。生产环境应进一步接入对象存储或异机备份，并监控磁盘容量。不要在服务运行时直接复制其数据目录作为唯一备份方案。

## 8. 资源与扩容建议

首次验证时，核心容器常驻内存约 1 GiB；ClickHouse 与 Redpanda 是主要增长项。

- 当前 3.6 GiB 机器适合内测和低频真实流量；
- 持续埋点与复杂分析建议升级到至少 8 GiB；
- 有较多项目、长期事件留存或监控栈时建议使用 16 GiB 和更大的 NVMe 磁盘；
- Prometheus、Grafana 已启用；若磁盘或内存压力升高，优先缩短 Prometheus 保留期。
- 新增 MinIO 前，先确认内存与磁盘余量。

## 9. 已知部署注意事项

1. Redpanda 的宿主机数据目录需要可由容器用户写入。首次创建目录后如出现 `Permission denied`，执行：

   ```bash
   sudo chown -R 101:101 /opt/aerolog/deploy/production/data/redpanda
   sudo docker compose restart redpanda
   ```

2. Next.js 生产镜像必须将构建产物放在 `.next` 目录；生产 Dockerfile 已处理。

3. 当前入口使用 HTTP。正式对外使用前，应配置域名、HTTPS 证书和服务器安全组，仅开放 `80/443`。

4. Redpanda Console 的 `/queue/` 已有 Basic Auth；不要暴露 `9092`、`9644`、`8088` 等消息队列原生管理端口。认证文件 `queue.htpasswd` 需保持为 `root:101`、权限 `640`，使 Nginx 工作进程能够读取密码哈希但普通用户无法读取：

   ```bash
   sudo chown root:101 /opt/aerolog/deploy/production/queue.htpasswd
   sudo chmod 640 /opt/aerolog/deploy/production/queue.htpasswd
   sudo docker compose -f /opt/aerolog/deploy/production/docker-compose.yml exec -T nginx nginx -s reload
   ```

5. 归因分析中 CTE 的 `dim` 参数顺序已修正并有回归测试。每次发布前建议至少运行：

   ```bash
   cd /opt/aerolog/server/api
   go test ./...
   ```

## 10. 紧急恢复顺序

当服务整体异常时，按以下顺序恢复：

```bash
cd /opt/aerolog/deploy/production
sudo docker compose up -d --no-build
sudo docker compose ps
sudo docker compose logs --tail=100 redpanda clickhouse postgres api collector consumer
```

若网页仍不可访问，优先确认 Nginx 与 Web：

```bash
sudo docker compose restart web nginx
curl -I http://127.0.0.1/
```

若事件未入库，确认 `redpanda` 为 healthy 后，再依次重启：

```bash
sudo docker compose restart collector consumer
```
