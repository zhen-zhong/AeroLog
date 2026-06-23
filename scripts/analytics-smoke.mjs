#!/usr/bin/env node

const apiBase = process.env.API_BASE || "http://127.0.0.1:8082";
const email = process.env.ADMIN_EMAIL || "admin@aerolog.local";
const password = process.env.ADMIN_PASSWORD || "aerolog123";

let token = "";

async function request(path, init = {}) {
  const res = await fetch(`${apiBase}/v1${path}`, {
    ...init,
    signal: AbortSignal.timeout(30_000),
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${init.method || "GET"} ${path} -> ${res.status}: ${body}`);
  return body ? JSON.parse(body) : null;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const login = await request("/auth/login", {
    method: "POST",
    headers: {},
    body: JSON.stringify({ email, password }),
  });
  token = login.data?.token || "";
  assert(token, "login did not return a token");

  const projectList = await request("/projects");
  const project = projectList.data?.[0];
  assert(project?.id, "no project available for analytics smoke test");

  const now = Date.now();
  const base = {
    from: now - 30 * 24 * 60 * 60 * 1000,
    to: now,
    breakdown_property: "channel",
  };

  const funnel = await request(`/projects/${project.id}/analytics/funnel`, {
    method: "POST",
    body: JSON.stringify({
      ...base,
      events: ["app_start", "page_view", "view_product", "pay_success"],
      window_seconds: 7 * 24 * 60 * 60,
    }),
  });
  assert(Array.isArray(funnel.data?.steps), "funnel response is missing steps");
  assert(Array.isArray(funnel.data?.breakdown), "funnel response is missing breakdown");
  assert(typeof funnel.data?.breakdown_truncated === "boolean", "funnel response is missing breakdown_truncated");

  const retention = await request(
    `/projects/${project.id}/analytics/retention?${new URLSearchParams({
      initial_event: "app_start",
      return_event: "page_view",
      from: String(base.from),
      to: String(base.to),
      days: "7",
      breakdown_property: "channel",
    })}`,
  );
  assert(Array.isArray(retention.data?.overall), "retention response is missing overall cohorts");
  assert(Array.isArray(retention.data?.breakdown), "retention response is missing breakdown cohorts");

  const attribution = await request(`/projects/${project.id}/analytics/attribution`, {
    method: "POST",
    body: JSON.stringify({
      ...base,
      conversion_event: "pay_success",
      touch_events: ["app_start", "page_view", "view_product"],
      window_seconds: 7 * 24 * 60 * 60,
      model: "last",
    }),
  });
  assert(typeof attribution.data?.attributed_users === "number", "attribution response is missing attributed_users");
  assert(Array.isArray(attribution.data?.lag_buckets), "attribution response is missing lag_buckets");
  assert(Array.isArray(attribution.data?.breakdown), "attribution response is missing breakdown");
  assert(typeof attribution.data?.breakdown_truncated === "boolean", "attribution response is missing breakdown_truncated");

  console.log(`analytics smoke passed for project ${project.id}: ${project.name}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
