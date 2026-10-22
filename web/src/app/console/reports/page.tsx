"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs, { Dayjs } from "dayjs";
import { Bookmark, Play, Plus, Star, Trash2 } from "lucide-react";
import { AnalyticsHeader, ChartPanel, DateTimeRange, EmptyAnalysis } from "@/features/analytics/analytics-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, CohortTableRow, QueryDimension, QueryTableRow, QueryTemplate } from "@/lib/api";
import { useProjectStore } from "@/stores/project-store";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

type DimensionKind = "day" | "hour" | "event" | "property";
type ChartKind = "table" | "line" | "bar";
type FormulaColumn = { id: string; label: string; expression: string };
type ReportMode = "standard" | "cohort";
type CohortConfig = {
  cohortEvent: string;
  cohortProperty: string;
  cohortValue: string;
  metricEvent: string;
  offsets: number[];
};

type ReportConfig = {
  kind: "custom_report_v1";
  mode: ReportMode;
  from: number;
  to: number;
  events: string[];
  dimension: DimensionKind;
  property: string;
  chart: ChartKind;
  showCount: boolean;
  showUsers: boolean;
  formulas: FormulaColumn[];
  cohort: CohortConfig;
  shortcut: boolean;
};

const defaultConfig = (): ReportConfig => ({
  kind: "custom_report_v1",
  mode: "standard",
  from: dayjs().subtract(7, "day").startOf("day").valueOf(),
  to: dayjs().endOf("day").valueOf(),
  events: [],
  dimension: "day",
  property: "",
  chart: "table",
  showCount: true,
  showUsers: true,
  formulas: [{ id: "per_user", label: "人均事件次数", expression: "count / users" }],
  cohort: { cohortEvent: "$AppStart", cohortProperty: "$is_first_day", cohortValue: "true", metricEvent: "ad_show", offsets: [0, 1] },
  shortcut: false,
});

function metricFormula(expression: string, variables: Record<string, number>): number | null {
  const tokens = expression.match(/[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[()+\-*/]/g);
  if (!tokens || tokens.join("") !== expression.replace(/\s+/g, "")) return null;
  let cursor = 0;
  const primary = (): number => {
    const token = tokens[cursor++];
    if (token === "(") {
      const result = sum();
      if (tokens[cursor++] !== ")") throw new Error("missing parenthesis");
      return result;
    }
    if (token in variables) return variables[token];
    const parsed = Number(token);
    if (Number.isFinite(parsed)) return parsed;
    throw new Error("invalid token");
  };
  const product = (): number => {
    let value = primary();
    while (tokens[cursor] === "*" || tokens[cursor] === "/") {
      const op = tokens[cursor++];
      const right = primary();
      value = op === "*" ? value * right : right === 0 ? 0 : value / right;
    }
    return value;
  };
  const sum = (): number => {
    let value = product();
    while (tokens[cursor] === "+" || tokens[cursor] === "-") {
      const op = tokens[cursor++];
      const right = product();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  };
  try {
    const result = sum();
    return cursor === tokens.length && Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

function toDimension(config: ReportConfig): QueryDimension {
  if (config.dimension === "day" || config.dimension === "hour") return { type: "time", key: config.dimension };
  if (config.dimension === "property") return { type: "property", key: config.property };
  return { type: "event", key: "event" };
}

function dimensionLabel(kind: DimensionKind, property: string) {
  if (kind === "day") return "日期";
  if (kind === "hour") return "小时";
  if (kind === "property") return property || "参数";
  return "事件";
}

function cohortFormulaValues(row: CohortTableRow): Record<string, number> {
  const values: Record<string, number> = { cohort_users: row.users };
  row.values.forEach((value) => {
    values[`d${value.offset}_count`] = value.count;
    values[`d${value.offset}_users`] = value.users;
  });
  return values;
}

export default function CustomReportsPage() {
  const projectId = useProjectStore((s) => s.projectId);
  const qc = useQueryClient();
  const [config, setConfig] = useState<ReportConfig>(defaultConfig);
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs(config.from), dayjs(config.to)]);
  const [name, setName] = useState("");

  const top = useQuery({
    queryKey: ["custom_report_events", projectId, range],
    queryFn: () => api.topEvents(projectId!, { from: range[0].valueOf(), to: range[1].valueOf(), limit: 100 }),
    enabled: !!projectId,
  });
  const properties = useQuery({
    queryKey: ["custom_report_properties", projectId],
    queryFn: () => api.listProperties(projectId!, { scope: "event" }),
    enabled: !!projectId,
  });
  const reports = useQuery({
    queryKey: ["custom_reports", projectId],
    queryFn: () => api.listQueryTemplates(projectId!),
    enabled: !!projectId,
  });

  const query = useMutation({
    mutationFn: () => api.queryTable(projectId!, {
      events: config.events,
      from: range[0].valueOf(),
      to: range[1].valueOf(),
      limit: 500,
      dimensions: [toDimension(config)],
      filters: [],
    }),
  });
  const cohortQuery = useMutation({
    mutationFn: () => api.cohortTable(projectId!, {
      cohort_event: config.cohort.cohortEvent,
      cohort_property: config.cohort.cohortProperty || undefined,
      cohort_value: config.cohort.cohortValue,
      metric_event: config.cohort.metricEvent,
      from: range[0].valueOf(),
      to: range[1].valueOf(),
      offsets: config.cohort.offsets,
    }),
  });
  const save = useMutation({
    mutationFn: () => api.createQueryTemplate(projectId!, {
      name: name.trim(),
      config: { ...config, from: range[0].valueOf(), to: range[1].valueOf() },
    }),
    onSuccess: () => {
      setName("");
      void qc.invalidateQueries({ queryKey: ["custom_reports", projectId] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.deleteQueryTemplate(projectId!, id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["custom_reports", projectId] }),
  });

  useEffect(() => {
    setConfig((current) => ({ ...current, from: range[0].valueOf(), to: range[1].valueOf() }));
  }, [range]);

  const rows = query.data?.data.rows || [];
  const cohortRows = cohortQuery.data?.data.rows || [];
  const reportTemplates = (reports.data?.data || []).filter((item) => (item.config as Partial<ReportConfig>).kind === "custom_report_v1");
  const shortcuts = reportTemplates.filter((item) => (item.config as Partial<ReportConfig>).shortcut);
  const formulaColumns = config.formulas.filter((formula) => formula.expression.trim().length > 0);
  const isCohort = config.mode === "cohort";
  const firstFormulaValues = isCohort && cohortRows.length ? cohortFormulaValues(cohortRows[0]) : rows.length ? { count: rows[0].count, users: rows[0].users } : {};
  const chartOption = useMemo(() => ({
    tooltip: { trigger: "axis" },
    legend: { bottom: 0 },
    grid: { left: 48, right: 24, top: 28, bottom: 48 },
    xAxis: { type: "category", data: isCohort ? cohortRows.map((row) => row.cohort) : rows.map((row) => row.dimensions[0]?.label || "-") },
    yAxis: { type: "value" },
    series: [
      ...(isCohort
        ? [
            { name: "新增用户", type: config.chart, data: cohortRows.map((row) => row.users) },
            ...config.cohort.offsets.map((offset) => ({ name: `${config.cohort.metricEvent} Day${offset} 次数`, type: config.chart, data: cohortRows.map((row) => cohortFormulaValues(row)[`d${offset}_count`] || 0) })),
            ...formulaColumns.map((formula) => ({ name: formula.label || "公式", type: config.chart, data: cohortRows.map((row) => metricFormula(formula.expression, cohortFormulaValues(row)) ?? 0) })),
          ]
        : [
            ...(config.showCount ? [{ name: "事件次数", type: config.chart, data: rows.map((row) => row.count) }] : []),
            ...(config.showUsers ? [{ name: "去重用户", type: config.chart, data: rows.map((row) => row.users) }] : []),
            ...formulaColumns.map((formula) => ({ name: formula.label || "公式", type: config.chart, data: rows.map((row) => metricFormula(formula.expression, { count: row.count, users: row.users }) ?? 0) })),
          ]),
    ],
  }), [rows, cohortRows, config, isCohort]);

  function patch(patchValue: Partial<ReportConfig>) {
    setConfig((current) => ({ ...current, ...patchValue }));
  }
  function toggleEvent(event: string) {
    patch({ events: config.events.includes(event) ? config.events.filter((item) => item !== event) : [...config.events, event] });
  }
  function patchFormula(id: string, value: Partial<FormulaColumn>) {
    patch({ formulas: config.formulas.map((formula) => formula.id === id ? { ...formula, ...value } : formula) });
  }
  function patchCohort(value: Partial<CohortConfig>) {
    patch({ cohort: { ...config.cohort, ...value } });
  }
  function changeMode(mode: ReportMode) {
    patch({
      mode,
      formulas: mode === "cohort"
        ? [{ id: "cohort_per_user", label: "人均事件次数（当天）", expression: "d0_count / cohort_users" }]
        : config.formulas,
    });
  }
  function runReport() {
    if (isCohort) cohortQuery.mutate();
    else query.mutate();
  }
  function apply(template: QueryTemplate) {
    const next = template.config as Partial<ReportConfig>;
    if (next.kind !== "custom_report_v1") return;
    const safe = { ...defaultConfig(), ...next };
    setConfig(safe);
    setRange([dayjs(safe.from), dayjs(safe.to)]);
    setName(template.name);
  }

  return (
    <div>
      <AnalyticsHeader title="自定义报表" description="组合维度、指标和受控公式，生成可保存的表格、折线图或柱状图。" />
      {shortcuts.length ? <div className="mb-5 flex flex-wrap gap-2">{shortcuts.map((item) => <Button key={item.id} variant="outline" size="sm" onClick={() => apply(item)}><Star className="h-3.5 w-3.5" />{item.name}</Button>)}</div> : null}
      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="grid content-start gap-5">
          <Card><CardContent className="grid gap-4 pt-5 sm:pt-5">
            <DateTimeRange value={range} onChange={setRange} stacked />
            <div className="grid gap-2"><span className="text-sm font-medium">分析方式</span><Select value={config.mode} onValueChange={(value) => changeMode(value as ReportMode)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="standard">普通事件分析</SelectItem><SelectItem value="cohort">新增用户 cohort</SelectItem></SelectContent></Select></div>
            {isCohort ? <CohortControls config={config.cohort} events={top.data?.data || []} onChange={patchCohort} /> : <>
              <div><div className="mb-2 text-sm font-medium">事件集合</div><div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto rounded-md border p-2">{(top.data?.data || []).map((item) => <button key={item.event} type="button" onClick={() => toggleEvent(item.event)} className={`rounded-md border px-2 py-1 text-xs ${config.events.includes(item.event) ? "border-primary bg-primary text-primary-foreground" : "bg-background"}`}>{item.event}</button>)}</div></div>
              <div className="grid gap-2"><span className="text-sm font-medium">表头维度</span><Select value={config.dimension} onValueChange={(value) => patch({ dimension: value as DimensionKind })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="day">按天</SelectItem><SelectItem value="hour">按小时</SelectItem><SelectItem value="event">事件名</SelectItem><SelectItem value="property">事件参数</SelectItem></SelectContent></Select>{config.dimension === "property" ? <Select value={config.property} onValueChange={(value) => patch({ property: value })}><SelectTrigger><SelectValue placeholder="选择参数" /></SelectTrigger><SelectContent>{(properties.data?.data || []).map((item) => <SelectItem key={item.id} value={item.name}>{item.name}</SelectItem>)}</SelectContent></Select> : null}</div>
            </>}
          </CardContent></Card>
          <Card><CardContent className="grid gap-3 pt-4"><div className="text-sm font-medium">指标列</div>{!isCohort ? <><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.showCount} onChange={(event) => patch({ showCount: event.target.checked })} />事件次数</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.showUsers} onChange={(event) => patch({ showUsers: event.target.checked })} />去重用户</label></> : <p className="text-sm text-muted-foreground">固定展示新增用户、各 Day 的事件次数与触发人数。</p>}{config.formulas.map((formula) => <div key={formula.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2"><Input value={formula.label} onChange={(event) => patchFormula(formula.id, { label: event.target.value })} placeholder="列名称，例如 人均展示" /><Input value={formula.expression} onChange={(event) => patchFormula(formula.id, { expression: event.target.value })} placeholder={isCohort ? "例如 d0_count / cohort_users" : "例如 count / users"} /><Button size="icon" variant="ghost" disabled={config.formulas.length === 1} onClick={() => patch({ formulas: config.formulas.filter((item) => item.id !== formula.id) })} aria-label="删除公式列"><Trash2 className="h-4 w-4" /></Button></div>)}<Button variant="outline" size="sm" className="w-fit" onClick={() => patch({ formulas: [...config.formulas, { id: `formula_${Date.now()}`, label: "新公式", expression: "" }] })}><Plus className="h-4 w-4" />新增公式列</Button><p className="text-xs text-muted-foreground">{isCohort ? <>可用 <code>cohort_users</code>、<code>d0_count</code>、<code>d0_users</code>、<code>d1_count</code>；DayN 对应 <code>dN_count</code>、<code>dN_users</code>。</> : <>支持 <code>count</code>、<code>users</code>、数字、<code>+ - * / ()</code>。</>}</p>{formulaColumns.some((formula) => Object.keys(firstFormulaValues).length > 0 && metricFormula(formula.expression, firstFormulaValues) === null) ? <Badge variant="danger">存在无效公式</Badge> : null}</CardContent></Card>
          <Card><CardContent className="grid gap-3 pt-4"><div className="text-sm font-medium">展示与保存</div><Select value={config.chart} onValueChange={(value) => patch({ chart: value as ChartKind })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="table">表格</SelectItem><SelectItem value="line">折线图</SelectItem><SelectItem value="bar">柱状图</SelectItem></SelectContent></Select><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.shortcut} onChange={(event) => patch({ shortcut: event.target.checked })} />设为快捷报表</label><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="报表名称" /><div className="flex gap-2"><Button disabled={!projectId || query.isPending || cohortQuery.isPending || (!isCohort && config.dimension === "property" && !config.property) || (isCohort && (!config.cohort.cohortEvent || !config.cohort.metricEvent))} onClick={runReport}><Play className="h-4 w-4" />运行</Button><Button variant="outline" disabled={!projectId || !name.trim() || save.isPending} onClick={() => save.mutate()}><Bookmark className="h-4 w-4" />保存</Button></div>{(isCohort ? cohortQuery.error : query.error) ? <Badge variant="danger">{String(isCohort ? cohortQuery.error : query.error)}</Badge> : null}</CardContent></Card>
        </div>
        <div className="grid content-start gap-5">
          <ChartPanel title="报表结果" description={isCohort ? `新增用户：${config.cohort.cohortEvent} · 统计：${config.cohort.metricEvent}` : `${dimensionLabel(config.dimension, config.property)} · ${config.events.length ? `${config.events.length} 个事件` : "全部事件"}`} contentClassName="p-0 sm:p-0">
            {!(isCohort ? cohortRows.length : rows.length) ? <EmptyAnalysis className="min-h-72" title="尚未生成报表" description="配置维度与指标后点击运行。" /> : config.chart === "table" ? isCohort ? <CohortReportTable rows={cohortRows} config={config} /> : <ReportTable rows={rows} config={config} /> : <ReactECharts option={chartOption} style={{ height: 430 }} />}
          </ChartPanel>
          <ChartPanel title="我的报表" description="保存后可复用；勾选快捷报表会显示在本页顶部。" contentClassName="p-0 sm:p-0">{reportTemplates.length ? <div className="divide-y">{reportTemplates.map((item) => <div key={item.id} className="flex items-center gap-3 p-3"><button className="min-w-0 flex-1 text-left" onClick={() => apply(item)}><div className="truncate text-sm font-medium">{item.name}</div><div className="text-xs text-muted-foreground">{(item.config as Partial<ReportConfig>).shortcut ? "快捷报表" : "已保存报表"}</div></button><Button size="icon" variant="ghost" onClick={() => remove.mutate(item.id)} aria-label="删除报表"><Trash2 className="h-4 w-4" /></Button></div>)}</div> : <EmptyAnalysis className="min-h-28" title="暂无保存报表" description="配置后输入名称并保存。" />}</ChartPanel>
        </div>
      </div>
    </div>
  );
}

function CohortControls({ config, events, onChange }: { config: CohortConfig; events: { event: string }[]; onChange: (value: Partial<CohortConfig>) => void }) {
  const eventNames = Array.from(new Set(["$AppStart", ...events.map((event) => event.event)]));
  function toggleOffset(offset: number) {
    const offsets = config.offsets.includes(offset) ? config.offsets.filter((item) => item !== offset) : [...config.offsets, offset].sort((a, b) => a - b);
    if (offsets.length) onChange({ offsets });
  }
  return <div className="grid gap-3 rounded-md border bg-muted/20 p-3"><p className="text-sm text-muted-foreground">先用首日事件圈定新增用户，再只统计这些用户后续触发的目标事件。</p><div className="grid gap-2"><span className="text-sm font-medium">新增用户事件</span><Select value={config.cohortEvent} onValueChange={(value) => onChange({ cohortEvent: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{eventNames.map((event) => <SelectItem key={event} value={event}>{event}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-2"><span className="text-sm font-medium">新增用户条件</span><div className="grid grid-cols-2 gap-2"><Input value={config.cohortProperty} onChange={(event) => onChange({ cohortProperty: event.target.value })} placeholder="参数名，例如 $is_first_day" /><Input value={config.cohortValue} onChange={(event) => onChange({ cohortValue: event.target.value })} placeholder="参数值，例如 true" /></div></div><div className="grid gap-2"><span className="text-sm font-medium">统计事件</span><Select value={config.metricEvent} onValueChange={(value) => onChange({ metricEvent: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{eventNames.map((event) => <SelectItem key={event} value={event}>{event}</SelectItem>)}</SelectContent></Select></div><div><div className="mb-2 text-sm font-medium">观察日</div><div className="flex flex-wrap gap-2">{[0, 1, 2, 3, 7].map((offset) => <Button key={offset} type="button" size="sm" variant={config.offsets.includes(offset) ? "default" : "outline"} onClick={() => toggleOffset(offset)}>Day{offset}</Button>)}</div></div></div>;
}

function ReportTable({ rows, config }: { rows: QueryTableRow[]; config: ReportConfig }) {
  const formulas = config.formulas.filter((formula) => formula.expression.trim());
  return <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>{dimensionLabel(config.dimension, config.property)}</TableHead>{config.showCount ? <TableHead className="text-right">事件次数</TableHead> : null}{config.showUsers ? <TableHead className="text-right">去重用户</TableHead> : null}{formulas.map((formula) => <TableHead key={formula.id} className="text-right">{formula.label || "公式"}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map((row, index) => <TableRow key={index}><TableCell>{row.dimensions[0]?.label || "-"}</TableCell>{config.showCount ? <TableCell className="text-right font-mono">{row.count.toLocaleString()}</TableCell> : null}{config.showUsers ? <TableCell className="text-right font-mono">{row.users.toLocaleString()}</TableCell> : null}{formulas.map((formula) => <TableCell key={formula.id} className="text-right font-mono">{(metricFormula(formula.expression, { count: row.count, users: row.users }) ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>)}</TableRow>)}</TableBody></Table></div>;
}

function CohortReportTable({ rows, config }: { rows: CohortTableRow[]; config: ReportConfig }) {
  const formulas = config.formulas.filter((formula) => formula.expression.trim());
  return <div className="overflow-x-auto"><Table className="min-w-[880px]"><TableHeader><TableRow><TableHead>新增日期</TableHead><TableHead className="text-right">新增用户</TableHead>{config.cohort.offsets.map((offset) => <TableHead key={`count-${offset}`} className="text-right">{config.cohort.metricEvent} Day{offset} 次数</TableHead>)}{config.cohort.offsets.map((offset) => <TableHead key={`users-${offset}`} className="text-right">Day{offset} 触发人数</TableHead>)}{formulas.map((formula) => <TableHead key={formula.id} className="text-right">{formula.label || "公式"}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map((row) => { const values = cohortFormulaValues(row); return <TableRow key={row.cohort}><TableCell>{row.cohort}</TableCell><TableCell className="text-right font-mono">{row.users.toLocaleString()}</TableCell>{config.cohort.offsets.map((offset) => <TableCell key={`count-${offset}`} className="text-right font-mono">{(values[`d${offset}_count`] || 0).toLocaleString()}</TableCell>)}{config.cohort.offsets.map((offset) => <TableCell key={`users-${offset}`} className="text-right font-mono">{(values[`d${offset}_users`] || 0).toLocaleString()}</TableCell>)}{formulas.map((formula) => <TableCell key={formula.id} className="text-right font-mono">{(metricFormula(formula.expression, values) ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>)}</TableRow>; })}</TableBody></Table></div>;
}
