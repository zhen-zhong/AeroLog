# AeroLog Web Console

AeroLog 管理后台 + 数据看板，基于 Next.js 14 (App Router) + Ant Design + TanStack Query + ECharts。

## 路由说明

| 路径 | 说明 |
| --- | --- |
| `/` | 重定向到 `/console` |
| `/console` | 数据看板（Top 事件 + 趋势折线） |
| `/admin/projects` | 项目管理（列表 / 新建） |
| `/admin/events` | 埋点元数据列表（按项目筛选） |

## 启动

```bash
# 1. 启动基础设施 + 后端
docker compose -f deploy/docker-compose.yml up -d
cd server/api && go run ./cmd            # 默认 8082

# 2. 启动 web
cd web
npm install
NEXT_PUBLIC_API_BASE=http://localhost:8082 npm run dev
```

打开 <http://localhost:3000> 即可访问。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE` | `http://localhost:8082` | Go API 地址（浏览器侧请求） |

## 架构关系

```
Browser ──HTTP──> Next.js (this app) ──HTTP──> server/api (Go) ──> Postgres / ClickHouse
```

- 元数据接口（项目、埋点定义）→ Postgres
- 分析接口（top_events / trend）→ ClickHouse
