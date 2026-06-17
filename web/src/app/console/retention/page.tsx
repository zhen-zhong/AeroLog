"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import dayjs, { Dayjs } from "dayjs";
import {
  AnalyticsHeader,
  ChartPanel,
  DateTimeRange,
  EmptyAnalysis,
  EventPicker,
  MetricTile,
  NumberField,
  ProjectPicker,
  ToolbarPanel,
} from "@/features/analytics/analytics-ui";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface RetRow {
  cohort: string;
  size: number;
  values: number[];
}

export default function RetentionPage() {
  const [projectId, setProjectId] = useState<number | undefined>();
  const [initEvent, setInitEvent] = useState<string | undefined>();
  const [retEvent, setRetEvent] = useState<string | undefined>();
  const [days, setDays] = useState<number>(7);
  const [range, setRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(14, "day").startOf("day"),
    dayjs().endOf("day"),
  ]);

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects(),
  });

  useEffect(() => {
    if (!projectId && projects?.data?.length) setProjectId(projects.data[0].id);
  }, [projects, projectId]);

  const { data: top, isLoading: topLoading } = useQuery({
    queryKey: ["retention_top", projectId],
    queryFn: () =>
      api.topEvents(projectId!, {
        from: dayjs().subtract(30, "day").valueOf(),
        to: Date.now(),
        limit: 100,
      }),
    enabled: !!projectId,
  });

  useEffect(() => {
    if (!initEvent && top?.data?.length) setInitEvent(top.data[0].event);
    if (!retEvent && top?.data?.length) setRetEvent(top.data[0].event);
  }, [top, initEvent, retEvent]);

  const { data, isFetching } = useQuery({
    queryKey: ["retention", projectId, initEvent, retEvent, days, range],
    queryFn: () =>
      api.retention(projectId!, {
        initial_event: initEvent!,
        return_event: retEvent!,
        days,
        from: range[0].valueOf(),
        to: range[1].valueOf(),
      }),
    enabled: !!projectId && !!initEvent && !!retEvent,
  });

  const rows = data?.data || [];
  const totalCohort = rows.reduce((sum, row) => sum + row.size, 0);
  const dayOneAvg = useMemo(() => {
    if (!rows.length) return 0;
    const retained = rows.reduce((sum, row) => sum + (row.values[1] || 0), 0);
    return totalCohort ? Math.round((retained / totalCohort) * 10000) / 100 : 0;
  }, [rows, totalCohort]);

  return (
    <div>
      <AnalyticsHeader
        title="留存分析"
        description="按同期日观察用户回访，快速判断事件链路是否具备持续价值。热力颜色越深，代表该日留存率越高。"
      />

      <ToolbarPanel>
        <div className="grid gap-4 xl:grid-cols-[220px_240px_240px_160px_minmax(360px,1fr)] xl:items-end">
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">项目</span>
            <ProjectPicker projects={projects?.data || []} value={projectId} onChange={setProjectId} className="sm:w-full" />
          </div>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">初始事件</span>
            <EventPicker events={top?.data || []} value={initEvent} onChange={setInitEvent} placeholder="初始事件" className="sm:w-full" />
          </div>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">返回事件</span>
            <EventPicker events={top?.data || []} value={retEvent} onChange={setRetEvent} placeholder="返回事件" className="sm:w-full" />
          </div>
          <NumberField label="观察天数" min={2} max={30} value={days} onChange={setDays} />
          <DateTimeRange value={range} onChange={setRange} />
        </div>
      </ToolbarPanel>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <MetricTile label="同期用户" value={totalCohort} loading={isFetching || topLoading} />
        <MetricTile label="同期批次" value={rows.length} loading={isFetching} />
        <MetricTile label="Day1 平均留存" value={dayOneAvg} hint="百分比" loading={isFetching} />
      </div>

      <ChartPanel title="留存热力矩阵" description="每行是一个同期日，每列是 DayN 回访比例">
        {!initEvent || !retEvent ? (
          <EmptyAnalysis title="请选择事件" description="选择初始事件和返回事件后，留存矩阵会自动计算。" />
        ) : isFetching ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyAnalysis title="暂无留存数据" description="当前时间范围内没有满足条件的同期用户。" />
        ) : (
          <RetentionHeatmap rows={rows} days={days} />
        )}
      </ChartPanel>
    </div>
  );
}

function RetentionHeatmap({ rows, days }: { rows: RetRow[]; days: number }) {
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[920px]">
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 z-10 w-36 bg-card">同期日</TableHead>
            <TableHead className="w-24">用户数</TableHead>
            {Array.from({ length: days }).map((_, index) => (
              <TableHead key={index} className="w-24 text-center">
                Day{index}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.cohort}>
              <TableCell className="sticky left-0 z-10 bg-card font-medium">
                {dayjs(row.cohort).format("MM-DD")}
              </TableCell>
              <TableCell className="font-mono text-muted-foreground">{row.size.toLocaleString()}</TableCell>
              {Array.from({ length: days }).map((_, index) => {
                const value = row.values[index] || 0;
                const rate = row.size ? (value / row.size) * 100 : 0;
                const alpha = Math.min(0.88, 0.1 + rate / 100);
                return (
                  <TableCell key={index} className="p-1.5 text-center">
                    <div
                      className={cn(
                        "aero-flow rounded-md px-2 py-2 font-mono text-xs tabular-nums",
                        rate > 45 ? "text-white" : "text-foreground",
                      )}
                      style={{ backgroundColor: `rgba(8, 145, 178, ${alpha})` }}
                      title={`${value} 人`}
                    >
                      {rate.toFixed(1)}%
                    </div>
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
