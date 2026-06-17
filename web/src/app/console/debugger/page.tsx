"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bug, CheckCircle2, RefreshCw, Save, ShieldAlert, SlidersHorizontal, UserRoundCheck } from "lucide-react";
import {
  AnalyticsHeader,
  EmptyAnalysis,
  ProjectPicker,
} from "@/features/analytics/analytics-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, DebugEvent, PropertyDefinition, SchemaIssue } from "@/lib/api";
import { cn } from "@/lib/utils";

const DATA_TYPES = ["string", "number", "bool", "datetime", "list", "object", "mixed", "unknown"];

export default function DebuggerPage() {
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState<number | undefined>();
  const [eventFilter, setEventFilter] = useState("__all__");
  const [resultFilter, setResultFilter] = useState("__all__");
  const [distinctId, setDistinctId] = useState("");
  const [selectedProperty, setSelectedProperty] = useState("");
  const [dataType, setDataType] = useState("string");
  const [required, setRequired] = useState(false);
  const [enumText, setEnumText] = useState("");
  const [selectedEventSchema, setSelectedEventSchema] = useState("");
  const [requiredPropsText, setRequiredPropsText] = useState("");

  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects(),
  });

  useEffect(() => {
    if (!projectId && projects.data?.data?.length) {
      setProjectId(projects.data.data[0].id);
    }
  }, [projectId, projects.data]);

  const events = useQuery({
    queryKey: ["debugger_events", projectId],
    queryFn: () => api.listEvents(projectId!),
    enabled: !!projectId,
    placeholderData: (previousData) => previousData,
  });

  const properties = useQuery({
    queryKey: ["debugger_properties", projectId],
    queryFn: () => api.listProperties(projectId!, { scope: "event" }),
    enabled: !!projectId,
    placeholderData: (previousData) => previousData,
  });

  const debugEvents = useQuery({
    queryKey: ["debug_events", projectId, eventFilter, resultFilter, distinctId],
    queryFn: () =>
      api.debugEvents(projectId!, {
        event: eventFilter === "__all__" ? undefined : eventFilter,
        result: resultFilter === "__all__" ? undefined : resultFilter,
        distinct_id: distinctId.trim() || undefined,
        limit: 120,
        include_global: true,
      }),
    enabled: !!projectId,
    placeholderData: (previousData) => previousData,
  });

  const schemaIssues = useQuery({
    queryKey: ["schema_issues", projectId, eventFilter, selectedProperty],
    queryFn: () =>
      api.schemaIssues(projectId!, {
        event: eventFilter === "__all__" ? undefined : eventFilter,
        property: selectedProperty || undefined,
        limit: 120,
      }),
    enabled: !!projectId,
    placeholderData: (previousData) => previousData,
  });

  const propertyRows = properties.data?.data || [];
  const eventRows = events.data?.data || [];
  const selected = propertyRows.find((item) => item.name === selectedProperty);
  const selectedEventRule = eventRows.find((item) => item.name === selectedEventSchema);

  useEffect(() => {
    if (!selectedProperty && propertyRows.length) {
      setSelectedProperty(propertyRows[0].name);
    }
  }, [propertyRows, selectedProperty]);

  useEffect(() => {
    if (!selectedEventSchema && eventRows.length) {
      setSelectedEventSchema(eventRows[0].name);
    }
  }, [eventRows, selectedEventSchema]);

  useEffect(() => {
    if (!selected) return;
    setDataType(selected.data_type || "string");
    setRequired(Boolean(selected.schema_required));
    setEnumText((selected.enum_values || []).join("\n"));
  }, [selected]);

  useEffect(() => {
    if (!selectedEventRule) return;
    setRequiredPropsText((selectedEventRule.schema_required_props || []).join("\n"));
  }, [selectedEventRule]);

  const saveSchema = useMutation({
    mutationFn: () =>
      api.updatePropertySchema(projectId!, selectedProperty, {
        scope: "event",
        data_type: dataType,
        schema_required: required,
        enum_values: enumText
          .split(/[\n,]/)
          .map((item) => item.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["debugger_properties", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["schema_issues", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["debug_events", projectId] });
    },
  });

  const saveEventSchema = useMutation({
    mutationFn: () =>
      api.updateEventSchema(projectId!, selectedEventSchema, {
        schema_required_props: requiredPropsText
          .split(/[\n,]/)
          .map((item) => item.trim())
          .filter(Boolean),
        status: selectedEventRule?.status ?? 1,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["debugger_events", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["schema_issues", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["debug_events", projectId] });
    },
  });

  const stats = useMemo(() => {
    const rows = debugEvents.data?.data || [];
    const issues = schemaIssues.data?.data || [];
    return {
      events: rows.length,
      warnings: rows.filter((item) => item.result === "schema_warning").length,
      issueCount: issues.length,
      locked: propertyRows.filter((item) => item.schema_locked).length,
    };
  }, [debugEvents.data, propertyRows, schemaIssues.data]);

  return (
    <div>
      <AnalyticsHeader
        title="SDK Debugger"
        description="查看 SDK 上报是否进入链路，配置参数 Schema，并定位类型漂移、必填缺失和枚举越界。"
        action={<Badge variant="info" className="h-9 items-center gap-2"><Bug className="h-3.5 w-3.5" /> Schema 校验</Badge>}
      />

      <div className="grid gap-5 xl:grid-cols-[410px_minmax(0,1fr)]">
        <div className="grid gap-5 self-start">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-primary" />
                调试过滤
              </CardTitle>
              <CardDescription>按事件、用户标识和校验结果缩小 SDK 调试范围。</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-1.5">
                <Label>项目</Label>
                <ProjectPicker projects={projects.data?.data || []} value={projectId} onChange={setProjectId} className="sm:w-full" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <div className="grid gap-1.5">
                  <Label>事件</Label>
                  <Select value={eventFilter} onValueChange={setEventFilter}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">全部事件</SelectItem>
                      {(events.data?.data || []).map((item) => (
                        <SelectItem key={item.id} value={item.name}>{item.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>结果</Label>
                  <Select value={resultFilter} onValueChange={setResultFilter}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">全部结果</SelectItem>
                      <SelectItem value="accepted">已接收</SelectItem>
                      <SelectItem value="schema_warning">Schema 告警</SelectItem>
                      <SelectItem value="rejected">已拒绝</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>distinct_id</Label>
                <Input value={distinctId} onChange={(event) => setDistinctId(event.target.value)} placeholder="输入用户标识精确查询" />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void debugEvents.refetch();
                  void schemaIssues.refetch();
                }}
              >
                <RefreshCw className="h-4 w-4" />
                刷新调试数据
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-primary" />
                Schema 规则
              </CardTitle>
              <CardDescription>手动锁定参数类型后，异常上报不会再把它自动合并成 mixed。</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-1.5">
                <Label>参数 key</Label>
                <Select value={selectedProperty || undefined} onValueChange={setSelectedProperty}>
                  <SelectTrigger><SelectValue placeholder="选择参数" /></SelectTrigger>
                  <SelectContent>
                    {propertyRows.map((item) => (
                      <SelectItem key={item.id} value={item.name}>{item.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <div className="grid gap-1.5">
                  <Label>期望类型</Label>
                  <Select value={dataType} onValueChange={setDataType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DATA_TYPES.map((item) => (
                        <SelectItem key={item} value={item}>{item}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>必填</Label>
                  <Button
                    type="button"
                    variant={required ? "default" : "outline"}
                    className="justify-start"
                    onClick={() => setRequired((current) => !current)}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {required ? "必须上报" : "允许为空"}
                  </Button>
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>允许的 value</Label>
                <Textarea
                  value={enumText}
                  onChange={(event) => setEnumText(event.target.value)}
                  placeholder="每行一个，或用英文逗号分隔；留空则不校验枚举"
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge variant={selected?.schema_locked ? "success" : "secondary"}>
                  {selected?.schema_locked ? "已锁定 Schema" : "自动发现中"}
                </Badge>
                <Button
                  type="button"
                  disabled={!projectId || !selectedProperty || saveSchema.isPending}
                  onClick={() => saveSchema.mutate()}
                >
                  <Save className="h-4 w-4" />
                  保存规则
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-primary" />
                事件 Schema
              </CardTitle>
              <CardDescription>按事件配置必带参数，例如 purchase 必须带 amount、order_id。</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-1.5">
                <Label>事件名</Label>
                <Select value={selectedEventSchema || undefined} onValueChange={setSelectedEventSchema}>
                  <SelectTrigger><SelectValue placeholder="选择事件" /></SelectTrigger>
                  <SelectContent>
                    {eventRows.map((item) => (
                      <SelectItem key={item.id} value={item.name}>{item.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>必带参数</Label>
                <Textarea
                  value={requiredPropsText}
                  onChange={(event) => setRequiredPropsText(event.target.value)}
                  placeholder="每行一个参数 key，或用英文逗号分隔"
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge variant={selectedEventRule?.schema_locked ? "success" : "secondary"}>
                  {selectedEventRule?.schema_locked ? "已锁定事件规则" : "自动发现中"}
                </Badge>
                <Button
                  type="button"
                  disabled={!projectId || !selectedEventSchema || saveEventSchema.isPending}
                  onClick={() => saveEventSchema.mutate()}
                >
                  <Save className="h-4 w-4" />
                  保存事件规则
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid min-w-0 gap-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="最近事件" value={stats.events} tone="default" />
            <StatTile label="Schema 告警" value={stats.warnings} tone="warning" />
            <StatTile label="问题记录" value={stats.issueCount} tone="danger" />
            <StatTile label="锁定参数" value={stats.locked} tone="success" />
          </div>

          <Card className="min-w-0">
            <CardHeader className="pb-2">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>调试事件与 Schema 问题</CardTitle>
                  <CardDescription>事件流用于确认 SDK 是否到达，问题表用于定位具体参数。</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="events">
                <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
                  <TabsTrigger value="events">SDK 事件流</TabsTrigger>
                  <TabsTrigger value="issues">Schema 问题</TabsTrigger>
                </TabsList>
                <TabsContent value="events">
                  <DebugEventsTable projectId={projectId} rows={debugEvents.data?.data || []} loading={debugEvents.isLoading} />
                </TabsContent>
                <TabsContent value="issues">
                  <SchemaIssuesTable rows={schemaIssues.data?.data || []} loading={schemaIssues.isLoading} />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value, tone }: { label: string; value: number; tone: "default" | "warning" | "danger" | "success" }) {
  return (
    <div className={cn(
      "rounded-lg border bg-card p-4",
      tone === "warning" && "border-amber-200 bg-amber-50/70",
      tone === "danger" && "border-red-200 bg-red-50/70",
      tone === "success" && "border-emerald-200 bg-emerald-50/70",
    )}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-normal">{value}</div>
    </div>
  );
}

function DebugEventsTable({ projectId, rows, loading }: { projectId?: number; rows: DebugEvent[]; loading: boolean }) {
  if (!loading && rows.length === 0) {
    return <EmptyAnalysis title="还没有调试事件" description="启动服务并通过 SDK 或 curl 上报事件后，这里会显示最近消费到的数据。" />;
  }
  return (
    <div className="max-w-full overflow-x-auto rounded-md border">
      <Table className="min-w-[1060px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-40">时间</TableHead>
            <TableHead className="w-40">事件</TableHead>
            <TableHead className="w-32">结果</TableHead>
            <TableHead className="w-52">用户</TableHead>
            <TableHead className="w-72">参数摘要</TableHead>
            <TableHead>原因</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatTime(item.created_at)}</TableCell>
              <TableCell className="font-medium">{item.event || item.event_type}</TableCell>
              <TableCell><ResultBadge result={item.result} /></TableCell>
              <TableCell className="max-w-52 text-xs text-muted-foreground">
                <UserTimelineLink projectId={projectId} item={item} />
              </TableCell>
              <TableCell className="max-w-72 text-xs text-muted-foreground">
                <ParamsPreview payload={item.payload} />
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{item.reason || "-"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function UserTimelineLink({ projectId, item }: { projectId?: number; item: DebugEvent }) {
  const id = item.distinct_id || item.user_id || item.anonymous_id;
  if (!id || !projectId || item.project_id === 0) {
    return <span className="truncate">{id || "-"}</span>;
  }
  const center = new Date(item.received_at || item.created_at).getTime();
  const from = center - 30 * 60 * 1000;
  const to = center + 30 * 60 * 1000;
  const href = `/console/users?project_id=${projectId}&distinct_id=${encodeURIComponent(id)}&from=${from}&to=${to}&event=${encodeURIComponent(item.event || "")}`;
  return (
    <Link
      href={href}
      className="inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-1 text-primary transition-colors hover:bg-accent hover:text-accent-foreground"
      title="查看用户时间线"
    >
      <UserRoundCheck className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{id}</span>
    </Link>
  );
}

function SchemaIssuesTable({ rows, loading }: { rows: SchemaIssue[]; loading: boolean }) {
  if (!loading && rows.length === 0) {
    return <EmptyAnalysis title="当前没有 Schema 问题" description="当 SDK 上报的参数和已锁定规则不一致时，这里会记录事件、参数和值。" />;
  }
  return (
    <div className="max-w-full overflow-x-auto rounded-md border">
      <Table className="min-w-[1120px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-40">时间</TableHead>
            <TableHead className="w-40">事件</TableHead>
            <TableHead className="w-44">参数</TableHead>
            <TableHead className="w-32">级别</TableHead>
            <TableHead className="w-40">期望 / 实际</TableHead>
            <TableHead className="w-56">说明</TableHead>
            <TableHead>样例参数</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatTime(item.created_at)}</TableCell>
              <TableCell className="font-medium">{item.event || "-"}</TableCell>
              <TableCell className="font-mono text-xs">{item.property}</TableCell>
              <TableCell><Badge variant={item.severity === "error" ? "danger" : "warning"}>{item.severity}</Badge></TableCell>
              <TableCell className="text-xs text-muted-foreground">{item.expected_type || "-"} / {item.actual_type || "-"}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{item.message}</TableCell>
              <TableCell className="max-w-80 text-xs text-muted-foreground">
                <ParamsPreview payload={item.payload} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ResultBadge({ result }: { result: DebugEvent["result"] }) {
  if (result === "accepted") return <Badge variant="success">已接收</Badge>;
  if (result === "schema_warning") return <Badge variant="warning">Schema 告警</Badge>;
  return <Badge variant="danger">已拒绝</Badge>;
}

function formatTime(value?: string) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function ParamsPreview({ payload }: { payload: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const summary = propsSummary(payload, 6);
  const fullText = propsSummary(payload);

  if (summary === "-") {
    return <span>-</span>;
  }

  return (
    <div className="group max-w-full">
      <button
        type="button"
        title={fullText}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="block max-w-full text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="block truncate">{summary}</span>
        <span className="mt-1 block text-[11px] text-primary md:hidden">
          {open ? "收起全部参数" : "点击查看全部参数"}
        </span>
      </button>
      <div
        className={cn(
          "mt-2 rounded-md border bg-secondary/40 p-2 text-foreground",
          open ? "block" : "hidden md:group-hover:block",
        )}
      >
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-5">
          {fullText}
        </pre>
      </div>
    </div>
  );
}

function propsSummary(payload: Record<string, unknown>, limit?: number) {
  const event = payload?.event as { properties?: Record<string, unknown> } | undefined;
  const props = event?.properties || {};
  const entries = Object.entries(props);
  if (!entries.length) return "-";
  const visible = typeof limit === "number" ? entries.slice(0, limit) : entries;
  const suffix = typeof limit === "number" && entries.length > limit ? ` · +${entries.length - limit}` : "";
  return visible.map(([key, value]) => `${key}=${stringifyValue(value)}`).join(" · ") + suffix;
}

function stringifyValue(value: unknown) {
  if (value == null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
