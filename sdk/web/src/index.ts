// AeroLog Web SDK
// 三阶段上报：内存批量 → 失败落 IndexedDB → 退避重传

import { DEFAULT_SERVER_URL, type AeroEvent, type AeroLogConfig, type EventType, type Lib } from "./types";
import { EventStore, type StoredEvent } from "./storage";
import { backoffMs, detectBrowser, detectNetwork, detectOS, isOnline, nowMs, uuid } from "./utils";

const ANON_KEY = "aerolog:anon_id";
const USER_KEY = "aerolog:user_id";
const SESSION_KEY = "aerolog:session_id";
const SESSION_TIMEOUT = 30 * 60 * 1000;

const SDK_VERSION = "0.1.0";
const LIB: Lib = { name: "web", version: SDK_VERSION };

export class AeroLog {
  private cfg: Required<Omit<AeroLogConfig, "libVersion">> & { libVersion: string };
  private store: EventStore;
  private buffer: AeroEvent[] = [];
  private flushing = false;
  private retryAttempt = 0;
  private timer: number | null = null;
  private superProps: Record<string, unknown> = {};
  private anonId: string;
  private userId: string | null;
  private sessionId: string;

  constructor(cfg: AeroLogConfig) {
    this.cfg = {
      serverUrl: (cfg.serverUrl ?? DEFAULT_SERVER_URL).replace(/\/$/, ""),
      token: cfg.token,
      batchSize: cfg.batchSize ?? 50,
      flushInterval: cfg.flushInterval ?? 5000,
      autoTrackPageView: cfg.autoTrackPageView ?? true,
      autoTrackClick: cfg.autoTrackClick ?? false,
      storageLimit: cfg.storageLimit ?? 10000,
      debug: cfg.debug ?? false,
      libVersion: cfg.libVersion ?? LIB.version ?? SDK_VERSION,
    };
    this.store = new EventStore(this.cfg.storageLimit);
    this.anonId = this.loadOrCreateAnonId();
    this.userId = this.readStorage(USER_KEY);
    this.sessionId = this.ensureSession();

    this.attachLifecycle();
    this.scheduleTick();

    if (this.cfg.autoTrackPageView) this.trackPageView();
    if (this.cfg.autoTrackClick) this.attachClickHandler();
  }

  // ========== 公共 API ==========

  track(event: string, properties?: Record<string, unknown>): void {
    this.enqueue("track", event, properties);
  }

  identify(userId: string): void {
    const prev = this.userId;
    this.userId = userId;
    this.writeStorage(USER_KEY, userId);
    if (!prev) {
      this.enqueue("track", "$SignUp", { $anonymous_id: this.anonId });
    }
  }

  logout(): void {
    this.userId = null;
    this.removeStorage(USER_KEY);
  }

  setProfile(props: Record<string, unknown>): void {
    this.enqueue("profile_set", "", props);
  }

  setProfileOnce(props: Record<string, unknown>): void {
    this.enqueue("profile_set_once", "", props);
  }

  registerSuperProperties(props: Record<string, unknown>): void {
    this.superProps = { ...this.superProps, ...props };
  }

  /** 立即上报当前缓冲；返回 Promise 便于 SPA 路由切换前等待 */
  async flush(): Promise<void> {
    await this.drainBuffer();
    await this.uploadFromStore();
  }

  // ========== 内部 ==========

  private enqueue(type: EventType, event: string, properties?: Record<string, unknown>): void {
    const distinctId = this.userId || this.anonId;
    const evt: AeroEvent = {
      type,
      event,
      distinct_id: distinctId,
      anonymous_id: this.anonId,
      user_id: this.userId || undefined,
      time: nowMs(),
      lib: { name: "web", version: this.cfg.libVersion },
      properties: {
        $insert_id: uuid(),
        $session_id: this.sessionId,
        ...this.collectAutoProps(),
        ...this.superProps,
        ...(properties || {}),
      },
    };
    this.buffer.push(evt);
    if (this.buffer.length >= this.cfg.batchSize) {
      void this.flush();
    }
  }

  private async drainBuffer(): Promise<void> {
    if (!this.buffer.length) return;
    const batch = this.buffer.splice(0, this.buffer.length);
    const ok = await this.send(batch);
    if (!ok) {
      // 失败 → 持久化
      for (const e of batch) await this.store.add(e);
    }
  }

  private async uploadFromStore(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (isOnline()) {
        const items = await this.store.take(this.cfg.batchSize);
        if (!items.length) break;
        const ok = await this.send(items.map((i) => i.payload));
        if (!ok) {
          this.scheduleRetry();
          break;
        }
        const ids = items.map((i) => i.id!).filter(Boolean);
        await this.store.remove(ids);
        this.retryAttempt = 0;
      }
    } finally {
      this.flushing = false;
    }
  }

  private async send(events: AeroEvent[]): Promise<boolean> {
    if (!events.length) return true;
    const url = `${this.cfg.serverUrl}/v1/track?token=${encodeURIComponent(this.cfg.token)}`;
    try {
      const body = JSON.stringify(events);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AeroLog-SDK": `web/${this.cfg.libVersion}` },
        body,
        keepalive: true,
        credentials: "omit",
      });
      if (res.ok) return true;
      // 4xx（非 429）丢弃，服务端拒绝
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        if (this.cfg.debug) console.warn("[aerolog] dropped by server", res.status);
        return true;
      }
      return false;
    } catch (err) {
      if (this.cfg.debug) console.error("[aerolog] send error", err);
      return false;
    }
  }

  private scheduleTick(): void {
    if (this.timer != null) return;
    this.timer = (setInterval(() => {
      void this.flush();
    }, this.cfg.flushInterval) as unknown) as number;
  }

  private scheduleRetry(): void {
    const delay = backoffMs(this.retryAttempt++);
    setTimeout(() => void this.uploadFromStore(), delay);
  }

  private attachLifecycle(): void {
    if (typeof window === "undefined") return;
    // 页面隐藏 / 卸载时优先用 sendBeacon
    const flushBeacon = () => {
      if (!this.buffer.length) return;
      const url = `${this.cfg.serverUrl}/v1/track?token=${encodeURIComponent(this.cfg.token)}`;
      try {
        const blob = new Blob([JSON.stringify(this.buffer)], { type: "application/json" });
        if (navigator.sendBeacon && navigator.sendBeacon(url, blob)) {
          this.buffer = [];
          return;
        }
      } catch {/* ignore */}
      // sendBeacon 失败兜底进 IndexedDB
      void this.drainBuffer();
    };
    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushBeacon();
    });
    window.addEventListener("pagehide", flushBeacon);
    window.addEventListener("online", () => void this.uploadFromStore());
  }

  private attachClickHandler(): void {
    if (typeof document === "undefined") return;
    document.addEventListener(
      "click",
      (ev) => {
        const t = ev.target as HTMLElement | null;
        if (!t) return;
        this.track("$WebClick", {
          $element_tag: t.tagName?.toLowerCase(),
          $element_id: t.id || undefined,
          $element_class: t.className || undefined,
          $element_content: (t.textContent || "").trim().slice(0, 128),
        });
      },
      true,
    );
  }

  private trackPageView(): void {
    if (typeof window === "undefined") return;
    const fire = () => this.track("$pageview", {
      $url: location.href,
      $referrer: document.referrer,
      $title: document.title,
    });
    fire();
    // SPA: hook history
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function (...args) { const r = origPush.apply(this, args); window.dispatchEvent(new Event("aerolog:locationchange")); return r; };
    history.replaceState = function (...args) { const r = origReplace.apply(this, args); window.dispatchEvent(new Event("aerolog:locationchange")); return r; };
    window.addEventListener("popstate", fire);
    window.addEventListener("aerolog:locationchange", fire);
  }

  private collectAutoProps(): Record<string, unknown> {
    if (typeof navigator === "undefined") return {};
    const ua = navigator.userAgent || "";
    const { os, osVersion } = detectOS(ua);
    const { browser, version } = detectBrowser(ua);
    return {
      $lib: "web",
      $lib_version: this.cfg.libVersion,
      $os: os,
      $os_version: osVersion,
      $browser: browser,
      $browser_version: version,
      $user_agent: ua,
      $screen_width: typeof screen !== "undefined" ? screen.width : 0,
      $screen_height: typeof screen !== "undefined" ? screen.height : 0,
      $network_type: detectNetwork(),
    };
  }

  private loadOrCreateAnonId(): string {
    let id = this.readStorage(ANON_KEY);
    if (!id) {
      id = "anon_" + uuid();
      this.writeStorage(ANON_KEY, id);
    }
    return id;
  }

  private ensureSession(): string {
    const now = Date.now();
    const raw = this.readStorage(SESSION_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { id: string; ts: number };
        if (now - parsed.ts < SESSION_TIMEOUT) {
          this.writeStorage(SESSION_KEY, JSON.stringify({ id: parsed.id, ts: now }));
          return parsed.id;
        }
      } catch {/* ignore */}
    }
    const id = uuid();
    this.writeStorage(SESSION_KEY, JSON.stringify({ id, ts: now }));
    return id;
  }

  private readStorage(k: string): string | null {
    try { return typeof localStorage === "undefined" ? null : localStorage.getItem(k); }
    catch { return null; }
  }
  private writeStorage(k: string, v: string): void {
    try { if (typeof localStorage !== "undefined") localStorage.setItem(k, v); } catch {/* ignore */}
  }
  private removeStorage(k: string): void {
    try { if (typeof localStorage !== "undefined") localStorage.removeItem(k); } catch {/* ignore */}
  }
}

export { DEFAULT_SERVER_URL };
export type { AeroEvent, AeroLogConfig, EventType, Lib, StoredEvent };

/** 默认导出工厂：const aero = init({...}) */
export function init(cfg: AeroLogConfig): AeroLog {
  return new AeroLog(cfg);
}

export default { init };
