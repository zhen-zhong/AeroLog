"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import dayjs, { Dayjs } from "dayjs";
import { ArrowUpRight, BarChart3, UsersRound, Zap } from "lucide-react";
import {
  AnalyticsHeader,
  ChartPanel,
  EmptyAnalysis,
  EventRankList,
  MetricTile,
  ReportControls,
  ToolbarPanel,
} from "@/features/analytics/analytics-ui";
import { api } from "@/lib/api";
import { useProjectStore } from "@/stores/project-store";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

export default function ConsolePage() {
  const projectId = useProjectStore((s) => s.projectId);
  const [event, setEvent] = useState<string | undefined>();
  const [range, setRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(7, "day").startOf("day"),
    dayjs().endOf("day"),
  ]);

  // 切换项目时重置事件选择
  useEffect(() => {
    setEvent(undefined);
  }, [projectId]);

  const tsRange = useMemo(() => {
    return { from: range[0].valueOf(), to: range[1].valueOf() };
  }, [range]);

  const { data: top, isLoading: topLoading } = useQuery({
    queryKey: ["top_events", projectId, tsRange],
    queryFn: () => api.topEvents(projectId!, { ...tsRange, limit: 10 }),
    enabled: !!projectId,
  });

  useEffect(() => {
    if (!event && top?.data?.length) {
      setEvent(top.data[0].event);
    }
  }, [top, event]);

  const { data: trend, isLoading: trendLoading } = useQuery({
    queryKey: ["trend", projectId, event, tsRange],
    queryFn: () => api.trend(projectId!, event!, { ...tsRange, interval: "day" }),
    enabled: !!projectId && !!event,
  });

  const chartOption = useMemo(() => {
    const points = trend?.data || [];
    return {
      color: ["#0891b2"],
      tooltip: { trigger: "axis" },
      grid: { left: 42, right: 24, top: 28, bottom: 36 },
      xAxis: {
        type: "category",
        data: points.map((p) => p.bucket.slice(5, 10)),
        axisLine: { lineStyle: { color: "#cbd5e1" } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        splitLine: { lineStyle: { color: "#e2e8f0" } },
      },
      series: [
        {
          type: "line",
          smooth: true,
          symbolSize: 7,
          name: event,
          data: points.map((p) => p.count),
          areaStyle: { color: "rgba(8, 145, 178, 0.12)" },
          lineStyle: { width: 3 },
        },
      ],
    };
  }, [trend, event]);

  const topRows = top?.data || [];
  const totalEvents = topRows.reduce((sum, item) => sum + item.count, 0);
  const totalUsers = topRows.reduce((sum, item) => sum + item.users, 0);

  return (
    <div>
      <AnalyticsHeader
        title="概览"
        description="聚合最近 7 天的核心事件、活跃用户和趋势走势，用同一套事件流验证采集、消费、分析链路是否闭环。"
      />

      <ReportControls
        range={range}
        onRangeChange={setRange}
        comparison="上个周期"
        filters={["全部事件", "全部用户"]}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <MetricTile label="Top 事件量" value={totalEvents} hint="当前时间范围命中 Top 列表" loading={topLoading} />
        <MetricTile label="覆盖用户" value={totalUsers} hint="按事件去重用户聚合" loading={topLoading} />
        <MetricTile label="事件种类" value={topRows.length} hint="当前项目已上报事件" loading={topLoading} />
      </div>

      {!projectId ? (
        <EmptyAnalysis title="暂无项目" description="先在项目管理里创建项目，再通过 SDK 或 seed 脚本上报事件。" />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[420px_minmax(0,1fr)]">
          <ChartPanel
            title="Top 事件"
            description="点击事件切换右侧趋势图"
            contentClassName="pt-3 sm:pt-3"
          >
            <EventRankList events={topRows} active={event} onSelect={setEvent} loading={topLoading} />
          </ChartPanel>

          <ChartPanel
            title={`趋势：${event || "等待事件"}`}
            description="按天聚合最近 7 天的行为曲线"
          >
            {event ? (
              <div className="relative">
                {trendLoading ? <div className="absolute inset-x-0 top-0 h-px aero-scan-line" /> : null}
                <ReactECharts option={chartOption} style={{ height: 372 }} />
              </div>
            ) : (
              <EmptyAnalysis title="暂无趋势数据" description="左侧选择一个事件后，这里会出现趋势曲线。" />
            )}
          </ChartPanel>
        </div>
      )}

      <ToolbarPanel className="mt-5">
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <div className="flex items-center gap-3">
            <Zap className="h-4 w-4 text-primary" />
            <span className="text-muted-foreground">采集入口</span>
            <span className="font-medium">Collector</span>
          </div>
          <div className="flex items-center gap-3">
            <BarChart3 className="h-4 w-4 text-primary" />
            <span className="text-muted-foreground">分析存储</span>
            <span className="font-medium">ClickHouse</span>
          </div>
          <div className="flex items-center gap-3">
            <UsersRound className="h-4 w-4 text-primary" />
            <span className="text-muted-foreground">画像治理</span>
            <span className="inline-flex items-center gap-1 font-medium">
              Ready <ArrowUpRight className="h-3.5 w-3.5" />
            </span>
          </div>
        </div>
      </ToolbarPanel>
    </div>
  );
}
