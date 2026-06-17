export function formatDateTime(value?: string) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

export function compactValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function compactProps(props: Record<string, unknown>, limit = 3) {
  const entries = Object.entries(props || {});
  if (!entries.length) return "-";
  return entries
    .slice(0, limit)
    .map(([key, value]) => `${key}: ${compactValue(value)}`)
    .join(" / ");
}
