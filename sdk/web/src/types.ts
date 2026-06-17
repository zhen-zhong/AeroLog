// 三端共用的上报事件结构（与 docs/event.schema.json 对齐）

export type EventType =
  | "track"
  | "profile_set"
  | "profile_set_once"
  | "profile_increment"
  | "profile_unset"
  | "profile_delete";

export interface Lib {
  name: "web" | "android" | "ios" | "server";
  version?: string;
}

export interface AeroEvent {
  type: EventType;
  event: string;
  distinct_id: string;
  anonymous_id?: string;
  user_id?: string;
  time: number; // unix ms
  lib: Lib;
  properties?: Record<string, unknown>;
}

export interface AeroLogConfig {
  /** Collector base URL，例如 https://collector.aerolog.example */
  serverUrl: string;
  /** 项目 token (AppKey) */
  token: string;
  /** 单批最大事件数；默认 50 */
  batchSize?: number;
  /** 上报间隔 ms；默认 5000 */
  flushInterval?: number;
  /** 是否启用自动 pageview；默认 true */
  autoTrackPageView?: boolean;
  /** 是否启用全局 click 自动埋点；默认 false */
  autoTrackClick?: boolean;
  /** 本地最大缓存条数；默认 10000 */
  storageLimit?: number;
  /** 调试模式：上报失败抛 console.error */
  debug?: boolean;
  /** SDK 版本，由打包注入 */
  libVersion?: string;
}
