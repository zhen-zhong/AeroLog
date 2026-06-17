# AeroLog Android SDK

AeroLog Android SDK 是三端统一上报协议的 Android 实现，适合在原生 Android / Kotlin 项目中采集自定义事件、自定义参数、用户身份与用户画像。

当前能力：

- 自定义事件：`AeroLog.track("event_name", mapOf(...))`
- 自定义参数：支持字符串、数字、布尔、数组、Map、Date、JSON 对象等常见类型
- 公共属性：一次注册，后续事件自动携带
- 用户身份：匿名 ID、登录 ID、`$SignUp` 身份合并
- 用户画像：`profile_set`、`profile_set_once`、`profile_increment`、`profile_unset`、`profile_delete`
- 自动采集：App 启停、Activity 浏览、设备、系统、网络、屏幕、App 版本
- 离线兜底：内存批量 + Room 持久化 + 后台 flush

## 引入

当前仓库提供源码 module，宿主项目可直接 include：

```kotlin
// settings.gradle.kts
include(":app", ":sdk:android:aerolog")
```

```kotlin
// app/build.gradle.kts
dependencies {
    implementation(project(":sdk:android:aerolog"))
}
```

SDK module 依赖：

- Room：本地离线缓存
- OkHttp：HTTP 上报
- kotlinx-coroutines：异步 flush
- AndroidX Lifecycle：App 前后台自动采集

## 初始化

建议在自定义 `Application` 中初始化：

```kotlin
class App : Application() {
    override fun onCreate() {
        super.onCreate()

        AeroLog.init(
            this,
            AeroConfig(
                serverUrl = "https://collector.aerolog.example",
                token = BuildConfig.AEROLOG_TOKEN,
                batchSize = 50,
                flushIntervalMs = 5_000L,
                storageLimit = 10_000,
                autoTrackAppLifecycle = true,
                autoTrackActivity = true,
                debug = BuildConfig.DEBUG,
            ),
        )
    }
}
```

本地 Android 模拟器联调项目内 Collector 时，`serverUrl` 通常写：

```kotlin
serverUrl = "http://10.0.2.2:8081"
```

真机联调请改为局域网 IP 或可访问域名。

## 自定义事件

最常用写法：

```kotlin
AeroLog.track(
    "view_product",
    mapOf(
        "product_id" to "sku_1024",
        "category" to "analytics",
        "price" to 199.0,
        "in_stock" to true,
    ),
)
```

Kotlin `Pair` 写法：

```kotlin
AeroLog.track(
    "pay_success",
    "order_id" to "ord_20260617_001",
    "amount" to 299.0,
    "payment_method" to "wechat_pay",
)
```

指定事件发生时间：

```kotlin
AeroLog.track(
    event = "offline_order_paid",
    properties = mapOf("amount" to 99.0),
    time = System.currentTimeMillis() - 30_000,
)
```

事件名要求：

- 非空
- 长度不超过 128
- 业务事件建议使用小写蛇形命名：`view_product`、`add_to_cart`、`pay_success`
- `$` 开头的事件名保留给预置事件，例如 `$AppStart`

## 自定义参数

参数会写入上报协议的 `properties` 字段。SDK 会自动合并：

1. 自动采集属性，例如 `$os`、`$model`、`$screen_width`
2. 公共属性
3. 当前事件自定义参数

同名时，后面的优先级更高，因此事件自定义参数可以覆盖公共属性。

支持的参数类型：

| Kotlin 类型 | 上报 JSON |
|---|---|
| `String` | string |
| `Int` / `Long` / `Float` / `Double` / 其他 `Number` | number |
| `Boolean` | boolean |
| `Date` | 毫秒时间戳 |
| `Map<String, Any?>` | object |
| `Iterable<*>` / `Array<*>` | array |
| `JSONObject` / `JSONArray` | 原样写入 |
| `Enum` | enum name |
| 其他对象 | `toString()` |

参数名要求：

- 非空
- 长度不超过 128
- `$` 开头表示预置属性，请谨慎覆盖
- 不建议传超大对象、图片、二进制内容、完整日志文本

嵌套参数示例：

```kotlin
AeroLog.track(
    "search",
    mapOf(
        "keyword" to "漏斗分析",
        "filters" to mapOf(
            "plan" to "enterprise",
            "region" to "CN",
        ),
        "result_ids" to listOf("sku_1", "sku_2", "sku_3"),
    ),
)
```

## 公共属性

公共属性适合放渠道、App 构建环境、业务线、实验分组等会随很多事件重复出现的字段。

```kotlin
AeroLog.registerSuperProperties(
    mapOf(
        "channel" to "xiaomi_store",
        "app_env" to "prod",
        "ab_bucket" to "B",
    ),
)
```

移除公共属性：

```kotlin
AeroLog.unregisterSuperProperty("ab_bucket")
AeroLog.clearSuperProperties()
```

## 用户身份

SDK 首次启动会生成并持久化 `anonymous_id`。用户登录后调用：

```kotlin
AeroLog.identify("user_1024")
// 或
AeroLog.login("user_1024")
```

首次从匿名态绑定到登录态时，SDK 会自动上报：

```json
{
  "event": "$SignUp",
  "anonymous_id": "anon_xxx",
  "user_id": "user_1024"
}
```

Consumer 会根据这条事件写入身份映射，用于匿名行为和登录用户画像合并。

退出登录：

```kotlin
AeroLog.logout()
```

获取当前标识：

```kotlin
val anonymousId = AeroLog.getAnonymousId()
val userId = AeroLog.getUserId()
```

## 用户画像

覆盖用户属性：

```kotlin
AeroLog.setProfile(
    mapOf(
        "name" to "张三",
        "plan" to "growth",
        "city" to "Shanghai",
    ),
)
```

只在首次为空时写入：

```kotlin
AeroLog.setProfileOnce(
    mapOf("first_channel" to "organic"),
)
```

数值累加：

```kotlin
AeroLog.incrementProfile(
    mapOf("total_orders" to 1, "total_amount" to 299.0),
)
```

删除部分属性：

```kotlin
AeroLog.unsetProfile("city", "plan")
```

删除整个画像：

```kotlin
AeroLog.deleteProfile()
```

## 自动采集属性

每条事件会自动携带：

| 属性 | 说明 |
|---|---|
| `$insert_id` | SDK 生成的事件去重 ID |
| `$session_id` | 当前 App 前台会话 |
| `$lib` / `$lib_version` | SDK 名称和版本 |
| `$os` / `$os_version` | Android 系统信息 |
| `$model` / `$manufacturer` | 设备型号和厂商 |
| `$network_type` | `wifi` / `cellular` / `ethernet` / `unknown` |
| `$screen_width` / `$screen_height` | 屏幕像素 |
| `$app_version` | 宿主 App 版本 |

自动事件：

| 事件 | 开关 | 说明 |
|---|---|---|
| `$AppStart` | `autoTrackAppLifecycle` | App 进入前台 |
| `$AppEnd` | `autoTrackAppLifecycle` | App 进入后台，包含 `$event_duration` |
| `$AppViewScreen` | `autoTrackActivity` | Activity resume，包含 `$screen_name` / `$screen_title` |

## 手动 flush

普通业务代码：

```kotlin
AeroLog.flushAsync { ok ->
    Log.d("AeroLog", "flush result: $ok")
}
```

协程环境：

```kotlin
val ok = AeroLog.flush()
```

SDK 也会在以下场景自动 flush：

- 内存缓冲达到 `batchSize`
- 每隔 `flushIntervalMs`
- App 进入后台

## 离线兜底

- 内存批量：默认 50 条 / 5 秒触发上报
- 网络失败、5xx、429：写入 Room，等待后续重试
- 4xx 非 429：认为服务端拒绝，不再重试，避免本地堆积脏数据
- 容量：默认本地最多 10000 条，超限丢最旧
- App 退到后台时主动 flush

## 调试

初始化时打开 `debug`：

```kotlin
AeroLog.init(
    this,
    AeroConfig(
        serverUrl = "http://10.0.2.2:8081",
        token = "PROJECT_TOKEN",
        debug = true,
    ),
)
```

然后查看 Logcat：

```text
tag:AeroLog
```

服务端验证：

```bash
curl 'http://localhost:8082/v1/projects/{project_id}/events'
curl 'http://localhost:8082/v1/projects/{project_id}/properties?scope=event'
curl 'http://localhost:8082/v1/projects/{project_id}/users?limit=20'
```

## 推荐事件命名

建议先围绕核心业务流程定义一批稳定事件：

```kotlin
AeroLog.track("search", "keyword" to keyword, "result_count" to count)
AeroLog.track("view_product", "product_id" to productId, "category" to category)
AeroLog.track("add_to_cart", "product_id" to productId, "quantity" to quantity)
AeroLog.track("checkout_start", "cart_value" to cartValue)
AeroLog.track("pay_success", "order_id" to orderId, "amount" to amount)
```

这些事件会上报到 Collector，经 Consumer 自动进入事件字典和属性字典，可在 Web 控制台的事件分析、漏斗分析、留存分析中使用。
