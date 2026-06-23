"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import dayjs, { Dayjs } from "dayjs";
import { Play, RotateCcw } from "lucide-react";
import {
  AnalyticsHeader,
  ChartPanel,
  EmptyAnalysis,
  EventPicker,
  EventStepSelector,
  MetricTile,
  ToolbarPanel,
} from "@/features/analytics/analytics-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  api,
  AttributionBreakdownGroup,
  AttributionLagBucket,
  AttributionRow,
} from "@/lib/api";
import { useProjectStore } from "@/stores/project-store";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

type Model = "first" | "last" | "linear";

const NONE = "__none__";

const MODEL_OPTIONS: { value: Model; label: string; hint: string }[] = [
  { value: "last", label: "末次触点", hint: "转化前最后一次触点拿全部权重，常用于近因效应分析。" },
  { value: "first", label: "首次触点", hint: "转化前第一次触点拿全部权重，常用于拉新渠道评估。" },
  { value: "linear", label: "线性归因", hint: "把 1 次转化平均分摊给所有触点，反映整体协同。" },
];

function formatLag(seconds: number) {
  if (!seconds || !isFinite(seconds)) return "-";
  if (seconds < 60) return `${seconds.toFixed(0)} 秒`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)} 分`;
  if (seconds < 24 * 3600) return `${(seconds / 3600).toFixed(1)} 小时`;
  return `${(seconds / 86400).toFixed(1)} 天`;
}

export default function AttributionPage() {
  const projectId = useProjectStore((s) => s.projectId);
  const [conversionEvent, setConversionEvent] = useState<string | undefined>();
  const [touchEvents, setTouchEvents] = useState<string[]>([]);
  const [model, setModel] = useState<Model>("last");
  const [windowSeconds, setWindowSeconds] = useState<number>(7 * 24 * 3600);
  const [breakdownProperty, setBreakdownProperty] = useState<string>("");
  const [range, setRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(30, "day").startOf("day"),
    dayjs().endOf("day"),
  ]);
  const [error, setError] = useState("");

  // 切换项目时重置
  useEffect(() => {
    setConversionEvent(undefined);
    setTouchEvents([]);
    setBreakdownProperty("");
    setError("");
  }, [projectId]);

  const { data: top, isLoading: topLoading } = useQuery({
    queryKey: ["attribution_top", projectId],
    queryFn: () =>
      api.topEvents(projectId!, {
        from: dayjs().subtract(30, "day").valueOf(),
        to: Date.now(),
        limit: 100,
      }),
    enabled: !!projectId,
  });

  const { data: properties } = useQuery({
    queryKey: ["attribution_properties", projectId],
    queryFn: () => api.listProperties(projectId!, { scope: "event" }),
    enabled: !!projectId,
  });

  const runMut = useMutation({
    mutationFn: () =>
      api.attribution(projectId!, {
        conversion_event: conversionEvent!,
        touch_events: touchEvents,
        from: range[0].valueOf(),
        to: range[1].valueOf(),
        window_seconds: windowSeconds,
        model,
        breakdown_property: breakdownProperty || undefined,
      }),
    onSuccess: () => setError(""),
    onError: (e: Error) => setError(e.message),
  });

  const result = runMut.data?.data;
  const rows: AttributionRow[] = result?.rows || [];
  const lagBuckets: AttributionLagBucket[] = result?.lag_buckets || [];
  const breakdown: AttributionBreakdownGroup[] = result?.breakdown || [];
  const breakdownTruncated = result?.breakdown_truncated || false;
  const contributionRows = useMemo(
    () => [...rows].sort((a, b) => b.credit - a.credit).slice(0, 12).reverse(),
    [rows],
  );

  const chartOption = useMemo(
    () => ({
      color: ["#0891b2", "#0f766e", "#4f46e5", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#ca8a04"],
      tooltip: {
        trigger: "axis",
        formatter: (params: Array<{ name: string; value: number; data?: { share?: number; users?: number } }>) => {
          const p = params[0];
          return `${p.name}<br/>贡献 ${p.value.toFixed(2)} · ${((p.data?.share || 0) * 100).toFixed(1)}% · 用户 ${(p.data?.users || 0).toLocaleString()}`;
        },
      },
      grid: { left: 132, right: 28, top: 16, bottom: 20 },
      xAxis: { type: "value", splitLine: { lineStyle: { color: "#f4f4f5" } } },
      yAxis: {
        type: "category",
        data: contributionRows.map((row) => row.event),
        axisTick: { show: false },
        axisLine: { show: false },
      },
      series: [
        {
          type: "bar",
          barMaxWidth: 24,
          itemStyle: { borderRadius: [0, 6, 6, 0] },
          data: contributionRows.map((row) => ({
            value: Number(row.credit.toFixed(4)),
            share: row.share,
            users: row.users,
          })),
        },
      ],
    }),
    [contributionRows],
  );

  const lagOption = useMemo(
    () => ({
      color: ["#0891b2"],
      grid: { left: 36, right: 16, top: 24, bottom: 28 },
      tooltip: {
        trigger: "axis",
        formatter: (params: Array<{ name: string; value: number; data?: { users?: number } }>) => {
          const p = params[0];
          const users = p?.data?.users || 0;
          return `${p.name}<br/>贡献 ${p.value.toFixed(2)} · 用户 ${users.toLocaleString()}`;
        },
      },
      xAxis: {
        type: "category",
        data: lagBuckets.map((b) => b.label),
        axisLine: { lineStyle: { color: "#d4d4d8" } },
      },
      yAxis: { type: "value", splitLine: { lineStyle: { color: "#f4f4f5" } } },
      series: [
        {
          type: "bar",
          barMaxWidth: 40,
          itemStyle: { borderRadius: [6, 6, 0, 0] },
          data: lagBuckets.map((b) => ({ value: Number(b.credit.toFixed(4)), users: b.users })),
        },
      ],
    }),
    [lagBuckets],
  );

  const totalUsers = result?.total_users || 0;
  const attributedUsers = result?.attributed_users || 0;
  const unattributedUsers = result?.unattributed_users || 0;
  const unattributedShare = result?.unattributed_share || 0;
  const totalCredit = result?.total_credit || 0;
  const topRow = rows[0];

  return (
    <div>
      <AnalyticsHeader
        title="事件归因"
        description="基于触点回看窗口，把每一次转化按所选模型分配给前置触点，识别真正驱动转化的关键事件。"
      />

      <div className="grid gap-5">
        <ToolbarPanel className="mb-0">
          <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-[minmax(27.5rem,2fr)_repeat(4,minmax(0,1fr))]">
            <div className="grid min-w-0 gap-4 sm:col-span-2 sm:grid-cols-2 2xl:col-span-1">
              <div className="grid min-w-0 gap-1.5">
                <Label htmlFor="attr-from">开始时间</Label>
                <Input
                  className="min-w-0 w-full"
                  id="attr-from"
                  type="datetime-local"
                  value={range[0].format("YYYY-MM-DDTHH:mm")}
                  onChange={(e) => {
                    const next = e.target.value ? dayjs(e.target.value) : range[0];
                    setRange([next, range[1]]);
                  }}
                />
              </div>
              <div className="grid min-w-0 gap-1.5">
                <Label htmlFor="attr-to">结束时间</Label>
                <Input
                  className="min-w-0 w-full"
                  id="attr-to"
                  type="datetime-local"
                  value={range[1].format("YYYY-MM-DDTHH:mm")}
                  onChange={(e) => {
                    const next = e.target.value ? dayjs(e.target.value) : range[1];
                    setRange([range[0], next]);
                  }}
                />
              </div>
            </div>
            <div className="grid min-w-0 gap-1.5">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <Label htmlFor="attr-window" className="shrink-0 whitespace-nowrap">回看窗口（秒）</Label>
                <div
                  className="flex shrink-0 items-center gap-1.5 text-[11px]"
                  role="group"
                  aria-label="回看窗口快捷选择"
                >
                  {([
                    [24 * 3600, "1d"],
                    [7 * 24 * 3600, "7d"],
                    [30 * 24 * 3600, "30d"],
                  ] as const).map(([seconds, label]) => (
                    <button
                      key={seconds}
                      type="button"
                      aria-pressed={windowSeconds === seconds}
                      aria-label={`使用 ${label.replace("d", " 天")}回看窗口`}
                      className={`h-5 rounded-sm px-1 text-[11px] font-medium leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
                        windowSeconds === seconds
                          ? "text-primary underline decoration-primary/40 underline-offset-4"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => setWindowSeconds(seconds)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <Input
                id="attr-window"
                type="number"
                min={300}
                max={60 * 24 * 3600}
                step={3600}
                value={windowSeconds}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (Number.isFinite(next)) setWindowSeconds(Math.min(60 * 24 * 3600, Math.max(300, next)));
                }}
              />
            </div>
            <div className="grid min-w-0 gap-1.5">
              <Label>归因模型</Label>
              <Select value={model} onValueChange={(v) => setModel(v as Model)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODEL_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid min-w-0 gap-1.5">
              <Label>转化事件</Label>
              <EventPicker
                events={top?.data || []}
                value={conversionEvent}
                onChange={setConversionEvent}
                placeholder="选择转化目标"
                className="w-full sm:w-full"
              />
            </div>
            <div className="grid min-w-0 gap-1.5">
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
          <p className="mt-2 text-xs text-muted-foreground">
            {MODEL_OPTIONS.find((opt) => opt.value === model)?.hint} 每位用户在分析期内只使用最近一次转化作为归因锚点。
          </p>

          <div className="mt-5">
            <div className="mb-2 text-sm font-medium">触点事件</div>
            <EventStepSelector options={top?.data || []} value={touchEvents} onChange={setTouchEvents} />
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              disabled={!projectId || !conversionEvent || touchEvents.length === 0 || runMut.isPending}
              onClick={() => runMut.mutate()}
            >
              <Play className="h-4 w-4" />
              {runMut.isPending ? "计算中" : "计算归因"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setConversionEvent(undefined);
                setTouchEvents([]);
                setBreakdownProperty("");
                setError("");
                runMut.reset();
              }}
            >
              <RotateCcw className="h-4 w-4" />
              重置
            </Button>
            {error ? <Badge variant="danger" className="items-center">{error}</Badge> : null}
          </div>
        </ToolbarPanel>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricTile label="转化用户" value={totalUsers} loading={topLoading || runMut.isPending} />
          <MetricTile label="已归因用户" value={attributedUsers} hint="窗口内匹配到触点" loading={runMut.isPending} />
          <MetricTile
            label="未归因占比"
            value={Number((unattributedShare * 100).toFixed(2))}
            hint={`${unattributedUsers.toLocaleString()} 人`}
            loading={runMut.isPending}
          />
          <div className="rounded-lg border bg-card px-4 py-3">
            <div className="text-xs text-muted-foreground">头部触点</div>
            <div className="mt-1 text-base font-semibold">{topRow ? topRow.event : "-"}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {topRow ? `占比 ${(topRow.share * 100).toFixed(1)}% · 贡献 ${totalCredit.toFixed(2)}` : "尚未计算"}
            </div>
          </div>
        </div>

        {!result ? (
          <EmptyAnalysis
            title="选择转化事件与触点后开始计算"
            description="转化事件为最终目标（例如 pay_success），触点事件为漏斗前置行为（例如 click_ad、view_product）。"
          />
        ) : rows.length === 0 ? (
          <EmptyAnalysis
            title="窗口内未发现可归因触点"
            description="尝试加大触点回看窗口、扩展时间范围或重新选择触点事件清单。"
          />
        ) : (
          <>
            <div className="grid gap-5 xl:grid-cols-2">
              <ChartPanel
                title="触点贡献排行"
                description={`模型：${MODEL_OPTIONS.find((o) => o.value === model)?.label} · 回看 ${formatLag(windowSeconds)} · 最多展示 12 个触点`}
              >
                <ReactECharts option={chartOption} style={{ height: 320 }} />
              </ChartPanel>
              <ChartPanel
                title="归因时延分桶"
                description="把每条触点到转化的间隔归入桶内，越靠左的桶代表近因效应越强。"
              >
                {lagBuckets.length ? (
                  <ReactECharts option={lagOption} style={{ height: 320 }} />
                ) : (
                  <EmptyAnalysis title="无时延数据" description="窗口内未发现可归因触点。" />
                )}
              </ChartPanel>
            </div>

            <ChartPanel title="触点明细" description="贡献度依据所选归因模型进行分配；占比为该触点贡献度 / 触点贡献度总和。">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>触点事件</TableHead>
                      <TableHead className="text-right">贡献度</TableHead>
                      <TableHead className="text-right">占比</TableHead>
                      <TableHead className="text-right">覆盖用户</TableHead>
                      <TableHead className="text-right">平均时延</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row, index) => (
                      <TableRow key={row.event}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
                              {index + 1}
                            </span>
                            <span className="font-medium">{row.event}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono">{row.credit.toFixed(2)}</TableCell>
                        <TableCell className="text-right font-mono">{(row.share * 100).toFixed(2)}%</TableCell>
                        <TableCell className="text-right font-mono">{row.users.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-mono">{formatLag(row.avg_lag_seconds)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </ChartPanel>

            {breakdownProperty && breakdown.length > 0 ? (
              <ChartPanel
                title={`按 ${breakdownProperty} 分组归因`}
                description={`按维度取值聚合，识别哪个渠道/活动贡献最大；占比为该维度内头部触点占该组总贡献度的比例。${breakdownTruncated ? " 为控制高基数维度的噪音，当前仅展示贡献最高的 12 个取值。" : ""}`}
              >
                <div className="overflow-x-auto">
                  <Table className="min-w-[720px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[160px]">{breakdownProperty}</TableHead>
                        <TableHead className="text-right">贡献度</TableHead>
                        <TableHead className="text-right">覆盖用户</TableHead>
                        <TableHead>头部触点</TableHead>
                        <TableHead className="text-right">头部占比</TableHead>
                        <TableHead>触点构成</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {breakdown.map((g) => (
                        <TableRow key={g.raw}>
                          <TableCell className="font-medium">{g.label || "(空)"}</TableCell>
                          <TableCell className="text-right font-mono">{g.total_credit.toFixed(2)}</TableCell>
                          <TableCell className="text-right font-mono">{g.users.toLocaleString()}</TableCell>
                          <TableCell>{g.top_event || "-"}</TableCell>
                          <TableCell className="text-right font-mono">
                            {(g.top_share * 100).toFixed(2)}%
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {(g.rows || []).slice(0, 4).map((r) => (
                                <span
                                  key={r.event}
                                  className="rounded bg-muted px-1.5 py-0.5 text-xs"
                                  title={`贡献 ${r.credit.toFixed(2)} · ${(r.share * 100).toFixed(1)}%`}
                                >
                                  {r.event} {(r.share * 100).toFixed(0)}%
                                </span>
                              ))}
                              {(g.rows || []).length > 4 ? (
                                <span className="text-xs text-muted-foreground">+{g.rows.length - 4}</span>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </ChartPanel>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
