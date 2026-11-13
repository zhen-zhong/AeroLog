"use client";

import dynamic from "next/dynamic";
import { useMutation, useQuery } from "@tanstack/react-query";
import dayjs, { Dayjs } from "dayjs";
import { Play } from "lucide-react";
import { useEffect, useState } from "react";
import { AnalyticsHeader, ChartPanel, DateTimeRange, EmptyAnalysis, MetricTile, NumberField } from "@/features/analytics/analytics-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { useProjectStore } from "@/stores/project-store";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });
const ANY_EVENT = "__any_event__";
const NONE = "__none__";

export default function SessionsPage() {
  const projectId = useProjectStore((state) => state.projectId);
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().subtract(7, "day").startOf("day"), dayjs().endOf("day")]);
  const [gap, setGap] = useState(20 * 60);
  const [segmentId, setSegmentId] = useState<number | undefined>();
  const [cohortEvent, setCohortEvent] = useState(ANY_EVENT);
  const [cohortProperty, setCohortProperty] = useState("");
  const [cohortValue, setCohortValue] = useState("");
  useEffect(() => { setSegmentId(undefined); setCohortEvent(ANY_EVENT); setCohortProperty(""); setCohortValue(""); }, [projectId]);
  const segments = useQuery({ queryKey: ["segments", projectId], queryFn: () => api.listSegments(projectId!), enabled: !!projectId });
  const events = useQuery({ queryKey: ["session_events", projectId, range[0].valueOf(), range[1].valueOf()], queryFn: () => api.topEvents(projectId!, { from: range[0].valueOf(), to: range[1].valueOf(), limit: 100 }), enabled: !!projectId });
  const cohortProperties = useQuery({ queryKey: ["session_cohort_properties", projectId, cohortEvent], queryFn: () => api.listProperties(projectId!, { scope: "event", event: cohortEvent, include_global: true }), enabled: !!projectId && cohortEvent !== ANY_EVENT });
  const session = useMutation({ mutationFn: () => api.sessions(projectId!, { from: range[0].valueOf(), to: range[1].valueOf(), session_gap_seconds: gap, segment_id: segmentId, cohort_event: cohortEvent === ANY_EVENT ? undefined : cohortEvent, cohort_property: cohortProperty || undefined, cohort_value: cohortProperty && cohortValue ? cohortValue : undefined }) });
  const result = session.data?.data;
  const chart = { tooltip: { trigger: "axis" }, legend: { bottom: 0 }, grid: { left: 48, right: 24, top: 28, bottom: 48 }, xAxis: { type: "category", data: (result?.days || []).map((day) => day.day) }, yAxis: { type: "value" }, series: [{ name: "Session", type: "line", smooth: true, data: (result?.days || []).map((day) => day.sessions) }, { name: "用户", type: "line", smooth: true, data: (result?.days || []).map((day) => day.users) }] };
  return <div><AnalyticsHeader title="Session 分析" description="同一用户相邻事件间隔超过阈值时切分为新 Session，衡量使用深度和时长。" /><div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]"><Card><CardContent className="grid gap-4 pt-5 sm:pt-5"><DateTimeRange value={range} onChange={setRange} stacked /><div className="grid gap-2"><span className="text-sm font-medium">用户分群（可选）</span><Select value={segmentId ? String(segmentId) : "__all__"} onValueChange={(value) => setSegmentId(value === "__all__" ? undefined : Number(value))}><SelectTrigger><SelectValue placeholder="全部用户" /></SelectTrigger><SelectContent><SelectItem value="__all__">全部用户</SelectItem>{(segments.data?.data || []).map((segment) => <SelectItem key={segment.id} value={String(segment.id)}>{segment.name}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-2"><Label>筛选用户事件（可选）</Label><Select value={cohortEvent} onValueChange={(value) => { setCohortEvent(value); setCohortProperty(""); setCohortValue(""); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ANY_EVENT}>不按事件筛选</SelectItem>{(events.data?.data || []).map((event) => <SelectItem key={event.event} value={event.event}>{event.event}</SelectItem>)}</SelectContent></Select></div>{cohortEvent !== ANY_EVENT ? <><div className="grid gap-2"><Label>事件参数（可选）</Label><Select value={cohortProperty || NONE} onValueChange={(value) => { setCohortProperty(value === NONE ? "" : value); setCohortValue(""); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE}>仅发生过该事件</SelectItem>{(cohortProperties.data?.data || []).map((property) => <SelectItem key={property.name} value={property.name}>{property.display_name || property.name}</SelectItem>)}</SelectContent></Select></div>{cohortProperty ? <div className="grid gap-2"><Label htmlFor="session-cohort-value">参数值（可选）</Label><Input id="session-cohort-value" value={cohortValue} onChange={(event) => setCohortValue(event.target.value)} placeholder="留空表示参数存在" /></div> : null}</> : null}<NumberField label="Session 间隔（秒）" min={60} max={14400} step={60} value={gap} onChange={setGap} /><Button disabled={!projectId || session.isPending} onClick={() => session.mutate()}><Play className="h-4 w-4" />计算 Session</Button>{session.error ? <Badge variant="danger">{String(session.error)}</Badge> : null}</CardContent></Card><div className="grid content-start gap-5">{!result ? <EmptyAnalysis className="min-h-72 rounded-lg border" title="尚未计算 Session" description="选择时间范围和间隔后点击计算。" /> : <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricTile label="Session" value={result.sessions} /><MetricTile label="用户" value={result.users} /><MetricTile label="平均事件数" value={result.average_events} hint="每 Session" /><MetricTile label="平均时长" value={result.average_duration_seconds} hint="秒 / Session" /></div><ChartPanel title="每日 Session 趋势" description="按 Session 开始日期统计"><ReactECharts option={chart} style={{ height: 340 }} /></ChartPanel><ChartPanel title="每日明细" description="Session 按开始日期归属" contentClassName="p-0 sm:p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>日期</TableHead><TableHead className="text-right">Session</TableHead><TableHead className="text-right">用户</TableHead><TableHead className="text-right">平均事件数</TableHead><TableHead className="text-right">平均时长（秒）</TableHead></TableRow></TableHeader><TableBody>{result.days.map((day) => <TableRow key={day.day}><TableCell>{day.day}</TableCell><TableCell className="text-right font-mono">{day.sessions.toLocaleString()}</TableCell><TableCell className="text-right font-mono">{day.users.toLocaleString()}</TableCell><TableCell className="text-right font-mono">{day.average_events.toFixed(2)}</TableCell><TableCell className="text-right font-mono">{day.average_duration_seconds.toFixed(1)}</TableCell></TableRow>)}</TableBody></Table></div></ChartPanel>{result.truncated ? <Badge variant="warning">原始事件超过 20 万条，结果已截断</Badge> : null}</>}</div></div></div>;
}
