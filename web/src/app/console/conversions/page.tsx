"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs, { Dayjs } from "dayjs";
import { BadgeCheck, BookmarkPlus, Flag, Play, RotateCcw } from "lucide-react";
import {
  AnalyticsHeader,
  ChartPanel,
  DateTimeRange,
  EmptyAnalysis,
  EventStepSelector,
  MetricTile,
  NumberField,
  ProjectPicker,
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
import { api, ConversionGoal } from "@/lib/api";
import { cn } from "@/lib/utils";

const DEFAULT_EVENTS = ["search", "view_product", "pay_success"];

export default function ConversionsPage() {
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState<number | undefined>();
  const [range, setRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(7, "day").startOf("day"),
    dayjs().endOf("day"),
  ]);
  const [name, setName] = useState("购买转化");
  const [events, setEvents] = useState<string[]>([]);
  const [windowSeconds, setWindowSeconds] = useState(7 * 24 * 3600);
  const [breakdownProperty, setBreakdownProperty] = useState("");

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects(),
  });

  useEffect(() => {
    if (!projectId && projects?.data?.length) setProjectId(projects.data[0].id);
  }, [projects, projectId]);

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
      }),
    onSuccess: () => {
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
        <div className="grid gap-5">
          <Card>
            <CardContent className="grid gap-4 pt-4 sm:pt-4">
              <div className="grid gap-1.5">
                <div className="text-sm font-medium">项目</div>
                <ProjectPicker projects={projects?.data || []} value={projectId} onChange={setProjectId} className="sm:w-full" />
              </div>
              <DateTimeRange value={range} onChange={setRange} />
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
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="button" disabled={!projectId || events.length < 2 || analyze.isPending} onClick={() => analyze.mutate()}>
                  <Play className="h-4 w-4" />
                  {analyze.isPending ? "计算中" : "计算转化"}
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
                    analyze.reset();
                  }}
                >
                  <RotateCcw className="h-4 w-4" />
                  重置
                </Button>
              </div>
              {analyze.error ? <Badge variant="danger" className="items-center">{String(analyze.error.message || analyze.error)}</Badge> : null}
              {saveGoal.error ? <Badge variant="danger" className="items-center">{String(saveGoal.error.message || saveGoal.error)}</Badge> : null}
              {saveGoal.isSuccess ? <Badge variant="success" className="items-center">已保存</Badge> : null}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="grid gap-3 pt-4 sm:pt-4">
              <div className="text-sm font-medium">已保存目标</div>
              {(goals.data?.data || []).length ? (
                <div className="grid gap-2">
                  {(goals.data?.data || []).map((goal) => (
                    <button
                      key={goal.id}
                      type="button"
                      onClick={() => loadGoal(goal)}
                      className={cn(
                        "rounded-md border bg-background p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/60",
                        name === goal.name && "border-primary/50 bg-accent/50",
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm font-medium">{goal.name}</span>
                        <Badge variant="secondary">{goal.events.length} 步</Badge>
                      </div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">{goal.events.join(" → ")}</div>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="rounded-md border border-dashed bg-secondary/30 px-3 py-4 text-sm text-muted-foreground">
                  暂无保存目标。配置路径后点击保存目标。
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricTile label="首步用户" value={firstUsers} loading={analyze.isPending} />
            <MetricTile label="完成用户" value={lastUsers} loading={analyze.isPending} />
            <MetricTile label="总转化率" value={finalRate} hint={`平均流失 ${avgDropoff.toFixed(2)}%`} loading={analyze.isPending} />
          </div>

          <ChartPanel title="转化路径" description={events.length ? events.join(" → ") : "请选择至少两个事件"} contentClassName="pt-3 sm:pt-3">
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

          <ChartPanel title="参数拆解" description={breakdownProperty ? `按 ${breakdownProperty} 拆解` : "选择拆解参数后可比较不同参数值的转化"} contentClassName="p-0 sm:p-0">
            {breakdown.length ? (
              <div className="overflow-x-auto">
                <Table className="min-w-[760px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{breakdownProperty}</TableHead>
                      <TableHead className="text-right">首步用户</TableHead>
                      <TableHead className="text-right">总转化率</TableHead>
                      {events.map((event, index) => (
                        <TableHead key={`${event}:${index}`} className="text-right">{index + 1}. {event}</TableHead>
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

          <ChartPanel title="关键事件" description="当前目标的最后一步会被视作本路径的关键转化事件" contentClassName="pt-3 sm:pt-3">
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
