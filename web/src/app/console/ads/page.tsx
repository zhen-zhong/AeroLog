"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import dayjs, { Dayjs } from "dayjs";
import { AnalyticsHeader, ChartPanel, EmptyAnalysis, MetricTile, ReportControls, ToolbarPanel } from "@/features/analytics/analytics-ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, QueryDimension, QueryTableRow } from "@/lib/api";
import { useProjectStore } from "@/stores/project-store";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

const AD_EVENTS = ["ad_show", "ad_complete", "ad_failure"] as const;
const BREAKDOWNS = [
  { key: "placement", label: "广告位" },
  { key: "ad_network", label: "广告网络" },
  { key: "ad_format", label: "广告形式" },
  { key: "ad_unit_id", label: "广告单元" },
] as const;

type AdEvent = (typeof AD_EVENTS)[number];
type DailyRow = { day: string; show: number; complete: number; failure: number; users: number };
type BreakdownRow = { label: string; show: number; complete: number; failure: number; users: number };

export default function AdsPage() {
  const projectId = useProjectStore((s) => s.projectId);
  const [range, setRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(7, "day").startOf("day"),
    dayjs().endOf("day"),
  ]);
  const [breakdown, setBreakdown] = useState<(typeof BREAKDOWNS)[number]["key"]>("placement");
  const timeDimensions = useMemo<QueryDimension[]>(() => [{ type: "time", key: "day" }], []);
  const rangeValue = useMemo(() => ({ from: range[0].valueOf(), to: range[1].valueOf() }), [range]);

  const daily = useQuery({
    queryKey: ["ads_daily", projectId, rangeValue],
    queryFn: async () => {
      const responses = await Promise.all(AD_EVENTS.map((event) =>
        api.queryTable(projectId!, { events: [event], ...rangeValue, limit: 500, dimensions: timeDimensions }),
      ));
      return Object.fromEntries(AD_EVENTS.map((event, index) => [event, responses[index].data.rows])) as Record<AdEvent, QueryTableRow[]>;
    },
    enabled: !!projectId,
  });

  const byProperty = useQuery({
    queryKey: ["ads_breakdown", projectId, rangeValue, breakdown],
    queryFn: async () => {
      const responses = await Promise.all(AD_EVENTS.map((event) =>
        api.queryTable(projectId!, {
          events: [event],
          ...rangeValue,
          limit: 200,
          dimensions: [{ type: "property", key: breakdown }, { type: "event", key: "event" }],
        }),
      ));
      return Object.fromEntries(AD_EVENTS.map((event, index) => [event, responses[index].data.rows])) as Record<AdEvent, QueryTableRow[]>;
    },
    enabled: !!projectId,
  });

  const dailyRows = useMemo<DailyRow[]>(() => {
    const values = new Map<string, DailyRow>();
    AD_EVENTS.forEach((event) => {
      (daily.data?.[event] || []).forEach((row) => {
        const day = row.dimensions[0]?.label || "-";
        const current = values.get(day) || { day, show: 0, complete: 0, failure: 0, users: 0 };
        current[event === "ad_show" ? "show" : event === "ad_complete" ? "complete" : "failure"] += row.count;
        if (event === "ad_show") current.users += row.users;
        values.set(day, current);
      });
    });
    return Array.from(values.values()).sort((a, b) => a.day.localeCompare(b.day));
  }, [daily.data]);

  const breakdownRows = useMemo<BreakdownRow[]>(() => {
    const values = new Map<string, BreakdownRow>();
    AD_EVENTS.forEach((event) => {
      (byProperty.data?.[event] || []).forEach((row) => {
        const label = row.dimensions[0]?.label || "(未设置)";
        const current = values.get(label) || { label, show: 0, complete: 0, failure: 0, users: 0 };
        current[event === "ad_show" ? "show" : event === "ad_complete" ? "complete" : "failure"] += row.count;
        if (event === "ad_show") current.users += row.users;
        values.set(label, current);
      });
    });
    return Array.from(values.values()).sort((a, b) => b.show - a.show).slice(0, 50);
  }, [byProperty.data]);

  const totals = useMemo(() => dailyRows.reduce((total, row) => ({
    show: total.show + row.show,
    complete: total.complete + row.complete,
    failure: total.failure + row.failure,
    users: total.users + row.users,
  }), { show: 0, complete: 0, failure: 0, users: 0 }), [dailyRows]);
  const completionRate = totals.show ? Number(((totals.complete / totals.show) * 100).toFixed(2)) : 0;
  const failureRate = totals.show ? Number(((totals.failure / totals.show) * 100).toFixed(2)) : 0;
  const perUser = totals.users ? Number((totals.show / totals.users).toFixed(2)) : 0;
  const trendOption = useMemo(() => ({
    tooltip: { trigger: "axis" },
    legend: { bottom: 0 },
    grid: { left: 48, right: 24, top: 28, bottom: 48 },
    xAxis: { type: "category", data: dailyRows.map((row) => row.day.slice(5)) },
    yAxis: { type: "value" },
    series: [
      { name: "展示", type: "line", smooth: true, data: dailyRows.map((row) => row.show) },
      { name: "完成", type: "line", smooth: true, data: dailyRows.map((row) => row.complete) },
      { name: "失败", type: "line", smooth: true, data: dailyRows.map((row) => row.failure) },
    ],
  }), [dailyRows]);
  const rateOption = useMemo(() => ({
    tooltip: { trigger: "axis", valueFormatter: (value: number) => `${value.toFixed(2)}%` },
    legend: { bottom: 0 },
    grid: { left: 48, right: 24, top: 28, bottom: 48 },
    xAxis: { type: "category", data: dailyRows.map((row) => row.day.slice(5)) },
    yAxis: { type: "value", axisLabel: { formatter: "{value}%" } },
    series: [
      { name: "完成率", type: "line", smooth: true, data: dailyRows.map((row) => row.show ? Number(((row.complete / row.show) * 100).toFixed(2)) : 0) },
      { name: "失败率", type: "line", smooth: true, data: dailyRows.map((row) => row.show ? Number(((row.failure / row.show) * 100).toFixed(2)) : 0) },
    ],
  }), [dailyRows]);

  return <div>
    <AnalyticsHeader title="广告分析" description="基于 ad_show、ad_complete、ad_failure 事件，观察展示规模、完成质量和广告位表现。" />
    <ReportControls range={range} onRangeChange={setRange} comparison="上个周期" filters={["广告事件", "全部用户"]} />
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <MetricTile label="广告展示" value={totals.show} loading={daily.isFetching} />
      <MetricTile label="完成率" value={completionRate} hint="百分比" loading={daily.isFetching} />
      <MetricTile label="失败率" value={failureRate} hint="百分比" loading={daily.isFetching} />
      <MetricTile label="人均展示" value={perUser} hint="按当日去重用户累计" loading={daily.isFetching} />
      <MetricTile label="展示用户" value={totals.users} loading={daily.isFetching} />
    </div>
    {!projectId ? <EmptyAnalysis title="暂无项目" description="请选择项目后查看广告事件。" /> : <>
      <div className="grid gap-5 xl:grid-cols-2">
        <ChartPanel title="广告事件趋势" description="展示、完成、失败的按天次数"><ReactECharts option={trendOption} style={{ height: 340 }} /></ChartPanel>
        <ChartPanel title="广告质量趋势" description="完成率和失败率均以 ad_show 为分母"><ReactECharts option={rateOption} style={{ height: 340 }} /></ChartPanel>
      </div>
      <ToolbarPanel className="mt-5"><div className="grid gap-2 sm:max-w-xs"><span className="text-sm font-medium">分组维度</span><Select value={breakdown} onValueChange={(value) => setBreakdown(value as typeof breakdown)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{BREAKDOWNS.map((item) => <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>)}</SelectContent></Select></div></ToolbarPanel>
      <ChartPanel title="广告分组表现" description="完成率、失败率以该分组的广告展示次数为分母" className="mt-5" contentClassName="p-0 sm:p-0">
        {!breakdownRows.length ? <EmptyAnalysis className="min-h-48" title="暂无广告分组数据" description="当前时间范围内没有匹配的广告事件属性。" /> : <div className="overflow-x-auto"><Table className="min-w-[760px]"><TableHeader><TableRow><TableHead>{BREAKDOWNS.find((item) => item.key === breakdown)?.label}</TableHead><TableHead className="text-right">展示</TableHead><TableHead className="text-right">完成</TableHead><TableHead className="text-right">失败</TableHead><TableHead className="text-right">完成率</TableHead><TableHead className="text-right">失败率</TableHead><TableHead className="text-right">展示用户</TableHead></TableRow></TableHeader><TableBody>{breakdownRows.map((row) => <TableRow key={row.label}><TableCell className="font-medium">{row.label}</TableCell><TableCell className="text-right font-mono">{row.show.toLocaleString()}</TableCell><TableCell className="text-right font-mono">{row.complete.toLocaleString()}</TableCell><TableCell className="text-right font-mono">{row.failure.toLocaleString()}</TableCell><TableCell className="text-right font-mono">{row.show ? `${((row.complete / row.show) * 100).toFixed(2)}%` : "-"}</TableCell><TableCell className="text-right font-mono">{row.show ? `${((row.failure / row.show) * 100).toFixed(2)}%` : "-"}</TableCell><TableCell className="text-right font-mono">{row.users.toLocaleString()}</TableCell></TableRow>)}</TableBody></Table></div>}
      </ChartPanel>
    </>}
  </div>;
}
