"use client";

import dynamic from "next/dynamic";
import { useMutation, useQuery } from "@tanstack/react-query";
import dayjs, { Dayjs } from "dayjs";
import { Play } from "lucide-react";
import { useState } from "react";
import { AnalyticsHeader, ChartPanel, DateTimeRange, EmptyAnalysis, NumberField } from "@/features/analytics/analytics-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { useProjectStore } from "@/stores/project-store";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });
const ANY_EVENT = "__any_event__";

export default function PathsPage() {
  const projectId = useProjectStore((state) => state.projectId);
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().subtract(7, "day").startOf("day"), dayjs().endOf("day")]);
  const [startEvent, setStartEvent] = useState(ANY_EVENT);
  const [gap, setGap] = useState(20 * 60);
  const [maxSteps, setMaxSteps] = useState(5);
  const [maxNodes, setMaxNodes] = useState(12);
  const events = useQuery({ queryKey: ["path_events", projectId], queryFn: () => api.topEvents(projectId!, { from: range[0].valueOf(), to: range[1].valueOf(), limit: 100 }), enabled: !!projectId });
  const path = useMutation({ mutationFn: () => api.paths(projectId!, { from: range[0].valueOf(), to: range[1].valueOf(), session_gap_seconds: gap, start_event: startEvent === ANY_EVENT ? undefined : startEvent, max_steps: maxSteps, max_nodes: maxNodes }) });
  const result = path.data?.data;
  const chart = { tooltip: { trigger: "item", triggerOn: "mousemove" }, series: [{ type: "sankey", data: (result?.nodes || []).map((node) => ({ name: node.name, value: node.count })), links: (result?.edges || []).map((edge) => ({ source: edge.source, target: edge.target, value: edge.count })), emphasis: { focus: "adjacency" }, lineStyle: { color: "gradient", curveness: 0.45 }, label: { fontSize: 12 } }] };

  return <div><AnalyticsHeader title="用户行为路径" description="按用户和 Session 切分事件序列，观察真实的下一步行为。连续相同事件会自动合并。" /><div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]"><Card><CardContent className="grid gap-4 pt-5 sm:pt-5"><DateTimeRange value={range} onChange={setRange} stacked /><div className="grid gap-2"><span className="text-sm font-medium">起始事件</span><Select value={startEvent} onValueChange={setStartEvent}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ANY_EVENT}>所有 Session</SelectItem>{(events.data?.data || []).map((event) => <SelectItem key={event.event} value={event.event}>{event.event}</SelectItem>)}</SelectContent></Select></div><NumberField label="Session 间隔（秒）" min={60} max={14400} step={60} value={gap} onChange={setGap} /><NumberField label="最大路径步骤" min={2} max={12} value={maxSteps} onChange={setMaxSteps} /><NumberField label="最多展示节点" min={3} max={30} value={maxNodes} onChange={setMaxNodes} /><Button disabled={!projectId || path.isPending} onClick={() => path.mutate()}><Play className="h-4 w-4" />生成路径</Button>{path.error ? <Badge variant="danger">{String(path.error)}</Badge> : null}</CardContent></Card><div className="grid content-start gap-5"><ChartPanel title="路径流向" description={result ? `${result.sessions.toLocaleString()} 个匹配 Session` : "设置条件后生成"}>{!result ? <EmptyAnalysis className="min-h-[430px]" title="尚未生成路径" description="选择范围和起始事件后点击生成路径。" /> : !result.edges.length ? <EmptyAnalysis className="min-h-[430px]" title="没有连续行为" description="当前条件下没有可连接的事件序列。" /> : <ReactECharts option={chart} style={{ height: 460 }} />}</ChartPanel>{result?.truncated ? <Badge variant="warning">原始事件超过 20 万条，结果已截断</Badge> : null}<ChartPanel title="高频流转" description="只展示进入前列节点的事件连接" contentClassName="p-0 sm:p-0">{result?.edges.length ? <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>上一步</TableHead><TableHead>下一步</TableHead><TableHead className="text-right">Session 数</TableHead></TableRow></TableHeader><TableBody>{result.edges.map((edge) => <TableRow key={`${edge.source}-${edge.target}`}><TableCell>{edge.source}</TableCell><TableCell>{edge.target}</TableCell><TableCell className="text-right font-mono">{edge.count.toLocaleString()}</TableCell></TableRow>)}</TableBody></Table></div> : <EmptyAnalysis className="min-h-28" title="暂无流转明细" />}</ChartPanel></div></div></div>;
}
