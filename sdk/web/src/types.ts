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

/** AeroLog SaaS 官方 Collector 入口；私有化客户请覆盖 [AeroLogConfig.serverUrl]。 */
export const DEFAULT_SERVER_URL = "https://collector.aerolog.cc";

export interface AeroLogConfig {
  /** 项目 token (AppKey) */
  token: string;
  /**
   * Collector base URL。SaaS 用户可省略，默认走 [DEFAULT_SERVER_URL]；
   * 私有化部署请显式填写，例如 https://collector.example.com 或本地 http://localhost:8081。
   */
  serverUrl?: string;
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
