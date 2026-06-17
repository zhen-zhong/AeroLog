# AeroLog Android SDK

Kotlin 实现，依赖：Room（离线缓存）、OkHttp、kotlinx-coroutines、AndroidX Lifecycle。

## 引入

```kotlin
// settings.gradle.kts
include(":app", ":sdk:android:aerolog")

// app/build.gradle.kts
dependencies {
    implementation(project(":sdk:android:aerolog"))
}
```

## 用法

```kotlin
class App : Application() {
    override fun onCreate() {
        super.onCreate()
        AeroLog.init(this, AeroConfig(
            serverUrl = "https://collector.aerolog.example",
            token = BuildConfig.AEROLOG_TOKEN,
            autoTrackAppLifecycle = true,
            autoTrackActivity = true,
        ))
    }
}

// 业务使用
AeroLog.track("button_click", mapOf("btn" to "checkout"))
AeroLog.identify("user_1024")
AeroLog.setProfile(mapOf("vip_level" to 3))
```

## 离线兜底

- 内存批量：默认 50 条 / 5 秒触发上报
- 失败 / 离线：写入 Room（SQLite）
- 容量：默认本地最多 10000 条，超限丢最旧
- App 退到后台时主动 flush
