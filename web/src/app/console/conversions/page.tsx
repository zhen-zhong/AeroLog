"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs, { Dayjs } from "dayjs";
import { BadgeCheck, BookmarkPlus, Download, Flag, History, LineChart, Play, RotateCcw, Trash2 } from "lucide-react";
import {
  AnalyticsHeader,
  ChartPanel,
  DateTimeRange,
  EmptyAnalysis,
  EventStepSelector,
  MetricTile,
  NumberField,
} from "@/features/analytics/analytics-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, ConversionGoal, ConversionGoalVersion } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useProjectStore } from "@/stores/project-store";

const DEFAULT_EVENTS = ["search", "view_product", "pay_success"];

export default function ConversionsPage() {
  const queryClient = useQueryClient();
  const projectId = useProjectStore((s) => s.projectId);
  const [range, setRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(7, "day").startOf("day"),
    dayjs().endOf("day"),
  ]);
  const [name, setName] = useState("购买转化");
  const [events, setEvents] = useState<string[]>([]);
  const [windowSeconds, setWindowSeconds] = useState(7 * 24 * 3600);
  const [breakdownProperty, setBreakdownProperty] = useState("");
  const [versionNote, setVersionNote] = useState("");
  const [versionGoalId, setVersionGoalId] = useState<number | null>(null);
  const [trendData, setTrendData] = useState<{
    current: { bucket: string; conversion: number; first: number; last: number }[];
    compare: { bucket: string; conversion: number; first: number; last: number }[];
  } | null>(null);

  // 切换项目时重置
  useEffect(() => {
    setEvents([]);
    setBreakdownProperty("");
  }, [projectId]);

  const tsRange = useMemo(() => ({ from: range[0].valueOf(), to: range[1].valueOf() }), [range]);

  const top = useQuery({
    queryKey: ["conversion_top", projectId, tsRange],
    queryFn: () => api.topEvents(projectId!, { ...tsRange, limit: 100 }),
    enabled: !!projectId,
  });

  const props = useQuery({
    queryKey: ["conversion_properties", projectId],
    queryFn: () => api.listProperties(projectId!, { scope: "event" }),
    enabled: !!projectId,
  });

  const goals = useQuery({
    queryKey: ["conversion_goals", projectId],
    queryFn: () => api.listConversionGoals(projectId!),
    enabled: !!projectId,
    placeholderData: (previousData) => previousData,
  });

  const eventRows = top.data?.data || [];
  const propertyRows = props.data?.data || [];

  useEffect(() => {
    if (!events.length && eventRows.length) {
      const defaults = DEFAULT_EVENTS.filter((event) => eventRows.some((item) => item.event === event));
      if (defaults.length >= 2) setEvents(defaults);
      else setEvents(eventRows.slice(0, 3).map((item) => item.event));
    }
  }, [eventRows, events.length]);

  const analyze = useMutation({
    mutationFn: () =>
      api.conversion(projectId!, {
        events,
        ...tsRange,
        window_seconds: windowSeconds,
        breakdown_property: breakdownProperty || undefined,
      }),
  });

  const saveGoal = useMutation({
    mutationFn: () =>
      api.createConversionGoal(projectId!, {
        name,
        events,
        window_seconds: windowSeconds,
        breakdown_property: breakdownProperty || undefined,
        note: versionNote || undefined,
      }),
    onSuccess: () => {
      setVersionNote("");
      void queryClient.invalidateQueries({ queryKey: ["conversion_goals", projectId] });
    },
  });

  const trend = useMutation({
    mutationFn: () => {
      const span = tsRange.to - tsRange.from;
      return api.conversionTrend(projectId!, {
        events,
        ...tsRange,
        window_seconds: windowSeconds,
        compare_from: tsRange.from - span,
        compare_to: tsRange.from,
        interval: "day",
      });
    },
    onSuccess: (resp) => {
      setTrendData({
        current: resp.data.current || [],
        compare: resp.data.compare || [],
      });
    },
  });

  const exportCsv = useMutation({
    mutationFn: () =>
      api.conversionExport(projectId!, {
        events,
        ...tsRange,
        window_seconds: windowSeconds,
        breakdown_property: breakdownProperty || undefined,
      }),
  });

  const versions = useQuery({
    queryKey: ["conversion_goal_versions", projectId, versionGoalId],
    queryFn: () => api.listConversionGoalVersions(projectId!, versionGoalId!),
    enabled: !!projectId && !!versionGoalId,
  });

  const deleteGoal = useMutation({
    mutationFn: (goalId: number) => api.deleteConversionGoal(projectId!, goalId),
    onSuccess: (_data, goalId) => {
      const deleted = (goals.data?.data || []).find((goal) => goal.id === goalId);
      if (deleted?.name === name) {
        setName("购买转化");
        setEvents([]);
        setBreakdownProperty("");
        setWindowSeconds(7 * 24 * 3600);
        analyze.reset();
      }
      void queryClient.invalidateQueries({ queryKey: ["conversion_goals", projectId] });
    },
  });

  const steps = analyze.data?.data.steps || [];
  const breakdown = analyze.data?.data.breakdown || [];
  const firstUsers = steps[0]?.users || 0;
  const lastUsers = steps[steps.length - 1]?.users || 0;
  const finalRate = firstUsers ? Math.round((lastUsers / firstUsers) * 10000) / 100 : 0;
  const avgDropoff = steps.length > 1
    ? Math.round((steps.slice(1).reduce((sum, step) => sum + step.dropoff, 0) / (steps.length - 1)) * 10000) / 100
    : 0;
  const breakdownTableMinWidth = Math.max(820, events.length * 180 + 360);

  function loadGoal(goal: ConversionGoal) {
    setName(goal.name);
    setEvents(goal.events);
    setWindowSeconds(goal.window_seconds);
    setBreakdownProperty(goal.breakdown_property || "");
    analyze.reset();
  }

  return (
    <div>
      <AnalyticsHeader
        title="转化"
        description="保存核心业务转化目标，自定义路径步骤，并按参数拆解不同渠道、城市、套餐等维度下的转化表现。"
        action={<Badge variant="info" className="h-9 items-center gap-2"><Flag className="h-3.5 w-3.5" /> Conversion goals</Badge>}
      />

      <div className="grid gap-5 xl:grid-cols-[430px_minmax(0,1fr)]">
        <div className="min-w-0 grid gap-5">
          <Card>
            <CardContent className="grid gap-4 pt-4 sm:pt-4">
              <DateTimeRange value={range} onChange={setRange} stacked />
              <div className="grid gap-1.5">
                <div className="text-sm font-medium">转化目标名称</div>
                <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：购买转化" />
              </div>
              <NumberField
                label="转化窗口（秒）"
                min={60}
                max={30 * 24 * 3600}
                step={3600}
                value={windowSeconds}
                onChange={setWindowSeconds}
              />
              <div className="grid gap-1.5">
                <div className="text-sm font-medium">拆解参数</div>
                <Select value={breakdownProperty || "__none__"} onValueChange={(value) => setBreakdownProperty(value === "__none__" ? "" : value)}>
                  <SelectTrigger><SelectValue placeholder="选择拆解参数" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">不拆解</SelectItem>
                    {propertyRows.map((item) => (
                      <SelectItem key={item.id} value={item.name}>{item.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="grid gap-3 pt-4 sm:pt-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium">自定义转化路径</div>
                <Badge variant="secondary">{events.length} steps</Badge>
              </div>
              <EventStepSelector options={eventRows} value={events} onChange={setEvents} />
              <Input
                value={versionNote}
                onChange={(event) => setVersionNote(event.target.value)}
                placeholder="本次保存备注（可选，如 v2 增加支付步骤）"
              />
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Button type="button" disabled={!projectId || events.length < 2 || analyze.isPending} onClick={() => analyze.mutate()}>
                  <Play className="h-4 w-4" />
                  {analyze.isPending ? "计算中" : "计算转化"}
                </Button>
                <Button type="button" variant="outline" disabled={!projectId || events.length < 2 || trend.isPending} onClick={() => trend.mutate()}>
                  <LineChart className="h-4 w-4" />
                  {trend.isPending ? "趋势中" : "趋势对比"}
                </Button>
                <Button type="button" variant="outline" disabled={!projectId || events.length < 2 || exportCsv.isPending} onClick={() => exportCsv.mutate()}>
                  <Download className="h-4 w-4" />
                  {exportCsv.isPending ? "导出中" : "导出 CSV"}
                </Button>
                <Button type="button" variant="outline" disabled={!projectId || events.length < 2 || saveGoal.isPending || !name.trim()} onClick={() => saveGoal.mutate()}>
                  <BookmarkPlus className="h-4 w-4" />
                  {saveGoal.isPending ? "保存中" : "保存目标"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setName("购买转化");
                    setEvents([]);
                    setBreakdownProperty("");
                    setWindowSeconds(7 * 24 * 3600);
                    setVersionNote("");
                    setTrendData(null);
                    analyze.reset();
                  }}
                >
                  <RotateCcw className="h-4 w-4" />
                  重置
                </Button>
              </div>
              <div className="min-h-6 flex flex-wrap gap-2">
                {analyze.error ? <Badge variant="danger" className="items-center">{String(analyze.error.message || analyze.error)}</Badge> : null}
                {saveGoal.error ? <Badge variant="danger" className="items-center">{String(saveGoal.error.message || saveGoal.error)}</Badge> : null}
                {saveGoal.isSuccess ? <Badge variant="success" className="items-center">已保存为新版本 v{saveGoal.data?.data.version ?? "?"}</Badge> : null}
                {trend.error ? <Badge variant="danger" className="items-center">{String(trend.error.message || trend.error)}</Badge> : null}
                {exportCsv.error ? <Badge variant="danger" className="items-center">{String(exportCsv.error.message || exportCsv.error)}</Badge> : null}
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardContent className="grid gap-3 pt-4 sm:pt-4">
              <div className="text-sm font-medium">已保存目标</div>
              {(goals.data?.data || []).length ? (
                <div className="grid max-h-80 gap-2 overflow-y-auto pr-1">
                  {(goals.data?.data || []).map((goal) => (
                    <div
                      key={goal.id}
                      className={cn(
                        "grid gap-2 rounded-md border bg-background p-3 transition-colors",
                        name === goal.name && "border-primary/50 bg-accent/50",
                      )}
                    >
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => loadGoal(goal)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <span className="block truncate text-sm font-medium">{goal.name}</span>
                          <span className="mt-1 block truncate text-xs text-muted-foreground">{goal.events.join(" → ")}</span>
                        </button>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge variant="secondary">v{goal.version || 1} · {goal.events.length} 步</Badge>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            onClick={() => setVersionGoalId(goal.id)}
                            aria-label={`查看 ${goal.name} 版本历史`}
                            className="h-8 w-8 text-muted-foreground hover:text-primary"
                          >
                            <History className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            disabled={deleteGoal.isPending}
                            onClick={() => deleteGoal.mutate(goal.id)}
                            aria-label={`删除 ${goal.name}`}
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-md border border-dashed bg-secondary/30 px-3 py-4 text-sm text-muted-foreground">
                  暂无保存目标。配置路径后点击保存目标。
                </p>
              )}
              {deleteGoal.error ? <Badge variant="danger" className="items-center">{String(deleteGoal.error.message || deleteGoal.error)}</Badge> : null}
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 grid gap-5">
          <div className="grid min-w-0 gap-3 sm:grid-cols-3 [&>*]:min-w-0">
            <MetricTile label="首步用户" value={firstUsers} loading={analyze.isPending} />
            <MetricTile label="完成用户" value={lastUsers} loading={analyze.isPending} />
            <MetricTile label="总转化率" value={finalRate} hint={`平均流失 ${avgDropoff.toFixed(2)}%`} loading={analyze.isPending} />
          </div>

          <ChartPanel title="转化路径" description={events.length ? events.join(" → ") : "请选择至少两个事件"} className="min-w-0" contentClassName="pt-3 sm:pt-3">
            {steps.length ? (
              <div className="grid gap-3">
                {steps.map((step, index) => (
                  <div key={`${step.event}:${index}`} className="rounded-md border bg-background p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
                          {index + 1}
                        </span>
                        <span className="truncate text-sm font-medium">{step.event}</span>
                      </div>
                      <span className="font-mono text-sm">{(step.conversion * 100).toFixed(2)}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, step.conversion * 100)}%` }} />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                      <span>{step.users.toLocaleString()} 用户</span>
                      {index > 0 ? <span>较上一步流失 {(step.dropoff * 100).toFixed(2)}%</span> : <span>入口步骤</span>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyAnalysis title="暂无转化结果" description="配置路径后点击计算转化。" />
            )}
          </ChartPanel>

          <ChartPanel title="参数拆解" description={breakdownProperty ? `按 ${breakdownProperty} 拆解` : "选择拆解参数后可比较不同参数值的转化"} className="min-w-0" contentClassName="p-0 sm:p-0">
            {breakdown.length ? (
              <div className="max-w-full overflow-x-auto">
                <Table style={{ minWidth: breakdownTableMinWidth }}>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-56 whitespace-nowrap">{breakdownProperty}</TableHead>
                      <TableHead className="w-28 whitespace-nowrap text-right">首步用户</TableHead>
                      <TableHead className="w-28 whitespace-nowrap text-right">总转化率</TableHead>
                      {events.map((event, index) => (
                        <TableHead key={`${event}:${index}`} className="w-44 whitespace-nowrap text-right">{index + 1}. {event}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {breakdown.slice(0, 50).map((row) => (
                      <TableRow key={row.raw}>
                        <TableCell className="max-w-[220px] truncate font-medium">{row.label}</TableCell>
                        <TableCell className="text-right font-mono">{row.users.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-mono">{(row.conversion * 100).toFixed(2)}%</TableCell>
                        {row.steps.map((step, index) => (
                          <TableCell key={`${row.raw}:${index}`} className="text-right font-mono">
                            {step.users.toLocaleString()} / {(step.conversion * 100).toFixed(1)}%
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <EmptyAnalysis title="暂无拆解结果" description="选择拆解参数并计算后，这里会展示不同参数值下的转化率。" />
            )}
          </ChartPanel>

          <ChartPanel title="趋势对比" description={trendData ? `当前期 vs 同长度上一期，按天展示` : "点击\"趋势对比\"查看每天的总转化率走势与同期对比"} className="min-w-0" contentClassName="pt-3 sm:pt-3">
            {trendData && trendData.current.length ? (
              <div className="max-w-full overflow-x-auto">
                <Table style={{ minWidth: 720 }}>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-44">日期</TableHead>
                      <TableHead className="text-right">当前期 首步</TableHead>
                      <TableHead className="text-right">当前期 转化率</TableHead>
                      <TableHead className="text-right">上期 首步</TableHead>
                      <TableHead className="text-right">上期 转化率</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trendData.current.map((cur, index) => {
                      const prev = trendData.compare[index];
                      return (
                        <TableRow key={cur.bucket}>
                          <TableCell className="font-mono text-xs">{cur.bucket.replace("T", " ").replace("Z", "")}</TableCell>
                          <TableCell className="text-right font-mono">{cur.first.toLocaleString()}</TableCell>
                          <TableCell className="text-right font-mono">{(cur.conversion * 100).toFixed(2)}%</TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground">{prev ? prev.first.toLocaleString() : "-"}</TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground">{prev ? `${(prev.conversion * 100).toFixed(2)}%` : "-"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <EmptyAnalysis title="暂无趋势数据" description="点击趋势对比按钮可同时拉取当前与同长度上一期的每日转化率。" />
            )}
          </ChartPanel>

          {versionGoalId ? (
            <ChartPanel
              title={`版本历史`}
              description={`目标 #${versionGoalId} 的所有版本快照`}
              className="min-w-0"
              contentClassName="pt-3 sm:pt-3"
            >
              <div className="mb-3 flex items-center justify-end">
                <Button type="button" variant="ghost" size="sm" onClick={() => setVersionGoalId(null)}>关闭</Button>
              </div>
              {(versions.data?.data || []).length ? (
                <div className="grid gap-2">
                  {(versions.data?.data || []).map((v: ConversionGoalVersion) => (
                    <div key={v.id} className="rounded-md border bg-background p-3">
                      <div className="mb-1 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Badge variant="info">v{v.version}</Badge>
                          <span className="text-sm font-medium">{v.name}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">{new Date(v.created_at).toLocaleString()}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">{v.events.join(" → ")}</div>
                      {v.note ? <div className="mt-1 text-xs text-muted-foreground">备注：{v.note}</div> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyAnalysis title="暂无版本" description="保存目标后会自动写入第一份快照。" />
              )}
            </ChartPanel>
          ) : null}

          <ChartPanel title="关键事件" description="当前目标的最后一步会被视作本路径的关键转化事件" className="min-w-0" contentClassName="pt-3 sm:pt-3">
            {events.length ? (
              <div className="rounded-md border bg-background p-3">
                <div className="flex items-center gap-2">
                  <BadgeCheck className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">{events[events.length - 1]}</span>
                  <Badge variant="success">目标事件</Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  保存目标后，路径名称、步骤、窗口和拆解参数会保留，可直接加载复用。
                </p>
              </div>
            ) : (
              <EmptyAnalysis title="暂无关键事件" />
            )}
          </ChartPanel>
        </div>
      </div>
    </div>
  );
}
