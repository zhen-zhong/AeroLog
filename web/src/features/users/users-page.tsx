"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import dayjs, { Dayjs } from "dayjs";
import { Search } from "lucide-react";
import { api, IdentityMapping, UserEvent, UserProfile } from "@/lib/api";
import { compactProps, compactValue, formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { AnimatedContent } from "@/components/react-bits/animated-content";
import { CountUp } from "@/components/react-bits/count-up";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useProjectStore } from "@/stores/project-store";

export function UsersPage() {
  const searchParams = useSearchParams();
  const projectId = useProjectStore((s) => s.projectId);
  const setProjectId = useProjectStore((s) => s.setProjectId);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [selected, setSelected] = useState<UserProfile | null>(null);
  const [deepLinkReady, setDeepLinkReady] = useState(false);
  const [fallbackOpened, setFallbackOpened] = useState(false);
  const [timelinePreset, setTimelinePreset] = useState<{ from?: number; to?: number; event?: string; distinctId?: string }>({});

  // 切换项目时重置选中用户
  useEffect(() => {
    setSelected(null);
  }, [projectId]);

  useEffect(() => {
    if (deepLinkReady) return;
    const nextProjectID = Number(searchParams.get("project_id") || 0);
    const distinctId = searchParams.get("distinct_id") || "";
    const from = Number(searchParams.get("from") || 0);
    const to = Number(searchParams.get("to") || 0);
    const event = searchParams.get("event") || "";
    if (nextProjectID > 0) {
      setProjectId(nextProjectID);
    }
    if (distinctId) {
      setQuery(distinctId);
      setSubmittedQuery(distinctId);
      setFallbackOpened(false);
      setTimelinePreset({
        distinctId,
        from: Number.isFinite(from) && from > 0 ? from : undefined,
        to: Number.isFinite(to) && to > 0 ? to : undefined,
        event: event || undefined,
      });
    }
    setDeepLinkReady(true);
  }, [deepLinkReady, searchParams, setProjectId]);

  const users = useQuery({
    queryKey: ["users", projectId, submittedQuery],
    queryFn: () => api.listUsers(projectId!, { query: submittedQuery, limit: 100 }),
    enabled: !!projectId,
  });

  const identities = useQuery({
    queryKey: ["identities", projectId, selected?.user_id, selected?.anonymous_id],
    queryFn: () =>
      api.listIdentities(projectId!, {
        user_id: selected?.user_id || undefined,
        anonymous_id: selected?.user_id ? undefined : selected?.anonymous_id || undefined,
        limit: 50,
      }),
    enabled: !!projectId && !!selected && (!!selected.user_id || !!selected.anonymous_id),
  });

  const rows = users.data?.data || [];
  const profileRows = useMemo(() => {
    if (!selected) return [];
    return Object.entries(selected.properties || {}).map(([key, value]) => ({
      key,
      value: compactValue(value),
    }));
  }, [selected]);

  useEffect(() => {
    if (!timelinePreset.distinctId || selected || !rows.length) return;
    const matched = rows.find((user) =>
      user.distinct_id === timelinePreset.distinctId ||
      user.user_id === timelinePreset.distinctId ||
      user.anonymous_id === timelinePreset.distinctId,
    );
    if (matched) {
      setSelected(matched);
    }
  }, [rows, selected, timelinePreset.distinctId]);

  useEffect(() => {
    if (!timelinePreset.distinctId || selected || users.isLoading || rows.length || fallbackOpened) return;
    setSelected({
      distinct_id: timelinePreset.distinctId,
      user_id: "",
      anonymous_id: "",
      properties: {},
      updated_at: new Date().toISOString(),
    });
    setFallbackOpened(true);
  }, [fallbackOpened, rows.length, selected, timelinePreset.distinctId, users.isLoading]);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    setSubmittedQuery(query.trim());
  }

  return (
    <AnimatedContent>
      <PageHeader
        title="用户画像"
        description="查看用户属性快照、登录身份和匿名身份链路。"
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <MetricCard label="画像快照" value={rows.length} loading={users.isLoading} />
        <MetricCard label="登录用户" value={rows.filter((row) => row.user_id).length} loading={users.isLoading} />
        <MetricCard label="搜索结果" value={rows.length} loading={users.isLoading} />
      </div>

      <form onSubmit={submitSearch} className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索 distinct_id / user_id / anonymous_id"
          />
        </div>
        <Button type="submit">搜索</Button>
      </form>

      {!projectId ? (
        <EmptyState title="暂无项目" description="创建项目并上报 profile_set 后，这里会出现用户画像。" />
      ) : (
        <>
          <Card className="hidden md:block">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Distinct ID</TableHead>
                    <TableHead>User ID</TableHead>
                    <TableHead>Anonymous ID</TableHead>
                    <TableHead>画像摘要</TableHead>
                    <TableHead className="w-48">更新时间</TableHead>
                    <TableHead className="w-24">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.isLoading ? (
                    Array.from({ length: 5 }).map((_, index) => (
                      <TableRow key={index}>
                        <TableCell colSpan={6}>
                          <Skeleton className="h-8 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : rows.length ? (
                    rows.map((user) => (
                      <TableRow key={user.distinct_id}>
                        <TableCell><code className="rounded bg-muted px-2 py-1 text-xs">{user.distinct_id}</code></TableCell>
                        <TableCell>{user.user_id ? <Badge variant="success">{user.user_id}</Badge> : "-"}</TableCell>
                        <TableCell>{user.anonymous_id ? <code className="rounded bg-muted px-2 py-1 text-xs">{user.anonymous_id}</code> : "-"}</TableCell>
                        <TableCell className="max-w-sm truncate text-muted-foreground">{compactProps(user.properties)}</TableCell>
                        <TableCell className="text-muted-foreground">{formatDateTime(user.updated_at)}</TableCell>
                        <TableCell>
                          <Button variant="link" onClick={() => setSelected(user)}>
                            查看
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={6}>
                        <div className="py-12 text-center text-sm text-muted-foreground">暂无用户画像</div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid gap-3 md:hidden">
            {users.isLoading ? (
              Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-36" />)
            ) : rows.length ? (
              rows.map((user) => (
                <Card key={user.distinct_id}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <CardTitle className="truncate text-sm">{user.distinct_id}</CardTitle>
                        <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(user.updated_at)}</p>
                      </div>
                      {user.user_id ? <Badge variant="success">已登录</Badge> : <Badge variant="secondary">匿名</Badge>}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">{compactProps(user.properties)}</p>
                    <Button variant="outline" className="w-full" onClick={() => setSelected(user)}>
                      查看详情
                    </Button>
                  </CardContent>
                </Card>
              ))
            ) : (
              <EmptyState title="暂无用户画像" />
            )}
          </div>
        </>
      )}

      <ProfileSheet
        projectId={projectId}
        selected={selected}
        identities={identities.data?.data || []}
        identityLoading={identities.isLoading}
        profileRows={profileRows}
        timelinePreset={timelinePreset}
        onClose={() => setSelected(null)}
      />
    </AnimatedContent>
  );
}

function MetricCard({ label, value, loading }: { label: string; value: number; loading: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-7 w-16" /> : <div className="text-2xl font-semibold"><CountUp value={value} /></div>}
      </CardContent>
    </Card>
  );
}

function ProfileSheet({
  projectId,
  selected,
  identities,
  identityLoading,
  profileRows,
  timelinePreset,
  onClose,
}: {
  projectId?: number;
  selected: UserProfile | null;
  identities: IdentityMapping[];
  identityLoading: boolean;
  profileRows: { key: string; value: string }[];
  timelinePreset: { from?: number; to?: number; event?: string; distinctId?: string };
  onClose: () => void;
}) {
  const [from, setFrom] = useState<Dayjs>(() => dayjs().subtract(7, "day").startOf("day"));
  const [to, setTo] = useState<Dayjs>(() => dayjs().endOf("day"));
  const [eventFilter, setEventFilter] = useState("");

  useEffect(() => {
    if (selected) {
      setFrom(timelinePreset.distinctId === selected.distinct_id && timelinePreset.from ? dayjs(timelinePreset.from) : dayjs().subtract(7, "day").startOf("day"));
      setTo(timelinePreset.distinctId === selected.distinct_id && timelinePreset.to ? dayjs(timelinePreset.to) : dayjs().endOf("day"));
      setEventFilter(timelinePreset.distinctId === selected.distinct_id ? timelinePreset.event || "" : "");
    }
  }, [selected?.distinct_id, timelinePreset]);

  const userEvents = useQuery({
    queryKey: ["user_events", projectId, selected?.distinct_id, from.valueOf(), to.valueOf(), eventFilter],
    queryFn: () =>
      api.userEvents(projectId!, selected!.distinct_id, {
        from: from.valueOf(),
        to: to.valueOf(),
        event: eventFilter.trim() || undefined,
        limit: 100,
      }),
    enabled: !!projectId && !!selected,
  });

  const sessionGroups = useMemo(() => groupEventsBySession(userEvents.data?.data || []), [userEvents.data]);

  return (
    <Sheet open={!!selected} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="overflow-y-auto sm:max-w-2xl">
        {selected && (
          <>
            <SheetHeader>
              <SheetTitle>用户画像详情</SheetTitle>
              <SheetDescription>{selected.distinct_id}</SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-6">
              <Card>
                <CardContent className="grid gap-3 pt-3 text-sm sm:pt-3">
                  <InfoRow label="Distinct ID" value={selected.distinct_id} code />
                  <InfoRow label="User ID" value={selected.user_id || "-"} />
                  <InfoRow label="Anonymous ID" value={selected.anonymous_id || "-"} code />
                  <InfoRow label="更新时间" value={formatDateTime(selected.updated_at)} />
                </CardContent>
              </Card>

              <section>
                <h3 className="mb-2 text-sm font-semibold">用户时间线</h3>
                <Card>
                  <CardContent className="grid gap-3 pt-3 sm:pt-3">
                    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_160px]">
                      <Input
                        type="datetime-local"
                        value={toInputDateTime(from)}
                        onChange={(event) => setFrom(fromInputDateTime(event.target.value, from))}
                      />
                      <Input
                        type="datetime-local"
                        value={toInputDateTime(to)}
                        onChange={(event) => setTo(fromInputDateTime(event.target.value, to))}
                      />
                      <Input
                        value={eventFilter}
                        onChange={(event) => setEventFilter(event.target.value)}
                        placeholder="事件名过滤"
                      />
                    </div>
                    {userEvents.isLoading ? (
                      Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-20 w-full" />)
                    ) : sessionGroups.length ? (
                      sessionGroups.map((group) => (
                        <div key={group.sessionId} className="rounded-md border bg-background p-3">
                          <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex min-w-0 items-center gap-2">
                              <Badge variant={group.sessionId === "未分组" ? "secondary" : "info"}>{group.sessionId}</Badge>
                              <span className="text-xs text-muted-foreground">{group.items.length} 个事件</span>
                            </div>
                            <div className="text-xs text-muted-foreground">{formatDateTime(group.start)} - {formatDateTime(group.end)}</div>
                          </div>
                          <div className="grid gap-3">
                            {group.items.map((item) => (
                              <EventTimelineItem key={`${item.event}:${item.time}:${item.properties?.$insert_id || ""}`} item={item} />
                            ))}
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="rounded-md border border-dashed bg-secondary/30 px-3 py-4 text-center text-sm text-muted-foreground">
                        当前时间范围内暂无事件。
                      </p>
                    )}
                  </CardContent>
                </Card>
              </section>

              <section>
                <h3 className="mb-2 text-sm font-semibold">画像属性</h3>
                <Card>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>属性</TableHead>
                          <TableHead>值</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {profileRows.length ? (
                          profileRows.map((row) => (
                            <TableRow key={row.key}>
                              <TableCell className="font-medium">{row.key}</TableCell>
                              <TableCell className="break-all text-muted-foreground">{row.value}</TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow>
                            <TableCell colSpan={2} className="text-muted-foreground">暂无属性</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </section>

              <section>
                <h3 className="mb-2 text-sm font-semibold">身份链路</h3>
                <Card>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Anonymous ID</TableHead>
                          <TableHead>User ID</TableHead>
                          <TableHead>最近绑定</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {identityLoading ? (
                          <TableRow>
                            <TableCell colSpan={3}><Skeleton className="h-8 w-full" /></TableCell>
                          </TableRow>
                        ) : identities.length ? (
                          identities.map((item) => (
                            <TableRow key={item.id}>
                              <TableCell><code className="rounded bg-muted px-2 py-1 text-xs">{item.anonymous_id}</code></TableCell>
                              <TableCell><Badge variant="success">{item.user_id}</Badge></TableCell>
                              <TableCell className="text-muted-foreground">{formatDateTime(item.last_seen)}</TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow>
                            <TableCell colSpan={3} className="text-muted-foreground">暂无身份映射</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function toInputDateTime(value: Dayjs) {
  return value.format("YYYY-MM-DDTHH:mm");
}

function fromInputDateTime(value: string, fallback: Dayjs) {
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed : fallback;
}

function groupEventsBySession(items: UserEvent[]) {
  const groups = new Map<string, UserEvent[]>();
  for (const item of items) {
    const sessionID = getSessionID(item);
    groups.set(sessionID, [...(groups.get(sessionID) || []), item]);
  }
  return Array.from(groups.entries()).map(([sessionId, events]) => {
    const ordered = [...events].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
    const times = ordered.map((item) => new Date(item.time).getTime()).filter(Number.isFinite);
    const start = times.length ? new Date(Math.min(...times)).toISOString() : ordered[ordered.length - 1]?.time || "";
    const end = times.length ? new Date(Math.max(...times)).toISOString() : ordered[0]?.time || "";
    return {
      sessionId,
      items: ordered,
      start,
      end,
    };
  }).sort((a, b) => new Date(b.end).getTime() - new Date(a.end).getTime());
}

function getSessionID(item: UserEvent) {
  const raw = item.properties?.$session_id || item.properties?.session_id;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (typeof raw === "number") return String(raw);
  return "未分组";
}

function EventTimelineItem({ item }: { item: UserEvent }) {
  return (
    <TimelineItem
      title={item.event}
      description={`${item.lib || "-"} / ${item.os || "-"} · ${compactProps(item.properties, 6)}`}
      time={formatDateTime(item.time)}
    />
  );
}

function TimelineItem({ title, description, time }: { title: string; description: string; time: string }) {
  return (
    <div className="grid grid-cols-[14px_1fr] gap-3">
      <div className="pt-1">
        <span className="block h-3 w-3 rounded-full border-2 border-primary bg-background" />
      </div>
      <div className="min-w-0 rounded-md border bg-background p-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div className="font-medium">{title}</div>
          <div className="text-xs text-muted-foreground">{time}</div>
        </div>
        <p className="mt-1 break-all text-sm text-muted-foreground">{description || "-"}</p>
      </div>
    </div>
  );
}

function InfoRow({ label, value, code }: { label: string; value: string; code?: boolean }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[120px_1fr]">
      <div className="text-muted-foreground">{label}</div>
      <div className="min-w-0 break-all">
        {code ? <code className="rounded bg-muted px-2 py-1 text-xs">{value}</code> : value}
      </div>
    </div>
  );
}
