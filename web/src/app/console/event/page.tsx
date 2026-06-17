"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import dayjs, { Dayjs } from "dayjs";
import {
  AnalyticsHeader,
  ChartPanel,
  DateTimeRange,
  EmptyAnalysis,
  EventPicker,
  MetricTile,
  ProjectPicker,
  ToolbarPanel,
} from "@/features/analytics/analytics-ui";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

export default function EventAnalysisPage() {
  const [projectId, setProjectId] = useState<number | undefined>();
  const [event, setEvent] = useState<string | undefined>();
  const [interval, setInterval] = useState<"hour" | "day">("day");
  const [range, setRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(7, "day").startOf("day"),
    dayjs().endOf("day"),
  ]);

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects(),
  });

  useEffect(() => {
    if (!projectId && projects?.data?.length) setProjectId(projects.data[0].id);
  }, [projects, projectId]);

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

      <ToolbarPanel>
        <div className="grid gap-4 xl:grid-cols-[220px_260px_minmax(360px,1fr)_auto] xl:items-end">
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">项目</span>
            <ProjectPicker
              projects={projects?.data || []}
              value={projectId}
              onChange={(next) => {
                setProjectId(next);
                setEvent(undefined);
              }}
              className="sm:w-full"
            />
          </div>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">事件</span>
            <EventPicker events={top?.data || []} value={event} onChange={setEvent} className="sm:w-full" />
          </div>
          <DateTimeRange value={range} onChange={setRange} />
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
    </div>
  );
}
