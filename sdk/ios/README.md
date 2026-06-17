# AeroLog iOS SDK

Swift Package。最低 iOS 13。

## 引入

```swift
// Package.swift
.package(path: "../../sdk/ios"),

// 或者通过 Xcode → File → Add Packages → Local
```

## 用法

```swift
import AeroLog

@main
struct App: App {
    init() {
        AeroLog.shared.setup(AeroConfig(
            serverUrl: "https://collector.aerolog.example",
            token: "YOUR_TOKEN"
        ))
    }
    var body: some Scene { WindowGroup { ContentView() } }
}

// 业务使用
AeroLog.shared.track("button_click", properties: ["btn": "checkout"])
AeroLog.shared.identify("user_1024")
AeroLog.shared.setProfile(["vip_level": 3])
```

## 离线兜底

- 内存批量：默认 50 条 / 5s 触发上报
- 持久化：失败 / 离线写入 Application Support 目录的 `events.ndjson`
- 容量：默认 10000 条，超限丢最旧
- App 进入后台时主动 flush
