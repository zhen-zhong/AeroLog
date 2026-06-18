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

## P0

（暂无）

## P1

（暂无）

## P2

- 多项目权限与成员管理，区分 owner/editor/viewer。
- 告警中心：Schema 错误率、事件量突降、关键转化异常。
- 接入 OpenTelemetry Dashboard，统一展示 collector/consumer/api 延迟、吞吐和 DLQ。
- 补 iOS/Web SDK，并统一 SDK 发布、版本兼容矩阵和示例应用。
