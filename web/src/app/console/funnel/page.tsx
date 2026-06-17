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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { useProjectStore } from "@/stores/project-store";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

interface Step {
  event: string;
  users: number;
  conversion: number;
}

export default function FunnelPage() {
  const projectId = useProjectStore((s) => s.projectId);
  const [events, setEvents] = useState<string[]>([]);
  const [windowSeconds, setWindowSeconds] = useState<number>(24 * 3600);
  const [range, setRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(7, "day").startOf("day"),
    dayjs().endOf("day"),
  ]);
  const [result, setResult] = useState<Step[]>([]);
  const [error, setError] = useState("");

  // 切换项目时重置
  useEffect(() => {
    setEvents([]);
    setResult([]);
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

  const runMut = useMutation({
    mutationFn: () =>
      api.funnel(projectId!, {
        events,
        from: range[0].valueOf(),
        to: range[1].valueOf(),
        window_seconds: windowSeconds,
      }),
    onSuccess: (res) => {
      setError("");
      setResult(res.data.steps);
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
    </div>
  );
}
