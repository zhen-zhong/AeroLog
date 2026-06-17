"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import dayjs, { Dayjs } from "dayjs";
import {
  AnalyticsHeader,
  ChartPanel,
  EmptyAnalysis,
  EventPicker,
  MetricTile,
  ReportControls,
  ToolbarPanel,
} from "@/features/analytics/analytics-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useProjectStore } from "@/stores/project-store";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

export default function EventAnalysisPage() {
  const projectId = useProjectStore((s) => s.projectId);
  const [event, setEvent] = useState<string | undefined>();
  const [selectedProperty, setSelectedProperty] = useState<string | undefined>();
  const [interval, setInterval] = useState<"hour" | "day">("day");
  const [range, setRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(7, "day").startOf("day"),
    dayjs().endOf("day"),
  ]);

  // 切换项目时重置
  useEffect(() => {
    setEvent(undefined);
    setSelectedProperty(undefined);
  }, [projectId]);

  const tsRange = useMemo(
    () => ({ from: range[0].valueOf(), to: range[1].valueOf() }),
    [range],
  );

  const { data: top, isLoading: topLoading } = useQuery({
    queryKey: ["top_for_event", projectId, tsRange],
    queryFn: () => api.topEvents(projectId!, { ...tsRange, limit: 50 }),
    enabled: !!projectId,
  });

  useEffect(() => {
    if (!event && top?.data?.length) setEvent(top.data[0].event);
  }, [top, event]);

  const { data: trend, isFetching } = useQuery({
    queryKey: ["event_trend", projectId, event, tsRange, interval],
    queryFn: () => api.trend(projectId!, event!, { ...tsRange, interval }),
    enabled: !!projectId && !!event,
  });

  const eventProps = useQuery({
    queryKey: ["event_properties_for_analysis", projectId],
    queryFn: () => api.listProperties(projectId!, { scope: "event" }),
    enabled: !!projectId,
  });

  const propertyRows = eventProps.data?.data || [];

  const propertyValues = useQuery({
    queryKey: ["event_property_values", projectId, event, selectedProperty, tsRange],
    queryFn: () =>
      api.propertyValues(projectId!, {
        property: selectedProperty!,
        event,
        ...tsRange,
        limit: 12,
      }),
    enabled: !!projectId && !!selectedProperty,
  });

  const option = useMemo(() => {
    const points = trend?.data || [];
    return {
      color: ["#0f766e"],
      tooltip: { trigger: "axis" },
      grid: { left: 48, right: 24, top: 28, bottom: 42 },
      xAxis: {
        type: "category",
        data: points.map((p) => (interval === "hour" ? p.bucket.slice(5, 16).replace("T", " ") : p.bucket.slice(5, 10))),
        axisLine: { lineStyle: { color: "#cbd5e1" } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        splitLine: { lineStyle: { color: "#e2e8f0" } },
      },
      series: [
        {
          type: "bar",
          name: event,
          data: points.map((p) => p.count),
          barMaxWidth: 34,
          itemStyle: { borderRadius: [5, 5, 0, 0] },
        },
      ],
    };
  }, [trend, event, interval]);

  const points = trend?.data || [];
  const total = points.reduce((sum, item) => sum + item.count, 0);
  const peak = points.reduce((max, item) => Math.max(max, item.count), 0);

  return (
    <div>
      <AnalyticsHeader
        title="事件分析"
        description="围绕单个事件查看时间趋势，适合验证核心埋点是否稳定、活动峰值是否符合预期。"
      />

      <ReportControls
        range={range}
        onRangeChange={setRange}
        comparison="上个周期"
        filters={event ? [`event = ${event}`] : ["全部事件"]}
      />

      <ToolbarPanel>
        <div className="grid gap-4 md:grid-cols-[minmax(240px,320px)_220px] md:items-end">
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">事件</span>
            <EventPicker events={top?.data || []} value={event} onChange={setEvent} className="sm:w-full" />
          </div>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">粒度</span>
            <div className="grid grid-cols-2 rounded-md border bg-background p-1">
              {(["hour", "day"] as const).map((item) => (
                <Button
                  key={item}
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setInterval(item)}
                  className={cn(interval === item && "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground")}
                >
                  {item === "hour" ? "小时" : "天"}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </ToolbarPanel>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <MetricTile label="区间事件量" value={total} loading={isFetching || topLoading} />
        <MetricTile label="峰值桶" value={peak} hint={interval === "hour" ? "单小时峰值" : "单日峰值"} loading={isFetching} />
        <MetricTile label="事件候选" value={top?.data.length || 0} hint="可用于分析的事件" loading={topLoading} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <ChartPanel title={`事件趋势：${event || "未选择"}`} description="柱状图显示所选时间范围内的聚合次数">
          {event ? (
            <div className="relative">
              {isFetching ? <div className="absolute inset-x-0 top-0 h-px aero-scan-line" /> : null}
              <ReactECharts option={option} style={{ height: 430 }} />
            </div>
          ) : (
            <EmptyAnalysis title="请选择事件" description="选择项目和事件后，趋势图会自动刷新。" />
          )}
        </ChartPanel>

        <ChartPanel title="事件参数" description="点击参数 key 查看当前事件下的 value 分布" contentClassName="pt-3 sm:pt-3">
          <div className="grid gap-2">
            <div className="grid gap-2">
              {propertyRows.slice(0, 10).map((prop) => {
                const active = selectedProperty === prop.name;
                return (
                  <div
                    key={prop.id}
                    className={cn(
                      "overflow-hidden rounded-md border bg-background transition-colors",
                      active && "border-primary/50 bg-accent/45",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedProperty((current) => (current === prop.name ? undefined : prop.name))}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-accent/60"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{prop.name}</span>
                        <span className="text-xs text-muted-foreground">{formatDateTime(prop.last_seen)}</span>
                      </span>
                      <Badge variant={prop.data_type === "mixed" ? "danger" : "info"}>{prop.data_type}</Badge>
                    </button>

                    {active ? (
                      <div className="border-t bg-card px-3 py-3">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <span className="truncate text-xs font-medium text-muted-foreground">
                            {event ? `事件 ${event}` : "全部事件"} · Top values
                          </span>
                          <Badge variant="secondary">{propertyValues.data?.data.length || 0} values</Badge>
                        </div>
                        {propertyValues.isFetching ? (
                          <div className="grid gap-2">
                            {Array.from({ length: 4 }).map((_, index) => (
                              <div key={index} className="h-9 animate-pulse rounded-md bg-secondary" />
                            ))}
                          </div>
                        ) : propertyValues.data?.data.length ? (
                          <div className="grid gap-2">
                            {propertyValues.data.data.map((item) => (
                              <div key={item.raw} className="grid gap-1.5">
                                <div className="flex items-center justify-between gap-3 text-xs">
                                  <span className="min-w-0 truncate font-medium">{item.label}</span>
                                  <span className="shrink-0 font-mono text-muted-foreground">
                                    {item.count.toLocaleString()} 次 · {item.users.toLocaleString()} 用户
                                  </span>
                                </div>
                                <div className="h-2 overflow-hidden rounded-full bg-secondary">
                                  <div
                                    className="h-full rounded-full bg-primary"
                                    style={{ width: `${Math.max(4, item.share * 100)}%` }}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="rounded-md border border-dashed bg-secondary/30 px-3 py-4 text-center text-xs text-muted-foreground">
                            当前时间范围或事件下没有这个参数。
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {!eventProps.isLoading && !propertyRows.length ? (
              <EmptyAnalysis title="暂无参数字典" description="上报带自定义参数的事件后会自动发现。" />
            ) : null}
          </div>
        </ChartPanel>
      </div>

      <ChartPanel title="事件表" description="按当前时间范围统计 Top 事件，点击事件名可切换趋势图" className="mt-5">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>事件</TableHead>
                <TableHead className="text-right">次数</TableHead>
                <TableHead className="text-right">用户</TableHead>
                <TableHead>占比</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(top?.data || []).map((item) => {
                const share = top?.data?.length ? item.count / Math.max(1, (top.data || []).reduce((sum, row) => sum + row.count, 0)) : 0;
                return (
                  <TableRow key={item.event} className="cursor-pointer" onClick={() => setEvent(item.event)}>
                    <TableCell className="font-medium">{item.event}</TableCell>
                    <TableCell className="text-right font-mono">{item.count.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono">{item.users.toLocaleString()}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-32 overflow-hidden rounded-full bg-secondary">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, share * 100)}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground">{(share * 100).toFixed(1)}%</span>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </ChartPanel>
    </div>
  );
}
