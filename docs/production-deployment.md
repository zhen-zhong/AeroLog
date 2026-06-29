# AeroLog 生产部署与维护手册

本文记录 2026-06-23 在 Ubuntu 服务器上的首次部署方案、已验证结果，以及后续更新和故障处理方式。

> **最近更新**
> - 2026-06-23：首次部署完成，包含 Prometheus + Grafana 监控栈。
> - 2026-06-23：SDK 改造为 *SaaS 默认 + 私有化覆盖* 双模式，默认 `serverUrl = https://collector.aerolog.cc`。本部署当前仅能以「私有化」模式接入，必须在 SDK 初始化时显式传入 `serverUrl`。
> - 2026-06-25：生产持久化数据已从仓库目录迁移到 `/var/lib/aerolog/*`，避免代码目录权限修复误伤数据库、队列和监控数据。
> - 2026-06-25：新增独立工具集合入口，当前 `tools/moive` 通过 `/tools/moive/` 访问。
> - 2026-06-29：API 与 Collector JSON 响应统一为 `data` / `message` / `code` 三段结构；Web SDK npm 包名为 `aerolog`。
> - 域名与 HTTPS。`aerolog.cc` 不在工信部备案白名单内，本机器位于腾讯云北京节点，未备案时 `80/443` 会被拦截；详见§12。

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
      ├── /queue/*       → Redpanda Console（Basic Auth）
      ├── /monitor/*     → Grafana（Basic Auth）
      └── /tools/moive/* → vidsrc-parser 工具容器

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
| Tools / moive | `vidsrc-parser` 前端工具，独立 Docker Compose 项目 | 否，通过 `/tools/moive/` |

MinIO 当前未部署；Prometheus 指标保留期设为 7 天，以控制小规格服务器的资源占用。

## 2. 访问地址与账户

- 控制台：`http://82.156.142.135/`
- API：`http://82.156.142.135/api/v1/`
- 埋点入口：`http://82.156.142.135/collect/v1/track`
- Redpanda Console：`http://82.156.142.135/queue/`
- Grafana 监控面板：`http://82.156.142.135/monitor/`
- 工具集合 / moive：`http://82.156.142.135/tools/moive/`

Grafana 先经过 Nginx Basic Auth，再显示 Grafana 自身登录页；两层认证均使用已配置的管理员账号。当前 Grafana 根地址固定为服务器 IP；接入域名与 HTTPS 时应同步修改 `GF_SERVER_DOMAIN` 和 `GF_SERVER_ROOT_URL`。不要直接开放 Grafana 的 `3000` 端口。

首次启动已创建两个平台管理员账户。账户邮箱和初始密码只保存在服务器的受限环境文件中，不要在代码、Issue、文档或截图中记录明文密码。

环境文件位置：

```bash
sudo ls -l /opt/aerolog/deploy/production/.env
```

它应始终保持 `600` 权限、由 `root` 拥有。该文件包含数据库密码、ClickHouse 密码、JWT 密钥和首次管理员初始化参数。

### 2.1 SDK 接入到当前部署

SDK 默认上报到官方 SaaS（`https://collector.aerolog.cc`）。接入当前服务器这套部署时，**必须显式覆盖 `serverUrl`**，指向 Nginx 的 `/collect` 路由：

```kotlin
// Android
AeroLog.init(
    application,
    AeroConfig(
        token = "YOUR_PROJECT_TOKEN",
        serverUrl = "http://82.156.142.135/collect",
    ),
)
```

```ts
// Web
import { init } from "aerolog";
const aero = init({
    token: "YOUR_PROJECT_TOKEN",
    serverUrl: "http://82.156.142.135/collect",
});
```

```swift
// iOS
AeroLog.shared.setup(AeroConfig(
    token: "YOUR_PROJECT_TOKEN",
    serverUrl: "http://82.156.142.135/collect"
))
```

说明：
- SDK 请求路径为 `${serverUrl}/v1/track?token=...`，与 Nginx 反代规则 `/collect/v1/*` 对齐。
- 未完成备案之前不能用 HTTPS。**iOS App 默认拒绝明文 HTTP**，如需联调请临时在 `Info.plist` 中为该主机加一条 ATS 例外；Android 9+ 同理，需 `usesCleartextTraffic` 的网络安全配置。
- **生产上线的正确做法是备案 / 换香港机（§12）**，不要以 IP 明文形式对外发 SDK。

### 2.2 接口响应结构

API 与 Collector 的 JSON 响应统一为三段：

```json
{
  "data": {},
  "message": "ok",
  "code": 0
}
```

约定：

- `data`：业务数据。错误场景通常为 `null`；Collector 会返回 `{ "accepted": 0, "rejected": 0 }` 这类处理统计。
- `message`：人类可读提示。成功默认为 `ok`；错误时放错误原因。
- `code`：业务码。成功为 `0`；API 普通错误默认使用 HTTP 状态码；Collector 保留更细的采集错误码，例如无效 token 为 `4001`。

示例：

```json
{"data":null,"message":"unauthorized","code":401}
```

```json
{"data":{"accepted":0,"rejected":0},"message":"invalid token","code":4001}
```

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

服务重建后如果 Nginx 短暂返回 `502 Bad Gateway`，通常是 Docker 容器 IP 变化后 Nginx upstream 还未重新解析。确认目标容器健康后执行：

```bash
sudo docker compose ps api collector web nginx
sudo docker compose exec nginx nginx -t
sudo docker compose exec nginx nginx -s reload
```

然后重新验证：

```bash
curl -i http://127.0.0.1/api/v1/auth/me
curl -i -X POST 'http://127.0.0.1/collect/v1/track?token=invalid' \
  -H 'Content-Type: application/json' \
  --data '[]'
```

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
/var/lib/aerolog/postgres
/var/lib/aerolog/redis
/var/lib/aerolog/redpanda
/var/lib/aerolog/clickhouse
/var/lib/aerolog/prometheus
/var/lib/aerolog/grafana
```

`/opt/aerolog/deploy/production/data` 仅保留为历史迁移备份，不再作为当前生产挂载源。新的挂载路径写在 `deploy/production/docker-compose.yml` 中，目的是让代码仓库与数据库、队列、监控数据解耦。

不要对 `/opt/aerolog` 执行递归属主修复后再覆盖生产数据。尤其禁止用下面这种命令作为常规维护动作：

```bash
sudo chown -R ubuntu:ubuntu /opt/aerolog
```

如果必须修复代码目录属主，只处理代码和配置文件，并排除生产数据目录：

```bash
sudo find /opt/aerolog \
  -path /opt/aerolog/deploy/production/data -prune \
  -o -exec chown ubuntu:ubuntu {} +
```

当前生产数据目录的推荐属主：

| 目录 | 容器用户 | 修复命令 |
|---|---|---|
| `/var/lib/aerolog/postgres` | `70:70` | `sudo chown -R 70:70 /var/lib/aerolog/postgres` |
| `/var/lib/aerolog/redpanda` | `101:101` | `sudo chown -R 101:101 /var/lib/aerolog/redpanda` |
| `/var/lib/aerolog/grafana` | `472:0` | `sudo chown -R 472:0 /var/lib/aerolog/grafana` |
| `/var/lib/aerolog/prometheus` | `65534:65534` | `sudo chown -R 65534:65534 /var/lib/aerolog/prometheus` |

Redis、ClickHouse 当前可沿用迁移后的目录权限；如出现 `permission denied`，先查看对应容器日志和挂载目录属主，再按镜像内运行用户修复。

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

首次验证时，核心容器常驻内存约 1.6 GiB（含监控栈）；ClickHouse 与 Redpanda 是主要增长项。

- 当前 3.6 GiB 机器适合内测和低频真实流量；`free -h` 可用 1–2 GiB，剩余较紧张。
- 持续埋点与复杂分析建议升级到至少 8 GiB；
- 有较多项目、长期事件留存或监控栈时建议使用 16 GiB 和更大的 NVMe 磁盘；
- Prometheus 保留期设为 7 天；若磁盘或内存压力升高，优先缩短或临时停掉 Prometheus / Grafana。
- 新增 MinIO 前，先确认内存与磁盘余量。

## 9. 已知部署注意事项

1. Redpanda 的宿主机数据目录需要可由容器用户写入。首次创建目录后如出现 `Permission denied`，执行：

   ```bash
   sudo chown -R 101:101 /var/lib/aerolog/redpanda
   sudo rm -f /var/lib/aerolog/redpanda/pid.lock
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

6. SDK 默认 `serverUrl = https://collector.aerolog.cc`（SaaS 官方入口）。接入当前服务器部署必须显式覆盖 `serverUrl` 为 `http://82.156.142.135/collect`（未上 HTTPS 前），详见§2.1。

7. `tools/moive` 是独立工具项目，源码位于 `/opt/aerolog/tools/moive`，使用自己的 `docker-compose.yml` 构建并接入 `aerolog_internal` / `aerolog_edge` 网络。外层 Nginx 通过 Docker 内部 DNS `aerolog-tools-moive` 转发 `/tools/moive/`，该名字不是公网域名。

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

## 11. 域名与 HTTPS 路线

当前状态：

- 主机位于**腾讯云北京节点**，按工信部规定，域名解析到国内服务器的 `80/443` 必须完成 ICP 备案。
- `aerolog.cc` 属于 ccTLD，**不在工信部备案白名单内**，无法完成备案。
- 腾讯云账号**已实名**，但未提交网站备案。

可选路径：

| 方案 | 描述 | 优劣势 |
|---|---|---|
| **A. 保留 `aerolog.cc`，迁移到香港 / 海外轻量服务器** | 香港机位免备案，免拦截。`aerolog.cc` 直接解析到香港 IP 即可开启 HTTPS。 | 品牌名不变，立刻可用；需重建一轮数据迁移；业务唯一增本约 24 元/月。 |
| **B. 留在北京机，换为可备案域名（`.cn` / `.com.cn` / `.com`）** | 在腾讯云提交 ICP 备案（7–20 个工作日）。 | 服务器不动；需等备案；需同步修改品牌与 SDK 默认域名。 |
| **C. 不备案、用非 80/443 端口临时过渡** | 用 `aerolog.cc:8080` 类似路径交付内部 demo。 | URL 不干净；HTTPS 证书领取麻烦；不适合对外交付。 |

记录以供后续决策。一旦选定路线，需同步调整：

1. **Nginx**：`server_name` 与 Basic Auth realm。
2. **Grafana**：`GF_SERVER_DOMAIN` / `GF_SERVER_ROOT_URL`。
3. **SDK 默认值**：全局搜索 `collector.aerolog.cc` 替换为真实公网域名。
4. **安全组 / 防火墙**：仅开放 `80/443`，关闭不必要的原生端口。
5. **HTTPS 证书**：推荐 Let's Encrypt × acme.sh，挂载到 Nginx 容器；或接入腾讯云免费证书。
