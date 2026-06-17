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
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function RealtimePage() {
  const [projectId, setProjectId] = useState<number | undefined>();
  const [selectedEvent, setSelectedEvent] = useState<string | undefined>();
  const [selectedProperty, setSelectedProperty] = useState<string | undefined>();
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
  const activeEvent = rows.find((item) => item.event === selectedEvent) || rows[0];

  useEffect(() => {
    if (!selectedEvent && rows.length) setSelectedEvent(rows[0].event);
  }, [rows, selectedEvent]);

  const eventProps = useQuery({
    queryKey: ["realtime_event_properties", projectId],
    queryFn: () => api.listProperties(projectId!, { scope: "event" }),
    enabled: !!projectId,
  });

  const propertyRows = eventProps.data?.data || [];

  const propertyValues = useQuery({
    queryKey: ["realtime_property_values", projectId, activeEvent?.event, selectedProperty, tsRange],
    queryFn: () =>
      api.propertyValues(projectId!, {
        property: selectedProperty!,
        event: activeEvent!.event,
        ...tsRange,
        limit: 8,
      }),
    enabled: !!projectId && !!activeEvent?.event && !!selectedProperty,
    refetchInterval: 15_000,
  });

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
        onProjectChange={(next) => {
          setProjectId(next);
          setSelectedEvent(undefined);
          setSelectedProperty(undefined);
        }}
        range={range}
        onRangeChange={setRange}
        comparison="上一窗口"
        filters={activeEvent?.event ? ["近实时刷新", `event = ${activeEvent.event}`] : ["近实时刷新", "全部平台"]}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <MetricTile label="实时事件量" value={totalEvents} hint="当前窗口内事件次数" loading={isFetching} />
        <MetricTile label="活跃用户信号" value={activeUsers} hint="按事件聚合用户信号" loading={isFetching} />
        <MetricTile label="活跃事件" value={rows.length} hint="当前窗口出现的事件名" loading={isFetching} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
        <ChartPanel title="实时事件排行" description="点击排行可作为后续分析入口" contentClassName="pt-3 sm:pt-3">
          {rows.length ? (
            <EventRankList
              events={rows}
              active={activeEvent?.event}
              onSelect={(next) => {
                setSelectedEvent(next);
                setSelectedProperty(undefined);
              }}
              loading={isFetching}
            />
          ) : (
            <EmptyAnalysis title="当前窗口暂无事件" description="等待 SDK 上报，或扩大时间范围查看。" />
          )}
        </ChartPanel>

        <ChartPanel
          title={activeEvent?.event ? `实时事件：${activeEvent.event}` : "实时事件详情"}
          description="展示选中事件的次数、用户、热度和多个自定义参数"
          contentClassName="pt-3 sm:pt-3"
        >
          {activeEvent ? (
            <div className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-md border bg-background p-3">
                  <div className="text-xs text-muted-foreground">次数</div>
                  <div className="mt-1 font-mono text-xl font-semibold">{activeEvent.count.toLocaleString()}</div>
                </div>
                <div className="rounded-md border bg-background p-3">
                  <div className="text-xs text-muted-foreground">用户</div>
                  <div className="mt-1 font-mono text-xl font-semibold">{activeEvent.users.toLocaleString()}</div>
                </div>
                <div className="rounded-md border bg-background p-3">
                  <div className="text-xs text-muted-foreground">热度</div>
                  <div className="mt-1 font-mono text-xl font-semibold">
                    {totalEvents ? ((activeEvent.count / totalEvents) * 100).toFixed(1) : "0.0"}%
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="text-sm font-medium">事件参数</div>
                  <Badge variant="secondary">{propertyRows.length} keys</Badge>
                </div>
                <div className="grid gap-2">
                  {propertyRows.slice(0, 12).map((prop) => {
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
                                当前窗口下没有这个参数。
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  {!eventProps.isLoading && !propertyRows.length ? (
                    <EmptyAnalysis title="暂无参数字典" description="上报带自定义参数的事件后会自动发现。" />
                  ) : null}
                </div>
              </div>
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
