"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import dayjs, { Dayjs } from "dayjs";
import { Filter, Play, Plus, RotateCcw, X } from "lucide-react";
import {
  AnalyticsHeader,
  ChartPanel,
  DateTimeRange,
  EmptyAnalysis,
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
import { api, QueryDimension, QueryFilter } from "@/lib/api";
import { cn } from "@/lib/utils";

type DraftFilter = {
  id: string;
  event: string;
  property: string;
  op: "eq" | "neq" | "exists";
  value: string;
};

export default function QueryBuilderPage() {
  const [projectId, setProjectId] = useState<number | undefined>();
  const [range, setRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(7, "day").startOf("day"),
    dayjs().endOf("day"),
  ]);
  const [events, setEvents] = useState<string[]>([]);
  const [dimensions, setDimensions] = useState<QueryDimension[]>([{ type: "event", key: "event" }]);
  const [filters, setFilters] = useState<DraftFilter[]>([
    { id: crypto.randomUUID(), event: "", property: "", op: "eq", value: "" },
  ]);

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects(),
  });

  useEffect(() => {
    if (!projectId && projects?.data?.length) setProjectId(projects.data[0].id);
  }, [projects, projectId]);

  const tsRange = useMemo(() => ({ from: range[0].valueOf(), to: range[1].valueOf() }), [range]);

  const top = useQuery({
    queryKey: ["query_top_events", projectId, tsRange],
    queryFn: () => api.topEvents(projectId!, { ...tsRange, limit: 80 }),
    enabled: !!projectId,
  });

  const props = useQuery({
    queryKey: ["query_properties", projectId],
    queryFn: () => api.listProperties(projectId!, { scope: "event" }),
    enabled: !!projectId,
  });

  const eventRows = top.data?.data || [];
  const propertyRows = props.data?.data || [];

  const query = useMutation({
    mutationFn: () =>
      api.queryTable(projectId!, {
        events,
        ...tsRange,
        limit: 200,
        dimensions,
        filters: filters
          .filter((item) => item.property || item.event)
          .map<QueryFilter>((item) => ({
            event: item.event || undefined,
            property: item.property || undefined,
            op: item.op,
            value: item.op === "exists" ? undefined : item.value,
          })),
      }),
  });

  const rows = query.data?.data.rows || [];
  const selectedEventLabel = events.length ? `${events.length} 个事件` : "全部事件";

  function toggleEvent(event: string) {
    setEvents((current) =>
      current.includes(event) ? current.filter((item) => item !== event) : [...current, event],
    );
  }

  function toggleDimension(dim: QueryDimension) {
    const key = `${dim.type}:${dim.key}`;
    setDimensions((current) => {
      const exists = current.some((item) => `${item.type}:${item.key}` === key);
      if (exists) {
        const next = current.filter((item) => `${item.type}:${item.key}` !== key);
        return next.length ? next : [{ type: "event", key: "event" }];
      }
      if (current.length >= 6) return current;
      return [...current, dim];
    });
  }

  function updateFilter(id: string, patch: Partial<DraftFilter>) {
    setFilters((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  return (
    <div>
      <AnalyticsHeader
        title="自助查询"
        description="通过事件、参数条件和维度组合生成表格，用于排查埋点、验证用户路径和做运营分析。"
        action={<Badge variant="info" className="h-9 items-center gap-2"><Filter className="h-3.5 w-3.5" /> Query table</Badge>}
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
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="text-sm font-medium">事件集合</div>
                  <Badge variant="secondary">{selectedEventLabel}</Badge>
                </div>
                <div className="flex max-h-44 flex-wrap gap-2 overflow-y-auto rounded-md border bg-background p-2">
                  {eventRows.map((item) => (
                    <button
                      key={item.event}
                      type="button"
                      onClick={() => toggleEvent(item.event)}
                      className={cn(
                        "inline-flex h-8 items-center rounded-md border px-2.5 text-xs font-medium transition-colors hover:border-primary/40 hover:bg-accent",
                        events.includes(item.event) && "border-primary/50 bg-primary text-primary-foreground hover:bg-primary/90",
                      )}
                    >
                      {item.event}
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="grid gap-3 pt-4 sm:pt-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium">参数过滤</div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setFilters((current) => [...current, { id: crypto.randomUUID(), event: "", property: "", op: "eq", value: "" }])}
                >
                  <Plus className="h-4 w-4" />
                  条件
                </Button>
              </div>

              {filters.map((filter) => (
                <div key={filter.id} className="grid gap-2 rounded-md border bg-background p-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Select value={filter.event || "__all__"} onValueChange={(value) => updateFilter(filter.id, { event: value === "__all__" ? "" : value })}>
                      <SelectTrigger><SelectValue placeholder="适用事件" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">全部事件</SelectItem>
                        {eventRows.map((item) => <SelectItem key={item.event} value={item.event}>{item.event}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={filter.property || undefined} onValueChange={(value) => updateFilter(filter.id, { property: value })}>
                      <SelectTrigger><SelectValue placeholder="参数 key" /></SelectTrigger>
                      <SelectContent>
                        {propertyRows.map((item) => <SelectItem key={item.id} value={item.name}>{item.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[130px_1fr_36px]">
                    <Select value={filter.op} onValueChange={(value) => updateFilter(filter.id, { op: value as DraftFilter["op"] })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="eq">等于</SelectItem>
                        <SelectItem value="neq">不等于</SelectItem>
                        <SelectItem value="exists">存在</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      value={filter.value}
                      disabled={filter.op === "exists"}
                      onChange={(event) => updateFilter(filter.id, { value: event.target.value })}
                      placeholder="参数 value，例如 上海 / 99 / true"
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => setFilters((current) => current.filter((item) => item.id !== filter.id))}
                      aria-label="删除条件"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="grid gap-3 pt-4 sm:pt-4">
              <div className="text-sm font-medium">表格维度</div>
              <div className="flex flex-wrap gap-2">
                <DimensionButton
                  active={dimensions.some((item) => item.type === "event")}
                  label="事件名"
                  onClick={() => toggleDimension({ type: "event", key: "event" })}
                />
                {propertyRows.slice(0, 24).map((item) => (
                  <DimensionButton
                    key={item.id}
                    active={dimensions.some((dim) => dim.type === "property" && dim.key === item.name)}
                    label={item.name}
                    onClick={() => toggleDimension({ type: "property", key: item.name })}
                  />
                ))}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="button" disabled={!projectId || query.isPending} onClick={() => query.mutate()}>
                  <Play className="h-4 w-4" />
                  {query.isPending ? "查询中" : "生成表格"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEvents([]);
                    setDimensions([{ type: "event", key: "event" }]);
                    setFilters([{ id: crypto.randomUUID(), event: "", property: "", op: "eq", value: "" }]);
                    query.reset();
                  }}
                >
                  <RotateCcw className="h-4 w-4" />
                  重置
                </Button>
              </div>
              {query.error ? <Badge variant="danger" className="items-center">{String(query.error.message || query.error)}</Badge> : null}
            </CardContent>
          </Card>
        </div>

        <ChartPanel title="查询结果" description="按所选维度聚合，指标为事件次数和去重用户数" contentClassName="p-0 sm:p-0">
          {rows.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {query.data?.data.dimensions.map((dim) => (
                      <TableHead key={`${dim.type}:${dim.key}`}>{dim.type === "event" ? "事件" : dim.key}</TableHead>
                    ))}
                    <TableHead className="text-right">次数</TableHead>
                    <TableHead className="text-right">用户</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, index) => (
                    <TableRow key={index}>
                      {row.dimensions.map((dim) => (
                        <TableCell key={`${index}:${dim.type}:${dim.key}`} className="max-w-[260px] truncate font-medium">
                          {dim.label}
                        </TableCell>
                      ))}
                      <TableCell className="text-right font-mono">{row.count.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono">{row.users.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <EmptyAnalysis title="暂无查询结果" description="选择事件、参数过滤和维度后点击生成表格。" />
          )}
        </ChartPanel>
      </div>
    </div>
  );
}

function DimensionButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center rounded-md border bg-background px-2.5 text-xs font-medium transition-colors hover:border-primary/40 hover:bg-accent",
        active && "border-primary/50 bg-primary text-primary-foreground hover:bg-primary/90",
      )}
    >
      {label}
    </button>
  );
}
