"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import dayjs, { Dayjs } from "dayjs";
import { Play, RotateCcw } from "lucide-react";
import {
  AnalyticsHeader,
  ChartPanel,
  DateTimeRange,
  EmptyAnalysis,
  EventStepSelector,
  MetricTile,
  NumberField,
  ToolbarPanel,
} from "@/features/analytics/analytics-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, ConversionBreakdownRow, ConversionStep } from "@/lib/api";
import { useProjectStore } from "@/stores/project-store";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

export default function FunnelPage() {
  const projectId = useProjectStore((s) => s.projectId);
  const [events, setEvents] = useState<string[]>([]);
  const [windowSeconds, setWindowSeconds] = useState<number>(24 * 3600);
  const [breakdownProperty, setBreakdownProperty] = useState("");
  const [range, setRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(7, "day").startOf("day"),
    dayjs().endOf("day"),
  ]);
  const [result, setResult] = useState<ConversionStep[]>([]);
  const [breakdown, setBreakdown] = useState<ConversionBreakdownRow[]>([]);
  const [breakdownTruncated, setBreakdownTruncated] = useState(false);
  const [error, setError] = useState("");

  // 切换项目时重置
  useEffect(() => {
    setEvents([]);
    setResult([]);
    setBreakdown([]);
    setBreakdownTruncated(false);
    setBreakdownProperty("");
    setError("");
  }, [projectId]);

  const { data: top, isLoading: topLoading } = useQuery({
    queryKey: ["funnel_top", projectId],
    queryFn: () =>
      api.topEvents(projectId!, {
        from: dayjs().subtract(30, "day").valueOf(),
        to: Date.now(),
        limit: 100,
      }),
    enabled: !!projectId,
  });

  const { data: properties } = useQuery({
    queryKey: ["funnel_properties", projectId],
    queryFn: () => api.listProperties(projectId!, { scope: "event" }),
    enabled: !!projectId,
  });
  const propertyRows = properties?.data || [];

  const runMut = useMutation({
    mutationFn: () =>
      api.funnel(projectId!, {
        events,
        from: range[0].valueOf(),
        to: range[1].valueOf(),
        window_seconds: windowSeconds,
        breakdown_property: breakdownProperty || undefined,
      }),
    onSuccess: (res) => {
      setError("");
      setResult(res.data.steps);
      setBreakdown(res.data.breakdown || []);
      setBreakdownTruncated(res.data.breakdown_truncated);
    },
    onError: (e: Error) => setError(e.message),
  });

  const option = useMemo(
    () => ({
      color: ["#0891b2", "#0f766e", "#4f46e5", "#7c3aed"],
      tooltip: { trigger: "item", formatter: "{b}: {c} 人" },
      series: [
        {
          type: "funnel",
          left: "8%",
          right: "8%",
          top: 18,
          bottom: 18,
          minSize: "10%",
          label: {
            show: true,
            position: "inside",
            formatter: "{b}",
            color: "#ffffff",
            fontWeight: 600,
          },
          itemStyle: { borderColor: "#ffffff", borderWidth: 2 },
          data: result.map((s) => ({
            name: `${s.event} ${(s.conversion * 100).toFixed(1)}%`,
            value: s.users,
          })),
        },
      ],
    }),
    [result],
  );

  const firstUsers = result[0]?.users || 0;
  const lastUsers = result[result.length - 1]?.users || 0;
  const finalRate = firstUsers ? Math.round((lastUsers / firstUsers) * 10000) / 100 : 0;
  const biggestDropoff = result.slice(1).reduce<ConversionStep | undefined>(
    (worst, step) => (!worst || step.dropoff > worst.dropoff ? step : worst),
    undefined,
  );

  return (
    <div>
      <AnalyticsHeader
        title="漏斗分析"
        description="按用户行为顺序计算转化链路，适合观察搜索、浏览、加购、支付等关键路径的流失。"
      />

      <div className="grid gap-5 xl:grid-cols-[390px_minmax(0,1fr)]">
        <div className="grid gap-5">
          <ToolbarPanel className="mb-0">
            <div className="grid gap-4">
              <DateTimeRange value={range} onChange={setRange} stacked />
              <NumberField
                label="转化窗口（秒）"
                min={60}
                max={30 * 24 * 3600}
                step={3600}
                value={windowSeconds}
                onChange={setWindowSeconds}
              />
              <div className="flex flex-wrap gap-1.5" aria-label="转化窗口快捷选择">
                {([
                  [3600, "1 小时"],
                  [24 * 3600, "1 天"],
                  [7 * 24 * 3600, "7 天"],
                ] as const).map(([seconds, label]) => (
                  <Button
                    key={seconds}
                    type="button"
                    variant={windowSeconds === seconds ? "secondary" : "ghost"}
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setWindowSeconds(seconds)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <div className="grid gap-1.5">
                <div className="text-sm font-medium">分组参数（可选）</div>
                <Select
                  value={breakdownProperty || "__none__"}
                  onValueChange={(v) => setBreakdownProperty(v === "__none__" ? "" : v)}
                >
                  <SelectTrigger><SelectValue placeholder="不分组" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">不分组</SelectItem>
                    {propertyRows.map((p) => (
                      <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="mt-5">
              <div className="mb-2 text-sm font-medium">漏斗步骤</div>
              <EventStepSelector options={top?.data || []} value={events} onChange={setEvents} />
            </div>

            <div className="mt-5 flex flex-col gap-2">
              <Button
                type="button"
                disabled={!projectId || events.length < 2 || runMut.isPending}
                onClick={() => runMut.mutate()}
              >
                <Play className="h-4 w-4" />
                {runMut.isPending ? "计算中" : "计算漏斗"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEvents([]);
                  setResult([]);
                  setBreakdown([]);
                  setBreakdownTruncated(false);
                  setError("");
                }}
              >
                <RotateCcw className="h-4 w-4" />
                重置
              </Button>
              {error ? <Badge variant="danger" className="items-center">{error}</Badge> : null}
            </div>
          </ToolbarPanel>

          <div className="grid gap-3">
            <MetricTile label="步骤数" value={events.length} loading={topLoading} />
            <MetricTile label="起始用户" value={firstUsers} loading={runMut.isPending} />
            <MetricTile label="最终转化率" value={finalRate} hint="百分比" loading={runMut.isPending} />
            {biggestDropoff ? (
              <MetricTile
                label="最大单步流失"
                value={Number((biggestDropoff.dropoff * 100).toFixed(2))}
                hint={biggestDropoff.event}
                loading={runMut.isPending}
              />
            ) : null}
          </div>
        </div>

        <div className="grid gap-5">
          {result.length === 0 ? (
            <EmptyAnalysis title="选择步骤并点击计算" description="建议先选择 search、view_product、add_to_cart、pay_success 这类连续事件。" />
          ) : (
            <>
              <ChartPanel title="漏斗形态" description="宽度代表达到该步骤的用户规模">
                <ReactECharts option={option} style={{ height: 388 }} />
              </ChartPanel>
              <ChartPanel title="步骤明细" description="整体转化率以首步用户数为基准">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>步骤</TableHead>
                        <TableHead className="text-right">用户数</TableHead>
                        <TableHead className="text-right">转化率</TableHead>
                        <TableHead className="text-right">相对上一步流失</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.map((step, index) => (
                        <TableRow key={step.event}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
                                {index + 1}
                              </span>
                              <span className="font-medium">{step.event}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono">{step.users.toLocaleString()}</TableCell>
                          <TableCell className="text-right">
                            <span className="font-mono">{(step.conversion * 100).toFixed(2)}%</span>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {index === 0 ? "—" : `${(step.dropoff * 100).toFixed(2)}%`}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </ChartPanel>
              {breakdownProperty && breakdown.length > 0 ? (
                <ChartPanel
                  title={`按 ${breakdownProperty} 分组对比`}
                  description={`同步计算每个取值下的步骤转化率，用于定位哪个人群进入路径后表现更好。${breakdownTruncated ? " 当前仅展示起始用户最多的 12 个取值，其余已合并为“其他”。" : ""}`}
                >
                  <div className="overflow-x-auto">
                    <Table className="min-w-[640px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="min-w-[160px]">{breakdownProperty}</TableHead>
                          <TableHead className="text-right">起始用户</TableHead>
                          <TableHead className="text-right">最终转化率</TableHead>
                          {events.map((ev, idx) => (
                            <TableHead key={ev} className="text-right whitespace-nowrap">
                              S{idx + 1} {ev}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {breakdown.map((row) => (
                          <TableRow key={row.raw}>
                            <TableCell className="font-medium">{row.label || "(空)"}</TableCell>
                            <TableCell className="text-right font-mono">{row.users.toLocaleString()}</TableCell>
                            <TableCell className="text-right font-mono">{(row.conversion * 100).toFixed(2)}%</TableCell>
                            {row.steps.map((step) => (
                              <TableCell key={step.event} className="text-right font-mono">
                                {step.users.toLocaleString()}
                                <span className="ml-1 text-muted-foreground">
                                  {(step.conversion * 100).toFixed(1)}%
                                </span>
                              </TableCell>
                            ))}
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
    </div>
  );
}
