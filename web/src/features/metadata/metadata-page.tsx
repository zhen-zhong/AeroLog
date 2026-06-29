"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  Eye,
  EyeOff,
  History,
  Pencil,
  UserCog,
} from "lucide-react";
import { api, EventDefinition, PropertyDefinition } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/layout/page-header";
import { useProjectStore } from "@/stores/project-store";
import { EmptyState } from "@/components/data/empty-state";
import { AnimatedContent } from "@/components/react-bits/animated-content";
import { CountUp } from "@/components/react-bits/count-up";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type MetadataView = "events" | "eventProps" | "userProps";

function listData<T>(response?: { data?: T[] | null } | null): T[] {
  return Array.isArray(response?.data) ? response.data : [];
}

export function MetadataPage() {
  const projectId = useProjectStore((s) => s.projectId);
  const [view, setView] = useState<MetadataView>("events");
  const [eventFilter, setEventFilter] = useState<string>("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [includeHidden, setIncludeHidden] = useState(false);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [batchOwner, setBatchOwner] = useState("");
  const [batchArchived, setBatchArchived] = useState<"" | "true" | "false">("");
  const [batchHidden, setBatchHidden] = useState<"" | "true" | "false">("");
  const [actor, setActor] = useState("");
  const [logProperty, setLogProperty] = useState<PropertyDefinition | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    setSelected({});
  }, [view, eventFilter, includeArchived, includeHidden]);

  const events = useQuery({
    queryKey: ["events", projectId],
    queryFn: () => api.listEvents(projectId!),
    enabled: !!projectId,
  });

  const eventProps = useQuery({
    queryKey: ["properties", projectId, "event", eventFilter, includeArchived, includeHidden],
    queryFn: () =>
      api.listProperties(projectId!, {
        scope: "event",
        event: eventFilter || undefined,
        include_global: !!eventFilter,
        include_archived: includeArchived,
        include_hidden: includeHidden,
      }),
    enabled: !!projectId,
  });

  const userProps = useQuery({
    queryKey: ["properties", projectId, "user", includeArchived, includeHidden],
    queryFn: () => api.listProperties(projectId!, {
      scope: "user",
      include_archived: includeArchived,
      include_hidden: includeHidden,
    }),
    enabled: !!projectId,
  });

  const eventRows = useMemo(() => listData<EventDefinition>(events.data), [events.data]);
  const eventPropertyRows = useMemo(() => listData<PropertyDefinition>(eventProps.data), [eventProps.data]);
  const userPropertyRows = useMemo(() => listData<PropertyDefinition>(userProps.data), [userProps.data]);
  const currentData = useMemo(() => {
    if (view === "events") return eventRows;
    if (view === "eventProps") return eventPropertyRows;
    return userPropertyRows;
  }, [eventPropertyRows, eventRows, userPropertyRows, view]);

  const loading =
    view === "events" ? events.isLoading :
    view === "eventProps" ? eventProps.isLoading :
    userProps.isLoading;

  const propertyRows = view === "eventProps" ? eventPropertyRows : view === "userProps" ? userPropertyRows : [];
  const selectedIds = Object.entries(selected).filter(([, v]) => v).map(([k]) => Number(k));

  const batch = useMutation({
    mutationFn: () => {
      const items = propertyRows
        .filter((row) => selectedIds.includes(row.id))
        .map((row) => ({
          name: row.name,
          scope: row.scope,
          event: row.event,
          owner: batchOwner.trim() || undefined,
          archived: batchArchived === "" ? undefined : batchArchived === "true",
          hidden: batchHidden === "" ? undefined : batchHidden === "true",
        }));
      return api.batchUpdateProperties(projectId!, {
        actor: actor.trim() || undefined,
        change_type: "batch",
        items,
      });
    },
    onSuccess: () => {
      setSelected({});
      setBatchOwner("");
      setBatchArchived("");
      setBatchHidden("");
      queryClient.invalidateQueries({ queryKey: ["properties", projectId] });
    },
  });

  const updateOne = useMutation({
    mutationFn: ({ row, patch }: { row: PropertyDefinition; patch: Partial<PropertyDefinition> }) =>
      api.updatePropertySchema(projectId!, row.name, {
        scope: row.scope,
        event: row.event || undefined,
        data_type: row.data_type,
        schema_required: row.schema_required,
        enum_values: row.enum_values,
        display_name: row.display_name,
        description: row.description,
        owner: patch.owner ?? row.owner,
        archived: patch.archived ?? row.archived,
        hidden: patch.hidden ?? row.hidden,
        actor: actor.trim() || undefined,
        note: "metadata-page inline",
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["properties", projectId] }),
  });

  function toggleAll(checked: boolean) {
    if (!checked) {
      setSelected({});
      return;
    }
    const map: Record<number, boolean> = {};
    propertyRows.forEach((row) => { map[row.id] = true; });
    setSelected(map);
  }

  return (
    <AnimatedContent>
      <PageHeader
        title="数据治理"
        description="自动发现事件、事件属性和用户属性，沉淀可确认、可解释、可治理的数据字典。"
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <MetricCard label="事件字典" value={eventRows.length} loading={events.isLoading} />
        <MetricCard label="事件属性" value={eventPropertyRows.length} loading={eventProps.isLoading} />
        <MetricCard label="用户属性" value={userPropertyRows.length} loading={userProps.isLoading} />
      </div>

      {!projectId ? (
        <EmptyState title="暂无项目" description="请先在项目管理页面创建项目，随后 SDK 上报会自动补全元数据。" />
      ) : (
        <Tabs value={view} onValueChange={(v) => setView(v as MetadataView)}>
          <div className="overflow-x-auto pb-1">
            <TabsList>
              <TabsTrigger value="events">事件字典</TabsTrigger>
              <TabsTrigger value="eventProps">事件属性</TabsTrigger>
              <TabsTrigger value="userProps">用户属性</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="events">
            <DictionaryTable
              loading={loading}
              rows={currentData as EventDefinition[]}
              mode="events"
            />
          </TabsContent>
          <TabsContent value="eventProps">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">按事件筛选：</span>
              <select
                className="h-8 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                value={eventFilter}
                onChange={(e) => setEventFilter(e.target.value)}
              >
                <option value="">全部（含全局默认）</option>
                {eventRows.map((e) => (
                  <option key={e.id} value={e.name}>{e.name}</option>
                ))}
              </select>
              {eventFilter && (
                <span className="text-xs text-muted-foreground">
                  当前展示：<code className="rounded bg-muted px-1">{eventFilter}</code> 事件专属规则 + 全局默认
                </span>
              )}
              <FilterToggle label="含已废弃" value={includeArchived} onChange={setIncludeArchived} />
              <FilterToggle label="含已隐藏" value={includeHidden} onChange={setIncludeHidden} />
            </div>
            <BatchToolbar
              actor={actor}
              setActor={setActor}
              owner={batchOwner}
              setOwner={setBatchOwner}
              archived={batchArchived}
              setArchived={setBatchArchived}
              hidden={batchHidden}
              setHidden={setBatchHidden}
              count={selectedIds.length}
              loading={batch.isPending}
              onSubmit={() => batch.mutate()}
              error={batch.error ? String(batch.error.message || batch.error) : ""}
            />
            <PropertyTable
              loading={loading}
              rows={propertyRows}
              selected={selected}
              onToggle={(id, v) => setSelected((s) => ({ ...s, [id]: v }))}
              onToggleAll={toggleAll}
              onArchiveToggle={(row) => updateOne.mutate({ row, patch: { archived: !row.archived } })}
              onHideToggle={(row) => updateOne.mutate({ row, patch: { hidden: !row.hidden } })}
              onShowLog={setLogProperty}
            />
          </TabsContent>
          <TabsContent value="userProps">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              <FilterToggle label="含已废弃" value={includeArchived} onChange={setIncludeArchived} />
              <FilterToggle label="含已隐藏" value={includeHidden} onChange={setIncludeHidden} />
            </div>
            <BatchToolbar
              actor={actor}
              setActor={setActor}
              owner={batchOwner}
              setOwner={setBatchOwner}
              archived={batchArchived}
              setArchived={setBatchArchived}
              hidden={batchHidden}
              setHidden={setBatchHidden}
              count={selectedIds.length}
              loading={batch.isPending}
              onSubmit={() => batch.mutate()}
              error={batch.error ? String(batch.error.message || batch.error) : ""}
            />
            <PropertyTable
              loading={loading}
              rows={propertyRows}
              selected={selected}
              onToggle={(id, v) => setSelected((s) => ({ ...s, [id]: v }))}
              onToggleAll={toggleAll}
              onArchiveToggle={(row) => updateOne.mutate({ row, patch: { archived: !row.archived } })}
              onHideToggle={(row) => updateOne.mutate({ row, patch: { hidden: !row.hidden } })}
              onShowLog={setLogProperty}
            />
          </TabsContent>
        </Tabs>
      )}

      <ChangeLogSheet
        property={logProperty}
        projectId={projectId}
        onClose={() => setLogProperty(null)}
      />
    </AnimatedContent>
  );
}

function FilterToggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function BatchToolbar({
  actor, setActor, owner, setOwner,
  archived, setArchived, hidden, setHidden,
  count, loading, onSubmit, error,
}: {
  actor: string; setActor: (v: string) => void;
  owner: string; setOwner: (v: string) => void;
  archived: "" | "true" | "false"; setArchived: (v: "" | "true" | "false") => void;
  hidden: "" | "true" | "false"; setHidden: (v: "" | "true" | "false") => void;
  count: number; loading: boolean; onSubmit: () => void; error: string;
}) {
  return (
    <Card className="mb-3">
      <CardContent className="grid gap-3 pt-4 sm:pt-4 lg:grid-cols-[1fr_1fr_140px_140px_140px_auto]">
        <Input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="操作人（actor，可选）" />
        <Input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="负责人 owner（留空不变）" />
        <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={archived} onChange={(e) => setArchived(e.target.value as "" | "true" | "false")}>
          <option value="">废弃 - 不变</option>
          <option value="true">标记为废弃</option>
          <option value="false">取消废弃</option>
        </select>
        <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={hidden} onChange={(e) => setHidden(e.target.value as "" | "true" | "false")}>
          <option value="">隐藏 - 不变</option>
          <option value="true">标记为隐藏</option>
          <option value="false">取消隐藏</option>
        </select>
        <Badge variant="info" className="items-center justify-center">已选 {count} 项</Badge>
        <Button type="button" disabled={!count || loading} onClick={onSubmit}>
          <Pencil className="h-4 w-4" />
          {loading ? "保存中" : "批量更新"}
        </Button>
        {error ? <Badge variant="danger" className="lg:col-span-6">{error}</Badge> : null}
      </CardContent>
    </Card>
  );
}

function PropertyTable({
  rows, loading, selected, onToggle, onToggleAll,
  onArchiveToggle, onHideToggle, onShowLog,
}: {
  rows: PropertyDefinition[];
  loading: boolean;
  selected: Record<number, boolean>;
  onToggle: (id: number, v: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  onArchiveToggle: (row: PropertyDefinition) => void;
  onHideToggle: (row: PropertyDefinition) => void;
  onShowLog: (row: PropertyDefinition) => void;
}) {
  const allSelected = rows.length > 0 && rows.every((r) => selected[r.id]);
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => onToggleAll(e.target.checked)}
                />
              </TableHead>
              <TableHead>属性名</TableHead>
              <TableHead className="w-24">类型</TableHead>
              <TableHead className="w-24">范围</TableHead>
              <TableHead className="w-32">归属事件</TableHead>
              <TableHead className="w-32">负责人</TableHead>
              <TableHead className="w-32">状态</TableHead>
              <TableHead className="hidden lg:table-cell">最近出现</TableHead>
              <TableHead className="w-32 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 6 }).map((_, index) => (
                <TableRow key={index}>
                  <TableCell colSpan={9}><Skeleton className="h-8 w-full" /></TableCell>
                </TableRow>
              ))
            ) : rows.length ? rows.map((row) => (
              <TableRow key={`prop:${row.id}`} className={row.archived ? "opacity-60" : ""}>
                <TableCell>
                  <input
                    type="checkbox"
                    checked={!!selected[row.id]}
                    onChange={(e) => onToggle(row.id, e.target.checked)}
                  />
                </TableCell>
                <TableCell className="min-w-48 font-medium">
                  <code className="rounded bg-muted px-2 py-1 text-xs">{row.name}</code>
                </TableCell>
                <TableCell>{typeBadge(row.data_type)}</TableCell>
                <TableCell>{scopeBadge(row.scope)}</TableCell>
                <TableCell>{eventBadge(row.event)}</TableCell>
                <TableCell className="text-xs">
                  {row.owner ? (
                    <span className="inline-flex items-center gap-1"><UserCog className="h-3 w-3" />{row.owner}</span>
                  ) : <span className="text-muted-foreground">-</span>}
                </TableCell>
                <TableCell className="space-x-1">
                  {row.archived ? <Badge variant="danger">废弃</Badge> : null}
                  {row.hidden ? <Badge variant="secondary">隐藏</Badge> : null}
                  {!row.archived && !row.hidden ? <Badge variant="success">启用</Badge> : null}
                </TableCell>
                <TableCell className="hidden text-muted-foreground lg:table-cell">{formatDateTime(row.last_seen)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      title={row.archived ? "取消废弃" : "标记废弃"}
                      onClick={() => onArchiveToggle(row)}
                    >
                      {row.archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      title={row.hidden ? "取消隐藏" : "标记隐藏"}
                      onClick={() => onHideToggle(row)}
                    >
                      {row.hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      title="变更历史"
                      onClick={() => onShowLog(row)}
                    >
                      <History className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )) : (
              <TableRow>
                <TableCell colSpan={9}>
                  <div className="py-12 text-center text-sm text-muted-foreground">暂无数据</div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ChangeLogSheet({
  property, projectId, onClose,
}: {
  property: PropertyDefinition | null;
  projectId: number | null | undefined;
  onClose: () => void;
}) {
  const open = !!property;
  const log = useQuery({
    queryKey: ["property_change_log", projectId, property?.scope, property?.event, property?.name],
    queryFn: () => api.propertyChangeLog(projectId!, property!.name, {
      scope: property!.scope,
      event: property!.event || undefined,
      limit: 100,
    }),
    enabled: open && !!projectId && !!property,
  });
  const logRows = useMemo(() => listData(log.data), [log.data]);
  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-[480px] sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <History className="h-4 w-4" />
            变更历史 · <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{property?.name}</code>
          </SheetTitle>
          <SheetDescription>
            范围 {property?.scope === "user" ? "用户" : "事件"}
            {property?.event ? `（事件 ${property.event}）` : "（全局默认）"}
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-3 overflow-y-auto pr-1" style={{ maxHeight: "calc(100vh - 160px)" }}>
          {log.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : logRows.length ? (
            logRows.map((entry) => (
              <div key={entry.id} className="rounded-md border bg-background p-3 text-xs">
                <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                  <Badge variant={entry.change_type === "delete" ? "danger" : "info"}>{entry.change_type}</Badge>
                  <span className="text-muted-foreground">{formatDateTime(entry.created_at)}</span>
                </div>
                <div className="mb-1 text-muted-foreground">
                  操作人：<span className="font-mono">{entry.actor || "-"}</span>
                  {entry.note ? <span className="ml-2">备注：{entry.note}</span> : null}
                </div>
                <div className="grid gap-1 sm:grid-cols-2">
                  <ValueBlock label="变更前" value={entry.before_value} />
                  <ValueBlock label="变更后" value={entry.after_value} />
                </div>
              </div>
            ))
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">暂无变更记录</div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ValueBlock({ label, value }: { label: string; value?: Record<string, unknown> }) {
  return (
    <div>
      <div className="mb-1 text-[11px] uppercase text-muted-foreground">{label}</div>
      <pre className="max-h-40 overflow-auto rounded bg-muted px-2 py-1 text-[11px] leading-relaxed">{value ? JSON.stringify(value, null, 2) : "-"}</pre>
    </div>
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

function DictionaryTable({
  rows,
  loading,
  mode,
}: {
  rows: EventDefinition[];
  loading: boolean;
  mode: "events";
}) {
  void mode;
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>事件名</TableHead>
              <TableHead className="hidden md:table-cell">显示名</TableHead>
              <TableHead className="w-28">状态</TableHead>
              <TableHead className="hidden lg:table-cell">首次出现</TableHead>
              <TableHead className="hidden lg:table-cell">最近出现</TableHead>
              <TableHead className="hidden xl:table-cell">描述</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 6 }).map((_, index) => (
                <TableRow key={index}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : rows.length ? (
              rows.map((row) => (
                <TableRow key={`event:${row.id}`}>
                  <TableCell className="min-w-48 font-medium">
                    <code className="rounded bg-muted px-2 py-1 text-xs">{row.name}</code>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{row.display_name || "-"}</TableCell>
                  <TableCell>{row.status === 1 ? <Badge variant="success">启用</Badge> : <Badge variant="secondary">禁用</Badge>}</TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">{formatDateTime(row.first_seen)}</TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">{formatDateTime(row.last_seen)}</TableCell>
                  <TableCell className="hidden max-w-xs truncate text-muted-foreground xl:table-cell">{row.description || "-"}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6}>
                  <div className="py-12 text-center text-sm text-muted-foreground">暂无数据</div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function typeBadge(type: string) {
  const variant = type === "mixed" ? "danger" : type === "unknown" ? "secondary" : "info";
  return <Badge variant={variant}>{type}</Badge>;
}

function scopeBadge(scope: "event" | "user") {
  return scope === "user" ? <Badge variant="default">用户</Badge> : <Badge variant="outline">事件</Badge>;
}

function eventBadge(event: string) {
  if (!event) {
    return <Badge variant="secondary">全局默认</Badge>;
  }
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{event}</code>
  );
}
