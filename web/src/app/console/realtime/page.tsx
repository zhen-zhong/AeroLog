"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import dayjs, { Dayjs } from "dayjs";
import { Activity, Clock3, Radio } from "lucide-react";
import {
  AnalyticsHeader,
  ChartPanel,
  EmptyAnalysis,
  EventRankList,
  MetricTile,
  ReportControls,
  ToolbarPanel,
} from "@/features/analytics/analytics-ui";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";

export default function RealtimePage() {
  const [projectId, setProjectId] = useState<number | undefined>();
  const [range, setRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(30, "minute"),
    dayjs(),
  ]);

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects(),
  });

  useEffect(() => {
    if (!projectId && projects?.data?.length) setProjectId(projects.data[0].id);
  }, [projects, projectId]);

  const tsRange = useMemo(() => ({ from: range[0].valueOf(), to: range[1].valueOf() }), [range]);

  const { data: top, isFetching } = useQuery({
    queryKey: ["realtime_top", projectId, tsRange],
    queryFn: () => api.topEvents(projectId!, { ...tsRange, limit: 12 }),
    enabled: !!projectId,
    refetchInterval: 15_000,
  });

  const rows = top?.data || [];
  const totalEvents = rows.reduce((sum, item) => sum + item.count, 0);
  const activeUsers = rows.reduce((sum, item) => sum + item.users, 0);
  const primary = rows[0]?.event;

  return (
    <div>
      <AnalyticsHeader
        title="实时"
        description="用短时间窗口观察当前事件流、活跃用户和采集状态。默认每 15 秒刷新一次。"
        action={<Badge variant="success" className="h-9 items-center gap-2"><Radio className="h-3.5 w-3.5" /> Live</Badge>}
      />

      <ReportControls
        projects={projects?.data || []}
        projectId={projectId}
        onProjectChange={setProjectId}
        range={range}
        onRangeChange={setRange}
        comparison="上一窗口"
        filters={["近实时刷新", "全部平台"]}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <MetricTile label="实时事件量" value={totalEvents} hint="当前窗口内事件次数" loading={isFetching} />
        <MetricTile label="活跃用户信号" value={activeUsers} hint="按事件聚合用户信号" loading={isFetching} />
        <MetricTile label="活跃事件" value={rows.length} hint="当前窗口出现的事件名" loading={isFetching} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
        <ChartPanel title="实时事件排行" description="点击排行可作为后续分析入口">
          {rows.length ? (
            <EventRankList events={rows} active={primary} onSelect={() => undefined} loading={isFetching} />
          ) : (
            <EmptyAnalysis title="当前窗口暂无事件" description="等待 SDK 上报，或扩大时间范围查看。" />
          )}
        </ChartPanel>

        <ChartPanel title="实时事件流" description="按事件热度展示当前窗口内的流量构成">
          {rows.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>事件</TableHead>
                    <TableHead className="text-right">次数</TableHead>
                    <TableHead className="text-right">用户</TableHead>
                    <TableHead>热度</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((item) => {
                    const width = totalEvents ? Math.max(6, Math.round((item.count / totalEvents) * 100)) : 0;
                    return (
                      <TableRow key={item.event}>
                        <TableCell className="font-medium">{item.event}</TableCell>
                        <TableCell className="text-right font-mono">{item.count.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-mono">{item.users.toLocaleString()}</TableCell>
                        <TableCell>
                          <div className="h-2 overflow-hidden rounded-full bg-secondary">
                            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${width}%` }} />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <EmptyAnalysis title="暂无实时明细" />
          )}
        </ChartPanel>
      </div>

      <ToolbarPanel className="mt-5">
        <div className="flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <Clock3 className="h-4 w-4 text-primary" />
            当前窗口：{range[0].format("MM-DD HH:mm")} - {range[1].format("MM-DD HH:mm")}
          </span>
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <Activity className="h-4 w-4 text-primary" />
            数据来自 Collector → Kafka → ClickHouse 链路
          </span>
        </div>
      </ToolbarPanel>
    </div>
  );
}
