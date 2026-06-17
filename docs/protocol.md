# AeroLog 上报协议 v1

> 三端 SDK（Android / iOS / Web）→ Collector 的统一上报协议。

## 1. 端点

```
POST /v1/track?token={projectToken}
Host: collector.aerolog.example
Content-Type: application/json
Content-Encoding: gzip          # 可选，建议开启
X-AeroLog-SDK: web/1.0.0        # SDK 名称/版本
X-AeroLog-Sign: {hmac_sha256_hex} # 可选；服务端校验失败时返回 401
X-AeroLog-Ts:   {unix_ms}        # 时间戳，5 分钟外拒绝
```

简易模式（不启用签名）：仅校验 token 是否有效。

## 2. 请求体

支持单条或批量数组：

```json
[
  {
    "type": "track",
    "event": "$AppStart",
    "distinct_id": "u_1024",
    "anonymous_id": "a_2f5c...",
    "time": 1718432000123,
    "lib": { "name": "web", "version": "1.0.0" },
    "properties": {
      "$os": "macOS",
      "$os_version": "15.3",
      "$screen_width": 1440,
      "$screen_height": 900,
      "$browser": "Chrome",
      "$browser_version": "126.0",
      "$app_version": "2.3.1",
      "$network_type": "wifi",
      "page_url": "https://example.com/home",
      "custom_prop": "value"
    }
  }
]
```

字段定义见 [event.schema.json](./event.schema.json)。

## 3. 预置属性（自动采集）

约定以 `$` 开头，三端 SDK 应自动尽量采集：

| 属性 | 类型 | 说明 |
|---|---|---|
| `$lib` | string | web/android/ios |
| `$lib_version` | string | SDK 版本 |
| `$os` | string | macOS/Windows/iOS/Android |
| `$os_version` | string | |
| `$model` | string | 设备型号（移动端） |
| `$manufacturer` | string | 设备厂商（移动端） |
| `$app_version` | string | 宿主 App 版本 |
| `$network_type` | string | wifi / 4g / 5g / unknown |
| `$screen_width` / `$screen_height` | int | 屏幕分辨率 |
| `$browser` / `$browser_version` | string | 仅 Web |
| `$user_agent` | string | 仅 Web |
| `$ip` | string | 服务端从 `X-Forwarded-For` 提取并富化为 country/province/city |
| `$session_id` | string | 会话标识 |

## 4. 预置事件

| 事件 | 触发时机 |
|---|---|
| `$AppStart` | App 启动 / 页面首次加载 |
| `$AppEnd`   | App 退到后台 / 页面卸载 |
| `$AppViewScreen` / `$pageview` | 路由切换（SPA / Activity / VC） |
| `$AppClick` / `$WebClick` | 自动埋点：可点击元素被点击 |
| `$SignUp` | 首次绑定 user_id（identify） |

## 5. 响应

成功：

```json
{ "code": 0, "msg": "ok", "accepted": 50 }
```

失败：

| code | 含义 |
|---|---|
| 4001 | token 无效 |
| 4002 | 签名校验失败 |
| 4003 | 时间戳过期 |
| 4004 | 请求体过大或解析失败 |
| 4005 | schema 校验失败（部分通过会按条返回拒绝列表） |
| 4290 | 触发限流，建议指数退避 |
| 5xxx | 服务端错误，SDK 应缓存并稍后重试 |

## 6. 离线兜底约定

SDK 应保证：
1. **批量**：默认 50 条 / 5 秒触发上报；
2. **持久化**：HTTP 4xx（非限流）丢弃；HTTP 5xx / 网络错误 / 限流 → 写本地存储；
3. **重试**：指数退避 1s/3s/10s/30s/5min，网络恢复立即触发；
4. **容量**：本地最多保留 7 天 / 10000 条，超限丢弃最旧；
5. **去重**：每条事件由 SDK 生成 UUID 写入 `properties.$insert_id`，服务端可据此去重。

## 7. 用户身份

- **anonymous_id**：SDK 首次启动生成 UUID，存本地；
- **identify(user_id)**：登录时调用，SDK 把 `distinct_id` 切换为 `user_id`，并触发 `$SignUp`（携带 anonymous_id ↔ user_id 关联）；
- **logout()**：恢复使用 anonymous_id。

## 8. 兼容性

接入路径同时提供 `/sa?project=xxx` 兼容神策 SDK 协议（仅做字段映射），便于复用调试工具。
