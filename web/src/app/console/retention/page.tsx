"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import dayjs, { Dayjs } from "dayjs";
import {
  AnalyticsHeader,
  ChartPanel,
  EmptyAnalysis,
  EventPicker,
  MetricTile,
  NumberField,
  ReportControls,
  ToolbarPanel,
} from "@/features/analytics/analytics-ui";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, RetentionBreakdownGroup, RetentionCohort } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useProjectStore } from "@/stores/project-store";

const NONE = "__none__";

export default function RetentionPage() {
  const projectId = useProjectStore((s) => s.projectId);
  const [initEvent, setInitEvent] = useState<string | undefined>();
  const [retEvent, setRetEvent] = useState<string | undefined>();
  const [days, setDays] = useState<number>(7);
  const [breakdownProperty, setBreakdownProperty] = useState<string>("");
  const [range, setRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(14, "day").startOf("day"),
    dayjs().endOf("day"),
  ]);

  // 切换项目时重置
  useEffect(() => {
    setInitEvent(undefined);
    setRetEvent(undefined);
    setBreakdownProperty("");
  }, [projectId]);

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

  const { data: properties } = useQuery({
    queryKey: ["retention_properties", projectId],
    queryFn: () => api.listProperties(projectId!, { scope: "event" }),
    enabled: !!projectId,
  });

  useEffect(() => {
    if (!initEvent && top?.data?.length) setInitEvent(top.data[0].event);
    if (!retEvent && top?.data?.length) setRetEvent(top.data[0].event);
  }, [top, initEvent, retEvent]);

  const { data, isFetching } = useQuery({
    queryKey: ["retention", projectId, initEvent, retEvent, days, range, breakdownProperty],
    queryFn: () =>
      api.retention(projectId!, {
        initial_event: initEvent!,
        return_event: retEvent!,
        days,
        from: range[0].valueOf(),
        to: range[1].valueOf(),
        breakdown_property: breakdownProperty || undefined,
      }),
    enabled: !!projectId && !!initEvent && !!retEvent,
  });

  const overall: RetentionCohort[] = data?.data?.overall || [];
  const breakdown: RetentionBreakdownGroup[] = data?.data?.breakdown || [];
  const totalCohort = overall.reduce((sum, row) => sum + row.size, 0);
  const dayOneAvg = useMemo(() => {
    if (!overall.length) return 0;
    const retained = overall.reduce((sum, row) => sum + (row.values[1] || 0), 0);
    return totalCohort ? Math.round((retained / totalCohort) * 10000) / 100 : 0;
  }, [overall, totalCohort]);

  return (
    <div>
      <AnalyticsHeader
        title="留存分析"
        description="按同期日观察用户回访，快速判断事件链路是否具备持续价值。热力颜色越深，代表该日留存率越高。"
      />

      <ReportControls
        range={range}
        onRangeChange={setRange}
        comparison="上个周期"
        filters={[
          initEvent ? `initial = ${initEvent}` : "选择初始事件",
          retEvent ? `return = ${retEvent}` : "选择返回事件",
          breakdownProperty ? `分组 = ${breakdownProperty}` : "未分组",
        ]}
      />

      <ToolbarPanel>
        <div className="grid gap-4 xl:grid-cols-[240px_240px_160px_240px] xl:items-end">
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">初始事件</span>
            <EventPicker events={top?.data || []} value={initEvent} onChange={setInitEvent} placeholder="初始事件" className="sm:w-full" />
          </div>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">返回事件</span>
            <EventPicker events={top?.data || []} value={retEvent} onChange={setRetEvent} placeholder="返回事件" className="sm:w-full" />
          </div>
          <NumberField label="观察天数" min={2} max={30} value={days} onChange={setDays} />
          <div className="grid gap-1.5">
            <Label>分组参数（可选）</Label>
            <Select
              value={breakdownProperty || NONE}
              onValueChange={(v) => setBreakdownProperty(v === NONE ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="不分组" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>不分组</SelectItem>
                {(properties?.data || []).map((p) => (
                  <SelectItem key={p.name} value={p.name}>
                    {p.display_name || p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </ToolbarPanel>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <MetricTile label="同期用户" value={totalCohort} loading={isFetching || topLoading} />
        <MetricTile label="同期批次" value={overall.length} loading={isFetching} />
        <MetricTile label="Day1 平均留存" value={dayOneAvg} hint="百分比" loading={isFetching} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <ChartPanel title="Cohort 总览" description="每个同期日的用户规模和 Day1 留存" contentClassName="pt-3 sm:pt-3">
          {overall.length ? <CohortOverview rows={overall} /> : <EmptyAnalysis title="暂无同期批次" />}
        </ChartPanel>
        <ChartPanel title="留存热力矩阵" description="每行是一个同期日，每列是 DayN 回访比例">
          {!initEvent || !retEvent ? (
            <EmptyAnalysis title="请选择事件" description="选择初始事件和返回事件后，留存矩阵会自动计算。" />
          ) : isFetching ? (
            <div className="grid gap-2">
              {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : overall.length === 0 ? (
            <EmptyAnalysis title="暂无留存数据" description="当前时间范围内没有满足条件的同期用户。" />
          ) : (
            <RetentionHeatmap rows={overall} days={days} />
          )}
        </ChartPanel>
      </div>

      {breakdownProperty && breakdown.length > 0 ? (
        <div className="mt-5">
          <ChartPanel
            title={`按 ${breakdownProperty} 分组对比`}
            description="按维度取值聚合各同期日的总规模与 Day1 留存，颜色越深代表 DayN 平均留存越高。"
          >
            <BreakdownTable groups={breakdown} days={days} dimension={breakdownProperty} />
          </ChartPanel>
        </div>
      ) : null}
    </div>
  );
}

function CohortOverview({ rows }: { rows: RetentionCohort[] }) {
  const maxSize = rows.reduce((max, row) => Math.max(max, row.size), 0);
  return (
    <div className="grid gap-3">
      {rows.map((row) => {
        const dayOne = row.values[1] || 0;
        const rate = row.size ? (dayOne / row.size) * 100 : 0;
        const width = maxSize ? Math.max(6, (row.size / maxSize) * 100) : 0;
        return (
          <div key={row.cohort} className="rounded-md border bg-background p-3">
            <div className="mb-2 flex items-center justify-between gap-3 text-sm">
              <span className="font-medium">{dayjs(row.cohort).format("MM-DD")}</span>
              <span className="font-mono text-muted-foreground">{row.size.toLocaleString()} 用户</span>
            </div>
            <div className="mb-2 h-2 overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
            </div>
            <div className="text-xs text-muted-foreground">Day1 留存 {rate.toFixed(1)}%</div>
          </div>
        );
      })}
    </div>
  );
}

function RetentionHeatmap({ rows, days }: { rows: RetentionCohort[]; days: number }) {
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

function BreakdownTable({
  groups,
  days,
  dimension,
}: {
  groups: RetentionBreakdownGroup[];
  days: number;
  dimension: string;
}) {
  // 计算每组的 DayN 平均留存（对各 cohort 加权按 size）
  const enriched = groups.map((g) => {
    const avg: number[] = [];
    for (let i = 0; i < days; i++) {
      let retained = 0;
      let total = 0;
      g.rows.forEach((row) => {
        retained += row.values[i] || 0;
        total += row.size;
      });
      avg.push(total ? (retained / total) * 100 : 0);
    }
    return { ...g, avg };
  });
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[820px]">
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[160px]">{dimension}</TableHead>
            <TableHead className="text-right">总同期用户</TableHead>
            <TableHead className="text-right">Day1 留存</TableHead>
            {Array.from({ length: days }).map((_, index) => (
              <TableHead key={index} className="text-center">
                Day{index}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {enriched.map((g) => (
            <TableRow key={g.raw}>
              <TableCell className="font-medium">{g.label || "(空)"}</TableCell>
              <TableCell className="text-right font-mono">{g.total_size.toLocaleString()}</TableCell>
              <TableCell className="text-right font-mono">{(g.day_one * 100).toFixed(2)}%</TableCell>
              {g.avg.map((rate, index) => {
                const alpha = Math.min(0.88, 0.1 + rate / 100);
                return (
                  <TableCell key={index} className="p-1.5 text-center">
                    <div
                      className={cn(
                        "rounded-md px-2 py-2 font-mono text-xs tabular-nums",
                        rate > 45 ? "text-white" : "text-foreground",
                      )}
                      style={{ backgroundColor: `rgba(8, 145, 178, ${alpha})` }}
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
