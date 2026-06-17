// 工具函数：UUID、属性采集、退避

export function uuid(): string {
  // RFC4122 v4
  const r = () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, "0");
  const a = r();
  const b = r();
  const c = r();
  const d = r();
  return (
    a +
    "-" +
    b.slice(0, 4) +
    "-" +
    "4" + b.slice(5, 8) +
    "-" +
    ((parseInt(c[0], 16) & 0x3) | 0x8).toString(16) + c.slice(1, 4) +
    "-" +
    c.slice(4, 8) + d
  );
}

const OS_RE: Array<[RegExp, string]> = [
  [/Windows NT/i, "Windows"],
  [/Mac OS X|Macintosh/i, "macOS"],
  [/Android/i, "Android"],
  [/iPhone|iPad|iPod|iOS/i, "iOS"],
  [/Linux/i, "Linux"],
];

const BROWSER_RE: Array<[RegExp, string, RegExp]> = [
  [/Edg\//i, "Edge", /Edg\/([\d.]+)/i],
  [/Chrome\//i, "Chrome", /Chrome\/([\d.]+)/i],
  [/Firefox\//i, "Firefox", /Firefox\/([\d.]+)/i],
  [/Safari\//i, "Safari", /Version\/([\d.]+)/i],
];

export function detectOS(ua: string): { os: string; osVersion: string } {
  for (const [re, name] of OS_RE) {
    if (re.test(ua)) return { os: name, osVersion: extractOSVersion(ua, name) };
  }
  return { os: "", osVersion: "" };
}

function extractOSVersion(ua: string, os: string): string {
  switch (os) {
    case "Windows": return (ua.match(/Windows NT ([\d.]+)/) || [])[1] || "";
    case "macOS":   return ((ua.match(/Mac OS X ([\d_]+)/) || [])[1] || "").replace(/_/g, ".");
    case "Android": return (ua.match(/Android ([\d.]+)/) || [])[1] || "";
    case "iOS":     return ((ua.match(/OS ([\d_]+)/) || [])[1] || "").replace(/_/g, ".");
    default: return "";
  }
}

export function detectBrowser(ua: string): { browser: string; version: string } {
  for (const [re, name, vre] of BROWSER_RE) {
    if (re.test(ua)) return { browser: name, version: (ua.match(vre) || [])[1] || "" };
  }
  return { browser: "", version: "" };
}

export function detectNetwork(): string {
  // navigator.connection 在部分浏览器可用
  const c = (navigator as any).connection || (navigator as any).webkitConnection;
  if (!c) return "unknown";
  return c.effectiveType || c.type || "unknown";
}

export function nowMs(): number { return Date.now(); }

export function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

/** 指数退避，毫秒 */
export function backoffMs(attempt: number): number {
  const seq = [1000, 3000, 10000, 30000, 60000, 300000];
  return seq[Math.min(attempt, seq.length - 1)];
}
