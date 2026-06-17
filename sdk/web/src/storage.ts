// IndexedDB 持久化队列：上报失败 / 离线时事件落盘，恢复后重传
// 表结构：events { id (auto), payload (AeroEvent), createdAt }

import type { AeroEvent } from "./types";

const DB_NAME = "aerolog";
const DB_VERSION = 1;
const STORE = "events";

export interface StoredEvent {
  id?: number;
  payload: AeroEvent;
  createdAt: number;
}

export class EventStore {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private memFallback: StoredEvent[] = [];
  private nextMemId = 1;
  private readonly limit: number;

  constructor(limit = 10000) {
    this.limit = limit;
  }

  private getDB(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined") {
      return Promise.reject(new Error("indexedDB not supported"));
    }
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) {
            db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.dbPromise;
  }

  async add(payload: AeroEvent): Promise<void> {
    const item: StoredEvent = { payload, createdAt: Date.now() };
    try {
      const db = await this.getDB();
      await this.tx(db, "readwrite", (store) => store.add(item));
      await this.evictIfNeeded();
    } catch {
      // 兜底到内存
      item.id = this.nextMemId++;
      this.memFallback.push(item);
      if (this.memFallback.length > this.limit) {
        this.memFallback.splice(0, this.memFallback.length - this.limit);
      }
    }
  }

  async take(n: number): Promise<StoredEvent[]> {
    try {
      const db = await this.getDB();
      return await new Promise<StoredEvent[]>((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const store = tx.objectStore(STORE);
        const req = store.openCursor();
        const out: StoredEvent[] = [];
        req.onsuccess = () => {
          const cur = req.result;
          if (cur && out.length < n) {
            out.push(cur.value as StoredEvent);
            cur.continue();
          } else resolve(out);
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      return this.memFallback.slice(0, n);
    }
  }

  async remove(ids: number[]): Promise<void> {
    if (!ids.length) return;
    try {
      const db = await this.getDB();
      await this.tx(db, "readwrite", (store) => {
        ids.forEach((id) => store.delete(id));
      });
    } catch {
      this.memFallback = this.memFallback.filter((e) => !e.id || !ids.includes(e.id));
    }
  }

  private async evictIfNeeded(): Promise<void> {
    try {
      const db = await this.getDB();
      const count = await new Promise<number>((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      if (count <= this.limit) return;
      const toDelete = count - this.limit;
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        const req = store.openCursor();
        let removed = 0;
        req.onsuccess = () => {
          const cur = req.result;
          if (cur && removed < toDelete) {
            cur.delete();
            removed++;
            cur.continue();
          } else resolve();
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      /* ignore */
    }
  }

  private tx(
    db: IDBDatabase,
    mode: IDBTransactionMode,
    op: (store: IDBObjectStore) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
      op(tx.objectStore(STORE));
    });
  }
}
