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
import { api, QueryTableRow } from "@/lib/api";
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

  const { data: core, isLoading: coreLoading } = useQuery({
    queryKey: ["overview_core_metrics", projectId, tsRange],
    queryFn: async () => {
      const query = (eventName: string, options?: { firstDay?: boolean; sumProperty?: string }) =>
        api.queryTable(projectId!, {
          events: [eventName],
          ...tsRange,
          dimensions: [{ type: "event", key: "event" }],
          filters: options?.firstDay ? [{ property: "$is_first_day", op: "eq", value: true }] : [],
          sum_properties: options?.sumProperty ? [options.sumProperty] : [],
        });
      const [newUsers, adShows, adCompletes, coins] = await Promise.all([
        query("$AppStart", { firstDay: true }),
        query("ad_show"),
        query("ad_complete"),
        query("coin_earned", { sumProperty: "coin_amount" }),
      ]);
      const total = (rows: QueryTableRow[], key: "count" | "users") => rows.reduce((sum, row) => sum + row[key], 0);
      return {
        newUsers: total(newUsers.data.rows, "users"),
        adShows: total(adShows.data.rows, "count"),
        adUsers: total(adShows.data.rows, "users"),
        adCompletes: total(adCompletes.data.rows, "count"),
        coins: coins.data.rows.reduce((sum, row) => sum + (row.sums.coin_amount || 0), 0),
      };
    },
    enabled: !!projectId,
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
  const adPerUser = core?.adUsers ? Number((core.adShows / core.adUsers).toFixed(2)) : 0;
  const adCompletionRate = core?.adShows ? Number(((core.adCompletes / core.adShows) * 100).toFixed(2)) : 0;

  return (
    <div>
      <AnalyticsHeader
        title="概览"
        description="核心经营指标与事件趋势。所有指标均基于当前项目已入库事件。"
      />

      <ReportControls
        range={range}
        onRangeChange={setRange}
        comparison="上个周期"
        filters={["全部事件", "全部用户"]}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricTile label="新增用户" value={core?.newUsers || 0} hint="$AppStart 且首次启动" loading={coreLoading} />
        <MetricTile label="广告展示" value={core?.adShows || 0} hint="ad_show" loading={coreLoading} />
        <MetricTile label="人均广告展示" value={adPerUser} hint="展示次数 / 展示用户" loading={coreLoading} />
        <MetricTile label="广告完成率" value={adCompletionRate} hint="ad_complete / ad_show（%）" loading={coreLoading} />
        <MetricTile label="金币收入" value={core?.coins || 0} hint="coin_earned.coin_amount" loading={coreLoading} />
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
            <span className="text-muted-foreground">Top 事件量</span>
            <span className="font-medium tabular-nums">{totalEvents.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-3">
            <BarChart3 className="h-4 w-4 text-primary" />
            <span className="text-muted-foreground">Top 事件覆盖用户</span>
            <span className="font-medium tabular-nums">{totalUsers.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-3">
            <UsersRound className="h-4 w-4 text-primary" />
            <span className="text-muted-foreground">事件种类</span>
            <span className="inline-flex items-center gap-1 font-medium tabular-nums">{topRows.length}<ArrowUpRight className="h-3.5 w-3.5" /></span>
          </div>
        </div>
      </ToolbarPanel>
    </div>
  );
}
