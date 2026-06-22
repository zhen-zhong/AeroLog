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
  NumberField,
  ToolbarPanel,
} from "@/features/analytics/analytics-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { useProjectStore } from "@/stores/project-store";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

type Model = "first" | "last" | "linear";

interface Row {
  event: string;
  credit: number;
  users: number;
  share: number;
  avg_lag_seconds: number;
}

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
  const [range, setRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(30, "day").startOf("day"),
    dayjs().endOf("day"),
  ]);
  const [error, setError] = useState("");

  // 切换项目时重置
  useEffect(() => {
    setConversionEvent(undefined);
    setTouchEvents([]);
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

  const runMut = useMutation({
    mutationFn: () =>
      api.attribution(projectId!, {
        conversion_event: conversionEvent!,
        touch_events: touchEvents,
        from: range[0].valueOf(),
        to: range[1].valueOf(),
        window_seconds: windowSeconds,
        model,
      }),
    onSuccess: () => setError(""),
    onError: (e: Error) => setError(e.message),
  });

  const result = runMut.data?.data;
  const rows: Row[] = result?.rows || [];

  const chartOption = useMemo(
    () => ({
      color: ["#0891b2", "#0f766e", "#4f46e5", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#ca8a04"],
      tooltip: {
        trigger: "item",
        formatter: (p: { name: string; value: number; percent: number }) =>
          `${p.name}<br/>贡献 ${p.value.toFixed(2)} · ${p.percent}%`,
      },
      series: [
        {
          type: "pie",
          radius: ["48%", "76%"],
          center: ["50%", "52%"],
          itemStyle: { borderColor: "#ffffff", borderWidth: 2, borderRadius: 4 },
          label: { formatter: "{b}\n{d}%" },
          data: rows.map((r) => ({ name: r.event, value: Number(r.credit.toFixed(4)) })),
        },
      ],
    }),
    [rows],
  );

  const totalUsers = result?.total_users || 0;
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
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <div className="grid gap-1.5">
              <Label htmlFor="attr-from">开始时间</Label>
              <Input
                id="attr-from"
                type="datetime-local"
                value={range[0].format("YYYY-MM-DDTHH:mm")}
                onChange={(e) => {
                  const next = e.target.value ? dayjs(e.target.value) : range[0];
                  setRange([next, range[1]]);
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="attr-to">结束时间</Label>
              <Input
                id="attr-to"
                type="datetime-local"
                value={range[1].format("YYYY-MM-DDTHH:mm")}
                onChange={(e) => {
                  const next = e.target.value ? dayjs(e.target.value) : range[1];
                  setRange([range[0], next]);
                }}
              />
            </div>
            <NumberField
              label="触点回看窗口（秒）"
              min={300}
              max={60 * 24 * 3600}
              step={3600}
              value={windowSeconds}
              onChange={setWindowSeconds}
            />
            <div className="grid gap-1.5">
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
            <div className="grid gap-1.5">
              <Label>转化事件</Label>
              <EventPicker
                events={top?.data || []}
                value={conversionEvent}
                onChange={setConversionEvent}
                placeholder="选择转化目标"
                className="sm:w-full"
              />
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {MODEL_OPTIONS.find((opt) => opt.value === model)?.hint}
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

        <div className="grid gap-3 sm:grid-cols-3">
          <MetricTile label="转化用户" value={totalUsers} loading={topLoading || runMut.isPending} />
          <MetricTile label="贡献度合计" value={Number(totalCredit.toFixed(2))} loading={runMut.isPending} />
          <div className="rounded-lg border bg-card px-4 py-3">
            <div className="text-xs text-muted-foreground">头部触点</div>
            <div className="mt-1 text-base font-semibold">{topRow ? topRow.event : "-"}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {topRow ? `占比 ${(topRow.share * 100).toFixed(1)}%` : "尚未计算"}
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
            <ChartPanel
              title="触点贡献分布"
              description={`模型：${MODEL_OPTIONS.find((o) => o.value === model)?.label} · 回看 ${formatLag(windowSeconds)}`}
            >
              <ReactECharts option={chartOption} style={{ height: 320 }} />
            </ChartPanel>
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
            </>
          )}
      </div>
    </div>
  );
}
