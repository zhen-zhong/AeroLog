#!/usr/bin/env node

const API_BASE = process.env.API_BASE || "http://127.0.0.1:8082";
const WEB_BASE = process.env.WEB_BASE || "http://127.0.0.1:3000";
const PROJECT_ID = process.env.PROJECT_ID ? Number(process.env.PROJECT_ID) : 0;
const TIMEOUT_MS = Number(process.env.P1_SMOKE_TIMEOUT_MS || 30_000);

function log(message) {
  process.stdout.write(`${message}\n`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function request(path, init = {}) {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${init.method || "GET"} ${url} -> ${res.status}: ${text}`);
  }
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return res.json();
  }
  return res.text();
}

async function resolveProject() {
  if (PROJECT_ID) {
    const found = await request(`/v1/projects/${PROJECT_ID}`);
    return found.data;
  }
  const name = `p1-smoke-${Date.now()}`;
  const created = await request("/v1/projects", {
    method: "POST",
    body: JSON.stringify({ name, description: "P1 smoke test project" }),
  });
  return created.data;
}

async function checkConversion(project) {
  log("checking conversion goal versions/export...");
  const name = `smoke-conversion-${Date.now()}`;
  const baseBody = {
    name,
    description: "P1 smoke conversion",
    events: ["search", "view_product", "pay_success"],
    window_seconds: 86_400,
    breakdown_property: "channel",
  };
  const v1 = await request(`/v1/projects/${project.id}/conversion_goals`, {
    method: "POST",
    body: JSON.stringify({ ...baseBody, note: "initial" }),
  });
  assert(v1.data.version === 1, "new conversion goal should start at version 1");

  const v2 = await request(`/v1/projects/${project.id}/conversion_goals`, {
    method: "POST",
    body: JSON.stringify({ ...baseBody, description: "P1 smoke conversion updated", note: "updated" }),
  });
  assert(v2.data.version >= 2, "updated conversion goal should increment version");

  const versions = await request(`/v1/projects/${project.id}/conversion_goals/${v2.data.id}/versions`);
  assert(versions.data.length >= 2, "conversion goal should have at least two version snapshots");

  const now = Date.now();
  const trend = await request(`/v1/projects/${project.id}/analytics/conversion_trend`, {
    method: "POST",
    body: JSON.stringify({
      events: baseBody.events,
      from: now - 7 * 24 * 3600 * 1000,
      to: now,
      window_seconds: baseBody.window_seconds,
      interval: "day",
    }),
  });
  assert(Array.isArray(trend.data.current), "conversion trend should return current series");

  const csv = await request(`/v1/projects/${project.id}/analytics/conversion_export`, {
    method: "POST",
    body: JSON.stringify({
      events: baseBody.events,
      from: now - 7 * 24 * 3600 * 1000,
      to: now,
      window_seconds: baseBody.window_seconds,
      breakdown_property: baseBody.breakdown_property,
    }),
  });
  assert(String(csv).includes("section,label"), "conversion export should return CSV header");
}

async function checkQuery(project) {
  log("checking query templates/share/export/async job...");
  const now = Date.now();
  const queryBody = {
    events: ["search", "view_product"],
    from: now - 7 * 24 * 3600 * 1000,
    to: now,
    limit: 50,
    dimensions: [
      { type: "event", key: "event" },
      { type: "property", key: "channel" },
    ],
    filters: [{ property: "channel", op: "exists" }],
  };

  const csv = await request(`/v1/projects/${project.id}/analytics/query_table/export`, {
    method: "POST",
    body: JSON.stringify(queryBody),
  });
  assert(String(csv).includes("count"), "query table export should return CSV header");

  const template = await request(`/v1/projects/${project.id}/query_templates`, {
    method: "POST",
    body: JSON.stringify({
      name: `smoke-template-${Date.now()}`,
      description: "P1 smoke template",
      config: queryBody,
      is_shared: true,
    }),
  });
  assert(template.data.share_token, "shared query template should return share token");

  const shared = await request(`/v1/shared/query_templates/${encodeURIComponent(template.data.share_token)}`);
  assert(shared.data.id === template.data.id, "shared query template should be readable by token");

  const page = await fetch(`${WEB_BASE}/console/query/shared/${encodeURIComponent(template.data.share_token)}`);
  assert(page.ok, `shared query page should return 2xx, got ${page.status}`);

  const job = await request(`/v1/projects/${project.id}/analytics/jobs`, {
    method: "POST",
    body: JSON.stringify({ type: "query_export", input: { ...queryBody, limit: 50_000 } }),
  });
  assert(job.data.id, "query export job should be created");

  const deadline = Date.now() + TIMEOUT_MS;
  let current = job.data;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const next = await request(`/v1/projects/${project.id}/analytics/jobs/${job.data.id}`);
    current = next.data;
    if (current.status === "succeeded") break;
    if (current.status === "failed") {
      throw new Error(`query export job failed: ${current.error_message || "unknown error"}`);
    }
  }
  assert(current.status === "succeeded", `query export job timed out with status=${current.status}`);
  assert(current.result?.download_url, "query export job should expose download_url");

  const download = await fetch(`${API_BASE}${current.result.download_url}`);
  assert(download.ok, `query export job download should return 2xx, got ${download.status}`);
  const body = await download.text();
  assert(body.includes("count"), "query export job download should contain CSV header");
}

async function checkGovernance(project) {
  log("checking governance owner/status/audit...");
  const event = `smoke_event_${Date.now()}`;
  const property = "amount";

  const first = await request(`/v1/projects/${project.id}/properties/${property}/schema`, {
    method: "PUT",
    body: JSON.stringify({
      scope: "event",
      event,
      data_type: "number",
      schema_required: true,
      display_name: "Amount",
      description: "Smoke amount",
      owner: "growth",
      archived: true,
      hidden: false,
      actor: "p1-smoke",
      note: "initial governance state",
    }),
  });
  assert(first.data.archived === true, "property should be archived after first update");

  const second = await request(`/v1/projects/${project.id}/properties/${property}/schema`, {
    method: "PUT",
    body: JSON.stringify({
      scope: "event",
      event,
      data_type: "number",
      schema_required: false,
      owner: "growth",
      actor: "p1-smoke",
      note: "update without archived should preserve archive state",
    }),
  });
  assert(second.data.archived === true, "property archived state should be preserved when omitted");

  const batch = await request(`/v1/projects/${project.id}/properties/batch`, {
    method: "PUT",
    body: JSON.stringify({
      actor: "p1-smoke",
      note: "batch governance update",
      change_type: "batch_smoke",
      items: [{ name: property, scope: "event", event, owner: "data-team", hidden: true }],
    }),
  });
  assert(batch.data.updated === 1, "batch update should update exactly one property");

  const props = await request(
    `/v1/projects/${project.id}/properties?scope=event&event=${encodeURIComponent(event)}&include_archived=1&include_hidden=1`,
  );
  const found = props.data.find((item) => item.name === property && item.event === event);
  assert(found, "updated property should be listed when archived/hidden are included");
  assert(found.owner === "data-team", "batch update should change owner");
  assert(found.archived === true, "batch update should preserve archived state");
  assert(found.hidden === true, "batch update should set hidden state");

  const logs = await request(
    `/v1/projects/${project.id}/properties/${property}/change_log?scope=event&event=${encodeURIComponent(event)}&limit=10`,
  );
  assert(logs.data.length >= 2, "property change log should contain update history");
}

async function main() {
  log("checking health...");
  await request("/healthz");
  const project = await resolveProject();
  log(`project id=${project.id} name=${project.name}`);

  await checkConversion(project);
  await checkQuery(project);
  await checkGovernance(project);

  log("P1 smoke passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
