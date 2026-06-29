# aerolog

AeroLog Web SDK：浏览器端埋点采集，支持批量、压缩、IndexedDB 离线兜底与指数退避重传。

## 安装

```bash
pnpm add aerolog
```

## 快速开始

### 方式一：SaaS 接入（推荐）

```ts
import { init } from "aerolog";

const aero = init({
  token: "YOUR_PROJECT_TOKEN",
});
```

默认上报到 `https://collector.aerolog.cc`。

### 方式二：私有化部署

```ts
import { init } from "aerolog";

const aero = init({
  token: "YOUR_PROJECT_TOKEN",
  serverUrl: "https://collector.your-company.com",
  autoTrackPageView: true,
  autoTrackClick: false,
  debug: false,
});

// 行为事件
aero.track("button_click", { btn: "checkout" });

// 用户标识
aero.identify("user_1024");

// 用户属性
aero.setProfile({ vip_level: 3 });

// 立即上报（页面切换时建议 await）
await aero.flush();
```

## 离线兜底

- 内存批量：默认 50 条 / 5 秒触发上报
- 失败 / 离线：写入 IndexedDB（不可用时降级到内存数组）
- 重试：指数退避 1s → 3s → 10s → 30s → 1min → 5min；`online` 事件触发立刻重传
- 容量：默认本地最多 10000 条，超限丢弃最旧
- 卸载兜底：`visibilitychange` + `pagehide` 走 `sendBeacon`

## 自动属性

`$os / $os_version / $browser / $browser_version / $user_agent / $screen_* / $network_type / $session_id / $insert_id`

## 构建

```bash
pnpm build
```

输出 `dist/index.js`（ESM）、`dist/index.cjs`（CJS）、`dist/index.global.js`（IIFE，UMD 风格）。

发新版
npm version patch
npm run build
npm publish
