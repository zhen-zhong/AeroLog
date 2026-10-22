"use client";

import dynamic from "next/dynamic";
import { useMutation } from "@tanstack/react-query";
import dayjs, { Dayjs } from "dayjs";
import { Play } from "lucide-react";
import { useState } from "react";
import { AnalyticsHeader, ChartPanel, DateTimeRange, EmptyAnalysis, MetricTile, NumberField } from "@/features/analytics/analytics-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { useProjectStore } from "@/stores/project-store";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

export default function SessionsPage() {
  const projectId = useProjectStore((state) => state.projectId);
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().subtract(7, "day").startOf("day"), dayjs().endOf("day")]);
  const [gap, setGap] = useState(20 * 60);
  const session = useMutation({ mutationFn: () => api.sessions(projectId!, { from: range[0].valueOf(), to: range[1].valueOf(), session_gap_seconds: gap }) });
  const result = session.data?.data;
  const chart = { tooltip: { trigger: "axis" }, legend: { bottom: 0 }, grid: { left: 48, right: 24, top: 28, bottom: 48 }, xAxis: { type: "category", data: (result?.days || []).map((day) => day.day) }, yAxis: { type: "value" }, series: [{ name: "Session", type: "line", smooth: true, data: (result?.days || []).map((day) => day.sessions) }, { name: "用户", type: "line", smooth: true, data: (result?.days || []).map((day) => day.users) }] };
  return <div><AnalyticsHeader title="Session 分析" description="同一用户相邻事件间隔超过阈值时切分为新 Session，衡量使用深度和时长。" /><div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]"><Card><CardContent className="grid gap-4 pt-5 sm:pt-5"><DateTimeRange value={range} onChange={setRange} stacked /><NumberField label="Session 间隔（秒）" min={60} max={14400} step={60} value={gap} onChange={setGap} /><Button disabled={!projectId || session.isPending} onClick={() => session.mutate()}><Play className="h-4 w-4" />计算 Session</Button>{session.error ? <Badge variant="danger">{String(session.error)}</Badge> : null}</CardContent></Card><div className="grid content-start gap-5">{!result ? <EmptyAnalysis className="min-h-72 rounded-lg border" title="尚未计算 Session" description="选择时间范围和间隔后点击计算。" /> : <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricTile label="Session" value={result.sessions} /><MetricTile label="用户" value={result.users} /><MetricTile label="平均事件数" value={result.average_events} hint="每 Session" /><MetricTile label="平均时长" value={result.average_duration_seconds} hint="秒 / Session" /></div><ChartPanel title="每日 Session 趋势" description="按 Session 开始日期统计"><ReactECharts option={chart} style={{ height: 340 }} /></ChartPanel><ChartPanel title="每日明细" description="Session 按开始日期归属" contentClassName="p-0 sm:p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>日期</TableHead><TableHead className="text-right">Session</TableHead><TableHead className="text-right">用户</TableHead><TableHead className="text-right">平均事件数</TableHead><TableHead className="text-right">平均时长（秒）</TableHead></TableRow></TableHeader><TableBody>{result.days.map((day) => <TableRow key={day.day}><TableCell>{day.day}</TableCell><TableCell className="text-right font-mono">{day.sessions.toLocaleString()}</TableCell><TableCell className="text-right font-mono">{day.users.toLocaleString()}</TableCell><TableCell className="text-right font-mono">{day.average_events.toFixed(2)}</TableCell><TableCell className="text-right font-mono">{day.average_duration_seconds.toFixed(1)}</TableCell></TableRow>)}</TableBody></Table></div></ChartPanel>{result.truncated ? <Badge variant="warning">原始事件超过 20 万条，结果已截断</Badge> : null}</>}</div></div></div>;
}
