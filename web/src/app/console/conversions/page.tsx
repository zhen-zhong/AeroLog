"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import dayjs, { Dayjs } from "dayjs";
import { BadgeCheck, Flag, TrendingUp } from "lucide-react";
import {
  AnalyticsHeader,
  ChartPanel,
  EmptyAnalysis,
  MetricTile,
  ReportControls,
} from "@/features/analytics/analytics-ui";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";

const DEFAULT_FUNNEL = ["search", "view_product", "pay_success"];
const CONVERSION_HINTS = ["pay", "success", "signup", "checkout", "subscribe", "purchase", "order"];

export default function ConversionsPage() {
  const [projectId, setProjectId] = useState<number | undefined>();
  const [range, setRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(7, "day").startOf("day"),
    dayjs().endOf("day"),
  ]);

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects(),
  });

  useEffect(() => {
    if (!projectId && projects?.data?.length) setProjectId(projects.data[0].id);
  }, [projects, projectId]);

  const tsRange = useMemo(() => ({ from: range[0].valueOf(), to: range[1].valueOf() }), [range]);

  const { data: top, isLoading: topLoading } = useQuery({
    queryKey: ["conversion_top", projectId, tsRange],
    queryFn: () => api.topEvents(projectId!, { ...tsRange, limit: 100 }),
    enabled: !!projectId,
  });

  const rows = top?.data || [];
  const conversionRows = rows.filter((item) => {
    const name = item.event.toLowerCase();
    return CONVERSION_HINTS.some((hint) => name.includes(hint));
  });
  const baseUsers = rows[0]?.users || 0;

  const funnelEvents = DEFAULT_FUNNEL.filter((event) => rows.some((item) => item.event === event));
  const funnel = useQuery({
    queryKey: ["conversion_funnel", projectId, tsRange, funnelEvents],
    queryFn: () =>
      api.funnel(projectId!, {
        events: funnelEvents,
        ...tsRange,
        window_seconds: 7 * 24 * 3600,
      }),
    enabled: !!projectId && funnelEvents.length >= 2,
  });

  const funnelSteps = funnel.data?.data.steps || [];
  const convertedUsers = conversionRows.reduce((sum, item) => sum + item.users, 0);
  const avgConversion = baseUsers ? Math.round((convertedUsers / baseUsers) * 10000) / 100 : 0;

  return (
    <div>
      <AnalyticsHeader
        title="转化"
        description="把注册、结账、支付等关键结果事件集中观察，并给出默认路径的转化漏斗。"
        action={<Badge variant="info" className="h-9 items-center gap-2"><Flag className="h-3.5 w-3.5" /> Key events</Badge>}
      />

      <ReportControls
        projects={projects?.data || []}
        projectId={projectId}
        onProjectChange={setProjectId}
        range={range}
        onRangeChange={setRange}
        comparison="上个周期"
        filters={["关键事件自动识别"]}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <MetricTile label="关键事件数" value={conversionRows.length} loading={topLoading} />
        <MetricTile label="转化用户信号" value={convertedUsers} loading={topLoading} />
        <MetricTile label="相对转化率" value={avgConversion} hint="基于最高活跃事件用户" loading={topLoading} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <ChartPanel title="关键事件" description="按命名启发式识别 pay/success/signup/checkout 等事件">
          {conversionRows.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>事件</TableHead>
                    <TableHead className="text-right">次数</TableHead>
                    <TableHead className="text-right">用户</TableHead>
                    <TableHead className="text-right">相对转化率</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {conversionRows.map((item) => {
                    const rate = baseUsers ? (item.users / baseUsers) * 100 : 0;
                    return (
                      <TableRow key={item.event}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <BadgeCheck className="h-4 w-4 text-primary" />
                            <span className="font-medium">{item.event}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono">{item.count.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-mono">{item.users.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-mono">{rate.toFixed(2)}%</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <EmptyAnalysis title="暂无关键事件" description="建议将支付、注册、提交等结果事件命名为 pay_success、signup、checkout_start 等。" />
          )}
        </ChartPanel>

        <ChartPanel
          title="默认转化路径"
          description={funnelEvents.length >= 2 ? funnelEvents.join(" → ") : "等待可用事件"}
          contentClassName="pt-3 sm:pt-3"
        >
          {funnelSteps.length ? (
            <div className="grid gap-4">
              {funnelSteps.map((step, index) => (
                <div key={step.event} className="rounded-md border bg-background p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
                        {index + 1}
                      </span>
                      <span className="truncate text-sm font-medium">{step.event}</span>
                    </div>
                    <span className="font-mono text-sm">{(step.conversion * 100).toFixed(1)}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-secondary">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, step.conversion * 100)}%` }} />
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">{step.users.toLocaleString()} 用户</div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyAnalysis title="暂无默认路径数据" description="当 search、view_product、pay_success 中至少两个事件存在时会自动生成。" />
          )}
        </ChartPanel>
      </div>

      <ChartPanel
        title="转化解释"
        description="当前为轻量启发式识别，后续可扩展为可配置的 Key Event 标记。"
        className="mt-5"
        contentClassName="pt-3 sm:pt-3"
      >
        <div className="grid gap-3 text-sm md:grid-cols-3 [&>*]:mt-0">
          <div className="rounded-md border bg-background p-3">
            <TrendingUp className="mb-2 h-4 w-4 text-primary" />
            <div className="font-medium">事件命名即治理入口</div>
            <p className="mt-1 text-muted-foreground">稳定命名会让转化报表、漏斗和字典治理自然衔接。</p>
          </div>
          <div className="rounded-md border bg-background p-3">
            <Flag className="mb-2 h-4 w-4 text-primary" />
            <div className="font-medium">关键事件可配置</div>
            <p className="mt-1 text-muted-foreground">下一步可在数据治理页给事件打 Key Event 标记。</p>
          </div>
          <div className="rounded-md border bg-background p-3">
            <BadgeCheck className="mb-2 h-4 w-4 text-primary" />
            <div className="font-medium">与用户画像联动</div>
            <p className="mt-1 text-muted-foreground">转化事件可沉淀为用户 Profile 或生命周期阶段。</p>
          </div>
        </div>
      </ChartPanel>
    </div>
  );
}
