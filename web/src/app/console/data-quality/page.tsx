"use client";

import dayjs from "dayjs";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Activity, RefreshCw, ServerCog, TriangleAlert } from "lucide-react";
import { AnalyticsHeader, EmptyAnalysis, MetricTile } from "@/features/analytics/analytics-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, SensorsDataQualityProject, SensorsReconciliation, SensorsReconciliationDay } from "@/lib/api";

function formatTime(value?: string) {
  return value ? dayjs(value).format("YYYY-MM-DD HH:mm:ss") : "暂无事件";
}

function projectState(project: SensorsDataQualityProject) {
  if (project.last_error) return { label: "连接异常", variant: "danger" as const };
  if (!project.last_event_at) return { label: "等待数据", variant: "warning" as const };
  if (project.dlq_last_hour > 0) return { label: "存在死信", variant: "warning" as const };
  return { label: "正常", variant: "success" as const };
}

export default function DataQualityPage() {
  const quality = useQuery({ queryKey: ["sensors-data-quality"], queryFn: api.getSensorsDataQuality, refetchInterval: 30_000 });
  const [reconciliationDays, setReconciliationDays] = useState("3");
  const reconciliation = useMutation({ mutationFn: (days: number) => api.reconcileSensorsData(days) });
  const data = quality.data?.data;
  const projects = data?.projects || [];
  const queue = data?.queue;
  const recentProjects = projects.filter((project) => project.events_last_5_minutes > 0).length;
  const projectDLQ = projects.reduce((total, project) => total + project.dlq_last_hour, 0);

  return <div>
    <AnalyticsHeader title="数据健康" description="按项目查看神策事件入库状态。Kafka lag 与消费者状态属于共享队列，不按项目拆分。" action={<Button variant="outline" size="sm" onClick={() => quality.refetch()} disabled={quality.isFetching}><RefreshCw className={quality.isFetching ? "animate-spin" : ""} />刷新</Button>} />
    {quality.error ? <EmptyAnalysis title="无法读取数据健康状态" description={String(quality.error)} /> : <>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile label="已接入项目" value={projects.length} hint="神策数据源" loading={quality.isLoading} />
        <MetricTile label="近 5 分钟活跃" value={recentProjects} hint="有事件入库的项目" loading={quality.isLoading} />
        <Card className="relative overflow-hidden"><div className="pointer-events-none absolute inset-x-0 top-0 h-px aero-scan-line" /><CardHeader className="pb-2"><CardDescription>共享 Kafka lag</CardDescription></CardHeader><CardContent><div className="text-2xl font-semibold tabular-nums">{quality.isLoading ? "…" : queue?.available ? Math.round(queue.kafka_lag).toLocaleString() : "-"}</div><p className="mt-1 text-xs text-muted-foreground">{queue?.available ? "事件与用户属性 Topic 合计" : "共享队列监控不可用"}</p></CardContent></Card>
        <MetricTile label="近 1 小时 DLQ" value={queue?.dlq_last_hour ?? projectDLQ} hint="共享消费链路" loading={quality.isLoading} />
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="min-w-0"><CardHeader className="border-b bg-secondary/35"><CardTitle>项目入库状态</CardTitle><CardDescription>每 30 秒自动刷新；时间按浏览器本地时区显示。</CardDescription></CardHeader><CardContent className="p-0 sm:p-0">{projects.length ? <div className="overflow-x-auto"><Table className="min-w-[920px]"><TableHeader><TableRow><TableHead>项目</TableHead><TableHead>神策项目</TableHead><TableHead>状态</TableHead><TableHead>最后入库</TableHead><TableHead className="text-right">近 5 分钟</TableHead><TableHead className="text-right">近 1 小时</TableHead><TableHead className="text-right">项目 DLQ</TableHead><TableHead>最近校验</TableHead></TableRow></TableHeader><TableBody>{projects.map((project) => { const state = projectState(project); return <TableRow key={project.project_id}><TableCell className="font-medium">{project.project_name}</TableCell><TableCell>{project.source_project}</TableCell><TableCell><Badge variant={state.variant}>{state.label}</Badge>{project.last_error ? <div className="mt-1 max-w-52 truncate text-xs text-destructive" title={project.last_error}>{project.last_error}</div> : null}</TableCell><TableCell className="font-mono text-xs">{formatTime(project.last_event_at)}</TableCell><TableCell className="text-right font-mono">{project.events_last_5_minutes.toLocaleString()}</TableCell><TableCell className="text-right font-mono">{project.events_last_hour.toLocaleString()}</TableCell><TableCell className="text-right font-mono">{project.dlq_last_hour.toLocaleString()}</TableCell><TableCell className="font-mono text-xs">{project.last_verified_at ? formatTime(project.last_verified_at) : "未校验"}</TableCell></TableRow>; })}</TableBody></Table></div> : <div className="p-4 sm:p-5"><EmptyAnalysis title="暂无神策项目" description="在项目管理中配置神策数据源后，这里会展示实时入库健康状态。" /></div>}</CardContent></Card>
        <div className="grid content-start gap-5"><Card><CardHeader><CardTitle className="flex items-center gap-2"><ServerCog className="h-4 w-4" />共享队列</CardTitle><CardDescription>多个项目复用相同 Kafka Topic，因此仅展示全局状态。</CardDescription></CardHeader><CardContent className="space-y-3 text-sm">{queue?.available ? <><div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">消费者</span><Badge variant={queue.consumers_up ? "success" : "danger"}>{queue.consumers_up ? "运行中" : "不可用"}</Badge></div><div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">Kafka lag</span><span className="font-mono">{Math.round(queue.kafka_lag).toLocaleString()}</span></div><div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">近 1 小时 DLQ</span><span className="font-mono">{queue.dlq_last_hour.toLocaleString()}</span></div></> : <div className="rounded-md border border-dashed bg-secondary/30 p-3 text-muted-foreground"><TriangleAlert className="mb-2 h-4 w-4" />{queue?.error || "队列监控暂不可用"}</div>}</CardContent></Card><Card><CardHeader><CardTitle className="flex items-center gap-2"><Activity className="h-4 w-4" />判定规则</CardTitle></CardHeader><CardContent className="space-y-2 text-sm text-muted-foreground"><p>正常：连接无错误、已有事件入库、项目 DLQ 为 0。</p><p>等待数据：连接正常，但尚未收到神策事件。</p><p>存在死信：最近 1 小时项目关联的 DLQ 大于 0。</p></CardContent></Card></div>
      </div>
      <Card className="mt-5 min-w-0">
        <CardHeader className="gap-3 border-b bg-secondary/35 sm:flex-row sm:items-start sm:justify-between">
          <div><CardTitle>神策 / AeroLog 日对账</CardTitle><CardDescription>比较已完成自然日的事件总次数、去重用户及核心事件。仅点击“运行对账”时调用神策查询 API。</CardDescription></div>
          <div className="flex items-center gap-2"><Select value={reconciliationDays} onValueChange={setReconciliationDays}><SelectTrigger className="w-28"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">近 1 天</SelectItem><SelectItem value="3">近 3 天</SelectItem><SelectItem value="7">近 7 天</SelectItem></SelectContent></Select><Button size="sm" onClick={() => reconciliation.mutate(Number(reconciliationDays))} disabled={reconciliation.isPending}>{reconciliation.isPending ? <RefreshCw className="animate-spin" /> : <Activity />}运行对账</Button></div>
        </CardHeader>
        <CardContent className="p-0 sm:p-0">
          {reconciliation.error ? <div className="p-4 text-sm text-destructive">{String(reconciliation.error)}</div> : null}
          {!reconciliation.data && !reconciliation.isPending ? <div className="p-4 text-sm text-muted-foreground">默认不查询神策。选择天数后手动运行；当天实时数据因传输延迟不纳入对账。</div> : null}
          {reconciliation.data?.data ? <ReconciliationTable data={reconciliation.data.data} /> : null}
        </CardContent>
      </Card>
    </>}
  </div>;
}

function pair(sensors: number, aerolog: number) {
  const delta = aerolog - sensors;
  return <div className="leading-5"><div>{sensors.toLocaleString()} <span className="text-muted-foreground">/</span> {aerolog.toLocaleString()}</div><div className={delta === 0 ? "text-xs text-emerald-600" : "text-xs text-amber-600"}>差值 {delta > 0 ? "+" : ""}{delta.toLocaleString()}</div></div>;
}

function eventPair(row: SensorsReconciliationDay, event: string) {
  return pair(row.sensors_by_event?.[event] || 0, row.aerolog_by_event?.[event] || 0);
}

function ReconciliationTable({ data }: { data: SensorsReconciliation }) {
  return <div className="space-y-5 p-4 sm:p-5">
    <p className="text-xs text-muted-foreground">仅统计完整自然日；每个项目按自身时区计算。总事件默认排除身份绑定事件 <code>$SignUp</code>；事件明细仍保留。</p>
    {data.projects.map((project) => <div key={project.project_id} className="overflow-hidden rounded-md border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-secondary/30 px-3 py-2"><div className="text-sm font-medium">{project.project_name} <span className="font-normal text-muted-foreground">· {project.source_project} · {project.timezone} · {project.from} 至 {project.to}</span></div>{project.error ? <Badge variant="danger">查询失败</Badge> : <Badge variant="success">已完成</Badge>}</div>
      {project.error ? <div className="p-3 text-sm text-destructive">{project.error}</div> : <div className="overflow-x-auto"><Table className="min-w-[1040px]"><TableHeader><TableRow><TableHead>日期</TableHead><TableHead>总事件<br /><span className="font-normal text-muted-foreground">神策 / AeroLog</span></TableHead><TableHead>神策合并用户</TableHead><TableHead>AeroLog 原始 Distinct ID</TableHead><TableHead>$SignUp<br /><span className="font-normal text-muted-foreground">身份绑定事件</span></TableHead>{project.events.map((event) => <TableHead key={event}>{event}</TableHead>)}</TableRow></TableHeader><TableBody>{project.rows.map((row) => <TableRow key={row.date}><TableCell className="font-mono text-xs">{row.date}</TableCell><TableCell>{pair(row.sensors_events, row.aerolog_events)}</TableCell><TableCell className="font-mono">{row.sensors_merged_users.toLocaleString()}</TableCell><TableCell className="font-mono">{row.aerolog_distinct_ids.toLocaleString()}</TableCell><TableCell className="font-mono">{row.identity_events.toLocaleString()}</TableCell>{project.events.map((event) => <TableCell key={event}>{eventPair(row, event)}</TableCell>)}</TableRow>)}</TableBody></Table></div>}
    </div>)}
  </div>;
}
