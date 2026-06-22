# AeroLog 后续待办

## 已完成

- SDK Debugger 增加 Collector 侧拒绝事件记录，覆盖 token 错误、基础字段缺失、签名失败等未进入 Kafka 的请求。
- Schema 校验增加事件级规则：事件是否启用、事件必带参数集合。
- 用户时间线按 session 分组，并支持从查询结果、调试事件一键跳转到用户行为明细。
- SDK Debugger 数据增加脱敏与保留周期，默认清理 7 天前的 debug_events、schema_issues 和 schema_issue_groups。
- API/Consumer 请求链路移除运行时 DDL，元数据表统一由启动期 bootstrap 与迁移脚本维护。
- 项目增加签名强制开关，Collector 支持全局强制和项目级强制两种模式。
- Schema 问题增加聚合表，按事件、参数、期望/实际类型和错误消息归并并累计次数。
- 用户事件时间线默认按身份映射合并 distinct_id、user_id、anonymous_id 后查询。
- 事件级 Schema 隔离：`property_definitions` 增加 `event` 列与 `(project_id,name,scope,event)` 唯一键；Consumer 校验、API 治理、Web 治理页全部按事件加载/编辑属性，事件级规则覆盖全局默认。
- Android SDK 接入 `X-AeroLog-Signature`：`AeroConfig.secret` 配置项目密钥后自动用 HMAC-SHA256 对请求体签名上报。
- 转化目标支持版本记录与趋势对比：`conversion_goals` 增加 `version`、新增 `conversion_goal_versions` 表，每次保存自动写快照；`/analytics/conversion_trend` 按桶返回当前期 vs 上期 first/conversion，`/analytics/conversion_export` 流式导出参数拆解 CSV；Web 转化页新增「趋势对比」「导出 CSV」「版本备注」与「版本历史」面板。
- 自助查询支持模板/分享/CSV/异步任务：新增 `query_templates`、`analytics_jobs` 表与 `QueryHandler`，模板可保存、复用、分享（48 hex token）；`/analytics/query_table/export` 直接下载 CSV，`/analytics/jobs` 用 PG `FOR UPDATE SKIP LOCKED` 异步执行最多 5 万行结果；Web 查询页新增「保存模板」「导出 CSV」「异步导出」「模板列表」「任务列表」面板。
- 数据治理支持批量/审计/负责人/状态：`property_definitions` 增加 `owner/archived/hidden`，新增 `property_change_log` 审计表；新增 `PUT /properties/batch`、`GET /properties/:name/change_log`，前端治理页加入勾选 + 批量工具栏、行内归档/隐藏切换以及变更历史抽屉。
- Android SDK 完善传输与自动采集：`AeroConfig` 增加 `enableGzip / enableLocalDebugLog / debugLogCapacity / autoTrackActivityDuration / autoTrackCrash / autoTrackANR / autoTrackInstall`；`send()` 在 ≥1KB 时启用 gzip 并保持 HMAC 对原始包体签名；新增 `$AppViewScreenEnd($screen_duration)`、`$AppCrash`、`$AppANR`、`$AppInstall/$AppUpdate` 自动事件，并提供 `getDebugLogs()/clearDebugLogs()` 本地环形缓冲。
- 多项目权限与真实登录：新增 `users/auth_sessions/project_members`，API 支持登录/注册/退出/当前用户，项目成员 owner/editor/viewer 权限控制；历史孤儿项目自动归属默认管理员；Web 增加登录页、成员管理页、顶部退出登录和请求 Bearer token。
- 成员管理增强：成员列表支持姓名/邮箱/手机/公司/项目/职位关键词实时过滤；编辑抽屉覆盖基本信息、启停状态、项目授权一次性提交；公司主账号路由保护与 `project_count` 计数 bug 修复。
- 事件归因（首次/末次/线性）：新增 `POST /v1/projects/:id/analytics/attribution`，三种模型基于触点回看窗口聚合 credit/users/avg_lag；Web 新增「归因」页（自上而下流式布局，工具栏 5 列对齐：开始/结束时间 + 回看窗口 + 模型 + 转化事件 + 触点选择）。
- 接口文档站：手写 `docs/openapi.yaml` 覆盖现有路由，按认证/成员/项目/事件元数据/行为分析/查询任务/治理/用户画像/分享 9 个 Tag 分组；API 服务通过 `//go:embed` 内嵌并暴露 `GET /swagger/`（Swagger UI，CDN 加载）和 `GET /swagger/openapi.yaml`（规格文件），无需新增 Go 依赖。

## P0

（暂无）

## P1

- [x] P1 端到端验收：覆盖转化目标版本/趋势/导出、自助查询模板/分享/CSV/异步任务、数据治理批量/负责人/状态/审计，并沉淀为 `make p1-smoke`。
- [x] Android SDK 增加 root Gradle 工程与 CI 编译验证：`sdk/android` 已补 `settings.gradle.kts`、root `build.gradle.kts`、`:sample` 示例 App、`make android-sdk-build` 和 GitHub Actions workflow。
- [x] 多项目权限与成员管理：owner/editor/viewer、项目成员、操作人透传。
- [ ] 分享链接增强：过期时间、撤销记录、访问日志和权限边界。
- [ ] 导出文件存储正规化：本地/MinIO/S3 适配、过期清理、下载鉴权。
- [ ] SDK Debugger 闭环：按 `$insert_id`、设备、用户、session 串联 SDK 本地日志、Collector、Schema、Consumer、ClickHouse 查询结果。

## P2

- 分群：支持静态/动态用户分群、按事件行为和用户属性圈选。
- 用户路径分析：按 session 和身份合并后的行为路径做节点流转。
- 事件归因增强：在已落地的 first/last/linear 之上补充渠道、活动等触点维度，以及无触点用户占比、归因窗口分桶等扩展。
- 留存细分：留存矩阵按事件属性、用户属性和渠道拆解。
- 漏斗按属性分组：漏斗每一步支持参数过滤和分组对比。
- 指标看板保存与订阅：保存报表卡片、定时邮件/告警推送。
- 告警中心：Schema 错误率、事件量突降、关键转化异常。
- 接入 OpenTelemetry Dashboard，统一展示 collector/consumer/api 延迟、吞吐和 DLQ。
- 补 iOS/Web SDK，并统一 SDK 发布、版本兼容矩阵和示例应用。
