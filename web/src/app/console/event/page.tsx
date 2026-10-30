"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import dayjs, { Dayjs } from "dayjs";
import { Plus, Trash2 } from "lucide-react";
import {
  AnalyticsHeader,
  ChartPanel,
  EmptyAnalysis,
  MetricTile,
  ReportControls,
  ToolbarPanel,
} from "@/features/analytics/analytics-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, QueryTableRow } from "@/lib/api";
import { useProjectStore } from "@/stores/project-store";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

type MetricKind = "count" | "users" | "sum" | "avg";
type ChartKind = "line" | "bar";
type EventMetric = { id: string; event: string; kind: MetricKind; property: string };
type MetricSeries = { metric: EventMetric; name: string; points: Map<string, number>; total: number };

const metricLabel: Record<MetricKind, string> = {
  count: "总次数",
  users: "去重用户",
  sum: "数值属性总和",
  avg: "数值属性均值",
};

function createMetric(event = ""): EventMetric {
  return { id: `metric_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, event, kind: "count", property: "" };
}

function metricName(metric: EventMetric) {
  const suffix = metric.kind === "sum" || metric.kind === "avg"
    ? `${metric.property || "未选择属性"} ${metricLabel[metric.kind]}`
    : metricLabel[metric.kind];
  return `${metric.event || "未选择事件"} · ${suffix}`;
}

function metricValue(row: QueryTableRow, metric: EventMetric) {
  if (metric.kind === "count") return row.count;
  if (metric.kind === "users") return row.users;
  const sum = row.sums[metric.property] || 0;
  return metric.kind === "avg" && row.count ? sum / row.count : sum;
}

export default function EventAnalysisPage() {
  const projectId = useProjectStore((s) => s.projectId);
  const [metrics, setMetrics] = useState<EventMetric[]>([]);
  const [activeProperty, setActiveProperty] = useState<{ event: string; property: string } | undefined>();
  const [propertySearch, setPropertySearch] = useState("");
  const [propertyType, setPropertyType] = useState("all");
  const [interval, setInterval] = useState<"hour" | "day">("day");
  const [chartKind, setChartKind] = useState<ChartKind>("line");
  const [segmentId, setSegmentId] = useState<number | undefined>();
  const [range, setRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(7, "day").startOf("day"),
    dayjs().endOf("day"),
  ]);

  useEffect(() => {
    setMetrics([]);
    setActiveProperty(undefined);
    setPropertySearch("");
    setPropertyType("all");
    setSegmentId(undefined);
  }, [projectId]);

  const tsRange = useMemo(() => ({ from: range[0].valueOf(), to: range[1].valueOf() }), [range]);
  const events = useQuery({
    queryKey: ["all_events_for_analysis", projectId],
    queryFn: () => api.listEvents(projectId!),
    enabled: !!projectId,
  });
  const eventStats = useQuery({
    queryKey: ["all_event_stats_for_analysis", projectId, tsRange, segmentId],
    queryFn: () => api.queryTable(projectId!, { ...tsRange, limit: 500, segment_id: segmentId, dimensions: [{ type: "event", key: "event" }] }),
    enabled: !!projectId,
  });
  const segments = useQuery({
    queryKey: ["segments", projectId],
    queryFn: () => api.listSegments(projectId!),
    enabled: !!projectId,
  });
  const properties = useQuery({
    queryKey: ["event_properties_for_analysis", projectId],
    queryFn: () => api.listProperties(projectId!, { scope: "event" }),
    enabled: !!projectId,
  });
  const numericProperties = useMemo(
    () => (properties.data?.data || []).filter((property) => /number|int|float|double|decimal/i.test(property.data_type)),
    [properties.data],
  );
  const propertyRows = properties.data?.data || [];
  const allEvents = useMemo(
    () => [...(events.data?.data || [])].sort((a, b) => a.name.localeCompare(b.name)),
    [events.data],
  );
  const statsByEvent = useMemo(
    () => new Map((eventStats.data?.data.rows || []).map((row) => [row.dimensions[0]?.label || "", row])),
    [eventStats.data],
  );

  useEffect(() => {
    if (!metrics.length && allEvents.length) setMetrics([createMetric(allEvents[0].name)]);
  }, [allEvents, metrics.length]);

  const propertyValues = useQuery({
    queryKey: ["event_property_values", projectId, activeProperty, tsRange],
    queryFn: () => api.propertyValues(projectId!, { property: activeProperty!.property, event: activeProperty!.event, ...tsRange, limit: 12 }),
    enabled: !!projectId && !!activeProperty?.event && !!activeProperty?.property,
  });

  const activeMetrics = useMemo(
    () => metrics.filter((metric) => metric.event && (!["sum", "avg"].includes(metric.kind) || metric.property)),
    [metrics],
  );
  const analysis = useQuery({
    queryKey: ["multi_event_analysis", projectId, tsRange, interval, activeMetrics, segmentId],
    queryFn: async () => {
      const results = await Promise.all(activeMetrics.map(async (metric) => {
        const result = await api.queryTable(projectId!, {
          events: [metric.event],
          ...tsRange,
          limit: 500,
          segment_id: segmentId,
          dimensions: [{ type: "time", key: interval }],
          sum_properties: metric.kind === "sum" || metric.kind === "avg" ? [metric.property] : [],
        });
        return [metric.id, result.data.rows] as const;
      }));
      return Object.fromEntries(results) as Record<string, QueryTableRow[]>;
    },
    enabled: !!projectId && activeMetrics.length > 0,
  });

  const series = useMemo<MetricSeries[]>(() => activeMetrics.map((metric) => {
    const points = new Map<string, number>();
    (analysis.data?.[metric.id] || []).forEach((row) => {
      const bucket = row.dimensions[0]?.label || "-";
      points.set(bucket, metricValue(row, metric));
    });
    return {
      metric,
      name: metricName(metric),
      points,
      total: Array.from(points.values()).reduce((sum, value) => sum + value, 0),
    };
  }), [activeMetrics, analysis.data]);
  const buckets = useMemo(
    () => Array.from(new Set(series.flatMap((item) => Array.from(item.points.keys())))).sort(),
    [series],
  );
  const option = useMemo(() => ({
    color: ["#0f766e", "#2563eb", "#7c3aed", "#ea580c", "#db2777", "#0891b2", "#65a30d", "#b45309"],
    tooltip: { trigger: "axis" },
    legend: { bottom: 0, type: "scroll" },
    grid: { left: 52, right: 24, top: 28, bottom: 56 },
    xAxis: {
      type: "category",
      data: buckets.map((bucket) => interval === "hour" ? bucket.slice(5, 16).replace("T", " ") : bucket.slice(5, 10)),
      axisLine: { lineStyle: { color: "#cbd5e1" } },
      axisTick: { show: false },
    },
    yAxis: { type: "value", splitLine: { lineStyle: { color: "#e2e8f0" } } },
    series: series.map((item) => ({
      name: item.name,
      type: chartKind,
      smooth: chartKind === "line",
      barMaxWidth: 34,
      symbolSize: 6,
      data: buckets.map((bucket) => item.points.get(bucket) || 0),
    })),
  }), [buckets, chartKind, interval, series]);

  const updateMetric = (id: string, patch: Partial<EventMetric>) => {
    setMetrics((current) => current.map((metric) => metric.id === id ? { ...metric, ...patch } : metric));
  };
  const changeMetricKind = (metric: EventMetric, kind: MetricKind) => {
    updateMetric(metric.id, {
      kind,
      property: kind === "sum" || kind === "avg" ? (metric.property || numericProperties[0]?.name || "") : "",
    });
  };
  const addMetric = (event?: string) => {
    if (metrics.length >= 8) return;
    setMetrics((current) => [...current, createMetric(event || allEvents[0]?.name || "")]);
  };
  const removeMetric = (id: string) => {
    setMetrics((current) => current.length > 1 ? current.filter((metric) => metric.id !== id) : current);
  };
  const selectedEvents = new Set(activeMetrics.map((metric) => metric.event));
  const selectedSegment = (segments.data?.data || []).find((segment) => segment.id === segmentId);
  const parameterEvents = useMemo(
    () => Array.from(new Set(metrics.map((metric) => metric.event).filter(Boolean))),
    [metrics],
  );
  const propertyTypes = useMemo(() => Array.from(new Set(propertyRows.map((property) => property.data_type))).sort(), [propertyRows]);
  const filteredProperties = useMemo(() => {
    const needle = propertySearch.trim().toLowerCase();
    return propertyRows.filter((property) => {
      const name = `${property.name} ${property.display_name}`.toLowerCase();
      return (!needle || name.includes(needle)) && (propertyType === "all" || property.data_type === propertyType);
    });
  }, [propertyRows, propertySearch, propertyType]);

  return (
    <div>
      <AnalyticsHeader
        title="事件分析"
        description="可同时对比多个事件；每个事件独立选择总次数、去重用户或数值属性指标。"
      />
      <ReportControls
        range={range}
        onRangeChange={setRange}
        comparison="上个周期"
        filters={activeMetrics.length ? [`${activeMetrics.length} 个分析指标`, `${selectedEvents.size} 个事件`, selectedSegment ? `分群：${selectedSegment.name}` : "全部用户"] : ["未选择事件"]}
      />

      <ToolbarPanel>
        <div className="grid gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">事件与指标</div>
              <p className="mt-1 text-xs text-muted-foreground">最多 8 个指标。数值属性仅支持求和或均值。</p>
            </div>
            <Button type="button" variant="outline" size="sm" disabled={metrics.length >= 8} onClick={() => addMetric()}>
              <Plus className="h-4 w-4" />添加指标
            </Button>
          </div>
          <div className="grid gap-3">
            {metrics.map((metric, index) => (
              <div key={metric.id} className="grid gap-3 rounded-lg border bg-background p-3 lg:grid-cols-[minmax(190px,1fr)_180px_minmax(190px,1fr)_auto] lg:items-end">
                <div className="grid gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">{String.fromCharCode(65 + index)} · 事件</span>
                  <Select value={metric.event} onValueChange={(event) => updateMetric(metric.id, { event })}>
                    <SelectTrigger><SelectValue placeholder="选择事件" /></SelectTrigger>
                    <SelectContent>{allEvents.map((item) => <SelectItem key={item.id} value={item.name}>{item.display_name || item.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">统计方式</span>
                  <Select value={metric.kind} onValueChange={(value) => changeMetricKind(metric, value as MetricKind)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="count">总次数</SelectItem>
                      <SelectItem value="users">去重用户</SelectItem>
                      <SelectItem value="sum">数值属性总和</SelectItem>
                      <SelectItem value="avg">数值属性均值</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {metric.kind === "sum" || metric.kind === "avg" ? <div className="grid gap-1.5"><span className="text-xs font-medium text-muted-foreground">数值事件属性</span><Select value={metric.property} onValueChange={(property) => updateMetric(metric.id, { property })}><SelectTrigger><SelectValue placeholder="选择数值属性" /></SelectTrigger><SelectContent>{numericProperties.map((property) => <SelectItem key={property.id} value={property.name}>{property.display_name || property.name}</SelectItem>)}</SelectContent></Select></div> : <div className="flex h-9 items-center rounded-md border border-dashed px-3 text-xs text-muted-foreground">{metricLabel[metric.kind]}</div>}
                <Button type="button" variant="ghost" size="icon" disabled={metrics.length <= 1} onClick={() => removeMetric(metric.id)} aria-label={`删除指标 ${index + 1}`}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:max-w-4xl lg:grid-cols-3">
            <div className="grid gap-1.5"><span className="text-sm font-medium">时间粒度</span><div className="grid grid-cols-2 rounded-md border bg-background p-1">{(["hour", "day"] as const).map((item) => <Button key={item} type="button" variant={interval === item ? "default" : "ghost"} size="sm" onClick={() => setInterval(item)}>{item === "hour" ? "按小时" : "按天"}</Button>)}</div></div>
            <div className="grid gap-1.5"><span className="text-sm font-medium">图表类型</span><div className="grid grid-cols-2 rounded-md border bg-background p-1">{(["line", "bar"] as const).map((item) => <Button key={item} type="button" variant={chartKind === item ? "default" : "ghost"} size="sm" onClick={() => setChartKind(item)}>{item === "line" ? "折线图" : "柱状图"}</Button>)}</div></div>
            <div className="grid gap-1.5"><span className="text-sm font-medium">用户分群（可选）</span><Select value={segmentId ? String(segmentId) : "__all__"} onValueChange={(value) => setSegmentId(value === "__all__" ? undefined : Number(value))}><SelectTrigger><SelectValue placeholder="全部用户" /></SelectTrigger><SelectContent><SelectItem value="__all__">全部用户</SelectItem>{(segments.data?.data || []).map((segment) => <SelectItem key={segment.id} value={String(segment.id)}>{segment.name}</SelectItem>)}</SelectContent></Select></div>
          </div>
        </div>
      </ToolbarPanel>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile label="分析指标" value={activeMetrics.length} hint="每项独立计算" loading={analysis.isFetching} />
        <MetricTile label="分析事件" value={selectedEvents.size} hint="可重复选择不同指标" loading={analysis.isFetching} />
        <MetricTile label="全部事件" value={allEvents.length} hint="来自事件字典" loading={events.isLoading} />
        <MetricTile label="可选数值属性" value={numericProperties.length} hint="支持总和、均值" loading={properties.isLoading} />
      </div>

      {!projectId ? <EmptyAnalysis title="暂无项目" description="请选择项目后配置事件分析。" /> : <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <ChartPanel title="指标趋势" description="每条曲线或柱体对应一个事件指标">
          {!activeMetrics.length ? <EmptyAnalysis className="min-h-[430px]" title="请完善事件指标" description="选择事件；数值属性指标还需选择属性。" /> : <div className="relative">{analysis.isFetching ? <div className="absolute inset-x-0 top-0 h-px aero-scan-line" /> : null}<ReactECharts option={option} style={{ height: 430 }} /></div>}
        </ChartPanel>
        <ChartPanel title="指标汇总" description="当前时间范围内每项指标的总值" contentClassName="p-0 sm:p-0">
          {!series.length ? <EmptyAnalysis className="min-h-56" title="暂无结果" description="配置完成后自动计算。" /> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>事件与指标</TableHead><TableHead className="text-right">总值</TableHead></TableRow></TableHeader><TableBody>{series.map((item) => <TableRow key={item.metric.id}><TableCell className="max-w-64 break-words font-medium">{item.name}</TableCell><TableCell className="text-right font-mono">{item.total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell></TableRow>)}</TableBody></Table></div>}
        </ChartPanel>
      </div>}

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <ChartPanel title="全部事件" description="事件字典中的全部事件；当前范围未触发的事件显示为 0">
          <div className="max-h-[560px] overflow-y-auto"><Table className="min-w-[720px]"><TableHeader><TableRow><TableHead>事件</TableHead><TableHead className="text-right">次数</TableHead><TableHead className="text-right">用户</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader><TableBody>{allEvents.map((item) => { const stat = statsByEvent.get(item.name); return <TableRow key={item.id}><TableCell className="max-w-96"><div className="break-words font-medium">{item.display_name || item.name}</div>{item.display_name ? <div className="mt-0.5 break-all text-xs text-muted-foreground">{item.name}</div> : null}</TableCell><TableCell className="text-right font-mono">{(stat?.count || 0).toLocaleString()}</TableCell><TableCell className="text-right font-mono">{(stat?.users || 0).toLocaleString()}</TableCell><TableCell className="text-right"><Button type="button" variant="ghost" size="sm" disabled={metrics.length >= 8} onClick={() => addMetric(item.name)}><Plus className="h-4 w-4" />添加</Button></TableCell></TableRow>; })}</TableBody></Table></div>
        </ChartPanel>
        <ChartPanel title="事件参数" description="自动跟随上方已选事件；可按参数名和类型筛选，点击参数查看该事件的值分布" contentClassName="pt-3 sm:pt-3">
          <div className="grid gap-3">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px]">
              <Input value={propertySearch} onChange={(event) => setPropertySearch(event.target.value)} placeholder="筛选参数名" />
              <Select value={propertyType} onValueChange={setPropertyType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">全部类型</SelectItem>{propertyTypes.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {!parameterEvents.length ? <EmptyAnalysis className="min-h-40" title="暂无已选事件" description="先在「事件与指标」中选择事件。" /> : <div className="grid gap-3">{parameterEvents.map((event) => <div key={event} className="rounded-md border bg-background"><div className="border-b px-3 py-2"><div className="break-all text-sm font-medium">{event}</div><div className="mt-0.5 text-xs text-muted-foreground">{filteredProperties.length} 个匹配参数</div></div><div className="max-h-64 overflow-y-auto">{filteredProperties.map((property) => { const active = activeProperty?.event === event && activeProperty.property === property.name; return <div key={property.id} className="border-b last:border-b-0"><button type="button" onClick={() => setActiveProperty(active ? undefined : { event, property: property.name })} className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent/60 ${active ? "bg-accent" : ""}`}><span className="min-w-0 break-all font-medium">{property.display_name || property.name}</span><Badge variant={/number|int|float|double|decimal/i.test(property.data_type) ? "info" : "secondary"}>{property.data_type}</Badge></button>{active ? <div className="border-t bg-card px-3 py-3"><div className="mb-2 text-xs font-medium text-muted-foreground">{property.name} · Top values</div>{propertyValues.isFetching ? <div className="text-sm text-muted-foreground">加载中…</div> : propertyValues.data?.data.length ? <div className="grid gap-2">{propertyValues.data.data.map((item) => <div key={item.raw} className="grid gap-1"><div className="flex items-center justify-between gap-3 text-xs"><span className="min-w-0 break-all font-medium">{item.label}</span><span className="shrink-0 font-mono text-muted-foreground">{item.count.toLocaleString()} 次</span></div><div className="h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, item.share * 100)}%` }} /></div></div>)}</div> : <div className="text-sm text-muted-foreground">当前事件没有该参数值。</div>}</div> : null}</div>; })}{!properties.isLoading && !filteredProperties.length ? <div className="px-3 py-5 text-center text-sm text-muted-foreground">没有匹配参数。</div> : null}</div></div>)}</div>}
          </div>
        </ChartPanel>
      </div>
    </div>
  );
}
