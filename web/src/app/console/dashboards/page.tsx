"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import dayjs, { Dayjs } from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Responsive, WidthProvider, type Layout } from "react-grid-layout";
import {
  BarChart3,
  Bell,
  Copy,
  Gauge,
  GitBranch,
  GripVertical,
  LayoutDashboard,
  LineChart,
  Pencil,
  Plus,
  Save,
  Table2,
  Trash2,
} from "lucide-react";
import { AnalyticsHeader, DateTimeRange, EmptyAnalysis, EventCollectionPicker } from "@/features/analytics/analytics-ui";
import { coreReportTemplates } from "@/features/analytics/core-report-templates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  api,
  CohortTableRow,
  ConversionStep,
  Dashboard,
  DashboardAlertRule,
  DashboardAlertRuleInput,
  DashboardWidget,
  DashboardWidgetInput,
  DashboardWidgetType,
  QueryDimension,
  QueryTableRow,
  QueryTemplate,
} from "@/lib/api";
import { useProjectStore } from "@/stores/project-store";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });
const ResponsiveGridLayout = WidthProvider(Responsive);

type ReportFormula = { id: string; label: string; expression: string };
type ReportConfig = {
  kind?: string;
  mode?: "standard" | "cohort";
  events?: string[];
  segmentId?: number;
  dimension?: "day" | "hour" | "event" | "property";
  property?: string;
  chart?: "table" | "line" | "bar";
  showCount?: boolean;
  showUsers?: boolean;
  sumProperties?: string[];
  formulas?: ReportFormula[];
  cohort?: {
    cohortEvent?: string;
    cohortProperty?: string;
    cohortValue?: string;
    metricEvent?: string;
    offsets?: number[];
  };
};

type WidgetLayout = { x: number; y: number; w: number; h: number; minW?: number; minH?: number };
type StandardWidgetResult = { kind: "standard"; rows: QueryTableRow[]; config: ReportConfig };
type CohortWidgetResult = { kind: "cohort"; rows: CohortTableRow[]; config: ReportConfig };
type FunnelWidgetResult = { kind: "funnel"; steps: ConversionStep[] };
type WidgetResult = StandardWidgetResult | CohortWidgetResult | FunnelWidgetResult;
type MetricOption = { value: string; label: string };
type DashboardReportSource = {
  key: string;
  group: "核心模板" | "我的报表";
  name: string;
  description: string;
  config: ReportConfig;
  sourceType: "query_template" | "custom_report";
  sourceId?: number;
};

function defaultLayout(type: DashboardWidgetType, index: number): WidgetLayout {
  if (type === "metric") return { x: (index * 6) % 24, y: Math.floor(index / 4) * 5, w: 6, h: 5, minW: 4, minH: 4 };
  return { x: 0, y: index * 8, w: 12, h: type === "table" ? 9 : 8, minW: 6, minH: 5 };
}

function widgetLayout(widget: DashboardWidget, index: number): WidgetLayout {
  const fallback = defaultLayout(widget.widget_type, index);
  const raw = widget.layout_config as Partial<WidgetLayout>;
  return {
    x: Number.isFinite(raw.x) ? Number(raw.x) : fallback.x,
    y: Number.isFinite(raw.y) ? Number(raw.y) : fallback.y,
    w: Number.isFinite(raw.w) ? Math.max(2, Number(raw.w)) : fallback.w,
    h: Number.isFinite(raw.h) ? Math.max(3, Number(raw.h)) : fallback.h,
    minW: Number.isFinite(raw.minW) ? Number(raw.minW) : fallback.minW,
    minH: Number.isFinite(raw.minH) ? Number(raw.minH) : fallback.minH,
  };
}

function widgetInput(widget: DashboardWidget, layout?: WidgetLayout, patch?: Partial<DashboardWidgetInput>): DashboardWidgetInput {
  return {
    title: patch?.title ?? widget.title,
    widget_type: patch?.widget_type ?? widget.widget_type,
    source_type: patch?.source_type ?? widget.source_type,
    source_id: patch?.source_id ?? widget.source_id,
    query_config: patch?.query_config ?? widget.query_config,
    display_config: patch?.display_config ?? widget.display_config,
    layout_config: layout ?? widget.layout_config,
  };
}

function reportDimension(config: ReportConfig): QueryDimension {
  if (config.dimension === "hour" || config.dimension === "day") return { type: "time", key: config.dimension };
  if (config.dimension === "property") return { type: "property", key: config.property || "" };
  return { type: "event", key: "event" };
}

function formulaValue(expression: string, variables: Record<string, number>): number | null {
  const tokens = expression.match(/[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[()+\-*/]/g);
  if (!tokens || tokens.join("") !== expression.replace(/\s+/g, "")) return null;
  let cursor = 0;
  const primary = (): number => {
    const token = tokens[cursor++];
    if (token === "(") {
      const value = sum();
      if (tokens[cursor++] !== ")") throw new Error("missing parenthesis");
      return value;
    }
    if (token in variables) return variables[token];
    const value = Number(token);
    if (!Number.isFinite(value)) throw new Error("invalid token");
    return value;
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
    const value = sum();
    return cursor === tokens.length && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function standardVariables(row: QueryTableRow) {
  return { count: row.count, users: row.users, ...row.sums };
}

function cohortVariables(row: CohortTableRow) {
  const values: Record<string, number> = { cohort_users: row.users };
  row.values.forEach((item) => {
    values[`d${item.offset}_count`] = item.count;
    values[`d${item.offset}_users`] = item.users;
  });
  return values;
}

function metricOptions(config: ReportConfig): MetricOption[] {
  if (config.mode === "cohort") {
    return [
      { value: "cohort_users", label: "新增用户" },
      ...(config.cohort?.offsets || [0, 1]).flatMap((offset) => [
        { value: `d${offset}_count`, label: `Day${offset} 事件次数` },
        { value: `d${offset}_users`, label: `Day${offset} 去重用户` },
      ]),
      ...(config.formulas || []).filter((item) => item.expression).map((item) => ({ value: `formula:${item.id}`, label: item.label || "自定义公式" })),
    ];
  }
  return [
    ...(config.showCount !== false ? [{ value: "count", label: "事件次数" }] : []),
    ...(config.showUsers !== false ? [{ value: "users", label: "去重用户" }] : []),
    ...(config.sumProperties || []).map((property) => ({ value: `sum:${property}`, label: `${property} 总和` })),
    ...(config.formulas || []).filter((item) => item.expression).map((item) => ({ value: `formula:${item.id}`, label: item.label || "自定义公式" })),
  ];
}

function defaultMetric(config: ReportConfig) {
  return metricOptions(config)[0]?.value || (config.mode === "cohort" ? "cohort_users" : "count");
}

function metricDisplay(widget: DashboardWidget, result: StandardWidgetResult | CohortWidgetResult) {
  const requested = typeof widget.display_config.metric === "string" ? widget.display_config.metric : defaultMetric(result.config);
  const option = metricOptions(result.config).find((item) => item.value === requested) || metricOptions(result.config)[0];
  const key = option?.value || requested;
  const variables: Record<string, number> = {};
  for (const row of result.rows) {
    const current = result.kind === "cohort" ? cohortVariables(row as CohortTableRow) : standardVariables(row as QueryTableRow);
    for (const [name, value] of Object.entries(current)) variables[name] = (variables[name] || 0) + value;
  }
  if (key.startsWith("formula:")) {
    const formula = (result.config.formulas || []).find((item) => item.id === key.slice(8));
    return { label: option?.label || "自定义公式", value: formula ? formulaValue(formula.expression, variables) || 0 : 0 };
  }
  const variable = key.startsWith("sum:") ? key.slice(4) : key;
  return { label: option?.label || variable, value: variables[variable] || 0 };
}

function chartIcon(type: DashboardWidgetType) {
  if (type === "metric") return Gauge;
  if (type === "line") return LineChart;
  if (type === "bar") return BarChart3;
  if (type === "table") return Table2;
  if (type === "funnel") return GitBranch;
  return LayoutDashboard;
}

function defaultWidgetTitle(type: DashboardWidgetType) {
  if (type === "metric") return "指标卡";
  if (type === "line") return "折线图";
  if (type === "bar") return "柱状图";
  if (type === "table") return "表格";
  if (type === "funnel") return "转化漏斗";
  return "说明";
}

function dashboardRuleOperator(operator: DashboardAlertRule["operator"]) {
  if (operator === "gt") return ">";
  if (operator === "gte") return "≥";
  if (operator === "lt") return "<";
  return "≤";
}

function dashboardRuleInput(rule: DashboardAlertRule, enabled: boolean): DashboardAlertRuleInput {
  return {
    name: rule.name,
    metric: rule.metric,
    event: rule.event,
    operator: rule.operator,
    threshold: rule.threshold,
    window_minutes: rule.window_minutes,
    cooldown_minutes: rule.cooldown_minutes,
    enabled,
  };
}

export default function DashboardsPage() {
  const projectId = useProjectStore((state) => state.projectId);
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number>();
  const [editing, setEditing] = useState(false);
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().subtract(7, "day").startOf("day"), dayjs().endOf("day")]);
  const [createOpen, setCreateOpen] = useState(false);
  const [dashboardName, setDashboardName] = useState("");
  const [dashboardDescription, setDashboardDescription] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [monitoringOpen, setMonitoringOpen] = useState(false);
  const [subscriptionEnabled, setSubscriptionEnabled] = useState(false);
  const [subscriptionCadence, setSubscriptionCadence] = useState<"daily" | "weekly">("daily");
  const [subscriptionHour, setSubscriptionHour] = useState("9");
  const [subscriptionWeekday, setSubscriptionWeekday] = useState("1");
  const [ruleName, setRuleName] = useState("");
  const [ruleMetric, setRuleMetric] = useState<DashboardAlertRule["metric"]>("event_count");
  const [ruleEvent, setRuleEvent] = useState("__all__");
  const [ruleOperator, setRuleOperator] = useState<DashboardAlertRule["operator"]>("lt");
  const [ruleThreshold, setRuleThreshold] = useState("0");
  const [ruleWindow, setRuleWindow] = useState("60");
  const [ruleCooldown, setRuleCooldown] = useState("360");
  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<"report" | "funnel">("report");
  const [templateId, setTemplateId] = useState("");
  const [newWidgetType, setNewWidgetType] = useState<DashboardWidgetType>("line");
  const [newWidgetTitle, setNewWidgetTitle] = useState("");
  const [newMetric, setNewMetric] = useState("count");
  const [funnelEvents, setFunnelEvents] = useState<string[]>([]);
  const [editingWidget, setEditingWidget] = useState<DashboardWidget | null>(null);
  const [widgetTitle, setWidgetTitle] = useState("");
  const [widgetType, setWidgetType] = useState<DashboardWidgetType>("line");
  const [widgetMetric, setWidgetMetric] = useState("count");
  const [localLayouts, setLocalLayouts] = useState<Layout[]>([]);
  const [layoutDashboardId, setLayoutDashboardId] = useState<number>();

  const dashboards = useQuery({
    queryKey: ["dashboards", projectId],
    queryFn: () => api.listDashboards(projectId!),
    enabled: !!projectId,
  });
  const dashboard = useQuery({
    queryKey: ["dashboard", projectId, selectedId],
    queryFn: () => api.getDashboard(projectId!, selectedId!),
    enabled: !!projectId && !!selectedId,
  });
  const reports = useQuery({
    queryKey: ["dashboard_reports", projectId],
    queryFn: () => api.listQueryTemplates(projectId!),
    enabled: !!projectId,
  });
  const events = useQuery({
    queryKey: ["dashboard_events", projectId],
    queryFn: () => api.listEvents(projectId!),
    enabled: !!projectId,
  });
  const monitoring = useQuery({
    queryKey: ["dashboard_monitoring", projectId, selectedId],
    queryFn: () => api.getDashboardMonitoring(projectId!, selectedId!),
    enabled: !!projectId && !!selectedId,
  });

  const dashboardRows = dashboards.data?.data || [];
  const loadedDashboard = dashboard.data?.data;
  const selected = loadedDashboard?.id === selectedId ? loadedDashboard : undefined;
  const widgets = selected?.widgets || [];
  const dashboardLayouts = useMemo(
    () => widgets.map((widget, index) => ({ i: String(widget.id), ...widgetLayout(widget, index) })),
    [selected?.id, dashboard.dataUpdatedAt],
  );
  const activeLayouts = layoutDashboardId === selected?.id ? localLayouts : dashboardLayouts;
  const layoutByWidgetId = useMemo(
    () => new Map(activeLayouts.map((layout) => [layout.i, layout])),
    [activeLayouts],
  );
  const reportRows = useMemo<DashboardReportSource[]>(() => [
    ...coreReportTemplates().flatMap((item) => item.config ? [{
      key: `core:${item.id}`,
      group: "核心模板" as const,
      name: item.name,
      description: item.description,
      config: item.config as ReportConfig,
      sourceType: "custom_report" as const,
    }] : []),
    ...(reports.data?.data || [])
      .filter((item) => (item.config as ReportConfig).kind === "custom_report_v1")
      .map((item) => ({
        key: `saved:${item.id}`,
        group: "我的报表" as const,
        name: item.name,
        description: item.description || "已保存的自定义报表",
        config: item.config as ReportConfig,
        sourceType: "query_template" as const,
        sourceId: item.id,
      })),
  ], [reports.data]);
  const eventNames = events.data?.data.map((item) => item.name) || [];
  const selectedTemplate = reportRows.find((item) => item.key === templateId);
  const selectedTemplateConfig = selectedTemplate?.config;

  useEffect(() => {
    setSelectedId(undefined);
    setEditing(false);
    setMonitoringOpen(false);
  }, [projectId]);

  useEffect(() => {
    if (!monitoringOpen || !monitoring.data?.data.subscription) return;
    const item = monitoring.data.data.subscription;
    setSubscriptionEnabled(item.enabled);
    setSubscriptionCadence(item.cadence);
    setSubscriptionHour(String(item.send_hour));
    setSubscriptionWeekday(String(item.weekday));
  }, [monitoringOpen, monitoring.data]);

  useEffect(() => {
    if (!dashboardRows.length) {
      setSelectedId(undefined);
      return;
    }
    if (!selectedId || !dashboardRows.some((item) => item.id === selectedId)) setSelectedId(dashboardRows[0].id);
  }, [dashboardRows, selectedId]);

  useEffect(() => {
    if (!selected) return;
    setLocalLayouts(dashboardLayouts);
    setLayoutDashboardId(selected.id);
  }, [selected, dashboardLayouts]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["dashboards", projectId] });
    if (selectedId) void queryClient.invalidateQueries({ queryKey: ["dashboard", projectId, selectedId] });
  };

  const createDashboard = useMutation({
    mutationFn: () => api.createDashboard(projectId!, { name: dashboardName.trim(), description: dashboardDescription.trim(), global_config: {} }),
    onSuccess: (response) => {
      setCreateOpen(false);
      setDashboardName("");
      setDashboardDescription("");
      setSelectedId(response.data.id);
      setEditing(true);
      refresh();
    },
  });

  const updateDashboard = useMutation({
    mutationFn: () => api.updateDashboard(projectId!, selectedId!, {
      name: dashboardName.trim(),
      description: dashboardDescription.trim(),
      global_config: selected?.global_config || {},
      draft_config: selected?.draft_config || {},
      published_config: selected?.published_config || {},
    }),
    onSuccess: () => {
      setSettingsOpen(false);
      refresh();
    },
  });

  const deleteDashboard = useMutation({
    mutationFn: (id: number) => api.deleteDashboard(projectId!, id),
    onSuccess: () => {
      setSelectedId(undefined);
      refresh();
    },
  });

  const createWidget = useMutation({
    mutationFn: (body: DashboardWidgetInput) => api.createDashboardWidget(projectId!, selectedId!, body),
    onSuccess: () => {
      setAddOpen(false);
      setTemplateId("");
      setNewWidgetTitle("");
      setNewMetric("count");
      setFunnelEvents([]);
      refresh();
    },
  });

  const saveWidget = useMutation({
    mutationFn: ({ widget, body }: { widget: DashboardWidget; body: DashboardWidgetInput }) => api.updateDashboardWidget(projectId!, selectedId!, widget.id, body),
    onSuccess: () => {
      setEditingWidget(null);
      refresh();
    },
  });

  const deleteWidget = useMutation({
    mutationFn: (id: number) => api.deleteDashboardWidget(projectId!, selectedId!, id),
    onSuccess: refresh,
  });

  const copyWidget = useMutation({
    mutationFn: (id: number) => api.copyDashboardWidget(projectId!, selectedId!, id),
    onSuccess: refresh,
  });

  const refreshMonitoring = () => {
    void queryClient.invalidateQueries({ queryKey: ["dashboard_monitoring", projectId, selectedId] });
  };

  const saveSubscription = useMutation({
    mutationFn: () => api.updateDashboardSubscription(projectId!, selectedId!, {
      enabled: subscriptionEnabled,
      cadence: subscriptionCadence,
      send_hour: Number(subscriptionHour),
      weekday: Number(subscriptionWeekday),
    }),
    onSuccess: refreshMonitoring,
  });

  const createAlertRule = useMutation({
    mutationFn: () => api.createDashboardAlertRule(projectId!, selectedId!, {
      name: ruleName.trim(),
      metric: ruleMetric,
      event: ruleEvent === "__all__" ? "" : ruleEvent,
      operator: ruleOperator,
      threshold: Number(ruleThreshold),
      window_minutes: Number(ruleWindow),
      cooldown_minutes: Number(ruleCooldown),
      enabled: true,
    }),
    onSuccess: () => {
      setRuleName("");
      setRuleThreshold("0");
      refreshMonitoring();
    },
  });

  const updateAlertRule = useMutation({
    mutationFn: ({ rule, body }: { rule: DashboardAlertRule; body: DashboardAlertRuleInput }) =>
      api.updateDashboardAlertRule(projectId!, selectedId!, rule.id, body),
    onSuccess: refreshMonitoring,
  });

  const deleteAlertRule = useMutation({
    mutationFn: (ruleId: number) => api.deleteDashboardAlertRule(projectId!, selectedId!, ruleId),
    onSuccess: refreshMonitoring,
  });

  const saveLayouts = useMutation({
    mutationFn: async (layouts: Layout[]) => {
      const byID = new Map(layouts.map((item) => [Number(item.i), item]));
      await Promise.all(widgets.map((widget, index) => {
        const item = byID.get(widget.id);
        if (!item) return Promise.resolve();
        const current = widgetLayout(widget, index);
        const next = { x: item.x, y: item.y, w: item.w, h: item.h, minW: current.minW, minH: current.minH };
        return api.updateDashboardWidget(projectId!, selectedId!, widget.id, widgetInput(widget, next));
      }));
    },
    onSuccess: refresh,
  });

  function openSettings() {
    if (!selected) return;
    setDashboardName(selected.name);
    setDashboardDescription(selected.description);
    setSettingsOpen(true);
  }

  function openWidgetEditor(widget: DashboardWidget) {
    setEditingWidget(widget);
    setWidgetTitle(widget.title);
    setWidgetType(widget.widget_type);
    const config = widget.query_config as ReportConfig;
    setWidgetMetric(typeof widget.display_config.metric === "string" ? widget.display_config.metric : defaultMetric(config));
  }

  function addReportWidget() {
    const template = reportRows.find((item) => item.key === templateId);
    if (!template) return;
    const index = widgets.length;
    createWidget.mutate({
      title: newWidgetTitle.trim() || template.name,
      widget_type: newWidgetType,
      source_type: template.sourceType,
      source_id: template.sourceId,
      query_config: template.config,
      display_config: { metric: newMetric || defaultMetric(template.config as ReportConfig) },
      layout_config: defaultLayout(newWidgetType, index),
    });
  }

  function addFunnelWidget() {
    if (funnelEvents.length < 2) return;
    const index = widgets.length;
    createWidget.mutate({
      title: newWidgetTitle.trim() || "转化漏斗",
      widget_type: "funnel",
      source_type: "funnel",
      query_config: { events: funnelEvents, steps: funnelEvents.map((event) => ({ event, filters: [] })), window_seconds: 86400 },
      display_config: {},
      layout_config: defaultLayout("funnel", index),
    });
  }

  return (
    <div>
      <AnalyticsHeader
        title="数据看板"
        description="把已保存报表和漏斗组合为可拖动、可缩放的项目看板。"
        action={<Button onClick={() => { setDashboardName(""); setDashboardDescription(""); setCreateOpen(true); }}><Plus className="h-4 w-4" />新建看板</Button>}
      />

      <div className="grid min-w-0 gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
        <Card className="h-fit min-w-0">
          <CardHeader className="pb-3"><CardTitle className="text-sm">我的看板</CardTitle></CardHeader>
          <CardContent className="space-y-1 px-2 pb-3">
            {dashboardRows.length ? dashboardRows.map((item) => (
              <button key={item.id} type="button" onClick={() => { setEditing(false); setSelectedId(item.id); }} className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${selectedId === item.id ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                <span className="text-xs">{item.widget_count}</span>
              </button>
            )) : <EmptyAnalysis className="min-h-40" title="暂无看板" description="创建后添加报表或漏斗组件。" />}
          </CardContent>
        </Card>

        <div className="min-w-0">
          {!selected ? (
            <Card><CardContent className="p-4"><EmptyAnalysis className="min-h-[420px]" title="尚未选择看板" description="新建看板后开始配置可视化组件。" /></CardContent></Card>
          ) : (
            <>
              <Card className="mb-4">
                <CardContent className="flex flex-col gap-3 p-3 sm:p-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2"><h2 className="truncate text-lg font-semibold">{selected.name}</h2><Badge variant={editing ? "warning" : "secondary"}>{editing ? "编辑中" : "查看"}</Badge></div>
                    {selected.description ? <p className="mt-1 truncate text-xs text-muted-foreground">{selected.description}</p> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => setMonitoringOpen(true)}>
                      <Bell className="h-3.5 w-3.5" />
                      订阅与告警
                      {(monitoring.data?.data.rules || []).filter((item) => item.enabled).length ? (
                        <Badge variant="warning" className="ml-1">{(monitoring.data?.data.rules || []).filter((item) => item.enabled).length}</Badge>
                      ) : null}
                    </Button>
                    <Button size="sm" variant="outline" onClick={openSettings}><Pencil className="h-3.5 w-3.5" />设置</Button>
                    <Button size="sm" variant={editing ? "secondary" : "outline"} onClick={() => setEditing((value) => !value)}>{editing ? "完成编辑" : "编辑布局"}</Button>
                    {editing ? <Button size="sm" onClick={() => { setAddMode("report"); setNewWidgetType("line"); setNewWidgetTitle(""); setNewMetric("count"); setAddOpen(true); }}><Plus className="h-3.5 w-3.5" />添加组件</Button> : null}
                    {editing ? <Button size="sm" variant="destructive" onClick={() => { if (window.confirm(`确定删除看板“${selected.name}”？`)) deleteDashboard.mutate(selected.id); }}><Trash2 className="h-3.5 w-3.5" />删除</Button> : null}
                  </div>
                </CardContent>
              </Card>

              <Card className="mb-4">
                <CardContent className="p-3 sm:p-4"><DateTimeRange value={range} onChange={setRange} /></CardContent>
              </Card>

              {widgets.length ? (
                <div className="dashboard-grid-surface rounded-lg border bg-secondary/15 p-2">
                  <ResponsiveGridLayout
                    key={selected.id}
                    className="layout"
                    layouts={{ lg: activeLayouts }}
                    breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
                    cols={{ lg: 24, md: 12, sm: 8, xs: 4, xxs: 2 }}
                    rowHeight={44}
                    margin={[12, 12]}
                    containerPadding={[0, 0]}
                    isDraggable={editing}
                    isResizable={editing}
                    draggableHandle=".dashboard-drag-handle"
                    onLayoutChange={(layout) => {
                      setLocalLayouts(layout);
                      setLayoutDashboardId(selected.id);
                    }}
                    onDragStop={(layout) => saveLayouts.mutate(layout)}
                    onResizeStop={(layout) => saveLayouts.mutate(layout)}
                  >
                    {widgets.map((widget, index) => (
                      <div key={String(widget.id)} data-grid={layoutByWidgetId.get(String(widget.id)) || { i: String(widget.id), ...widgetLayout(widget, index) }}>
                        <DashboardWidgetCard
                          widget={widget}
                          projectId={projectId!}
                          range={range}
                          editing={editing}
                          onEdit={() => openWidgetEditor(widget)}
                          onCopy={() => copyWidget.mutate(widget.id)}
                          onDelete={() => { if (window.confirm(`确定删除组件“${widget.title}”？`)) deleteWidget.mutate(widget.id); }}
                        />
                      </div>
                    ))}
                  </ResponsiveGridLayout>
                </div>
              ) : (
                <Card><CardContent className="p-4 pt-4 sm:p-4 sm:pt-4"><EmptyAnalysis className="min-h-[420px]" title="看板暂无组件" description="进入编辑模式，从已保存报表添加图表，或创建漏斗组件。" /><div className="mt-4 flex justify-center"><Button onClick={() => { setEditing(true); setAddMode("report"); setNewWidgetType("line"); setNewMetric("count"); setAddOpen(true); }}><Plus className="h-4 w-4" />添加第一个组件</Button></div></CardContent></Card>
              )}
              {saveLayouts.isPending ? <div className="mt-2 text-right text-xs text-muted-foreground"><Save className="mr-1 inline h-3.5 w-3.5" />正在保存布局…</div> : null}
            </>
          )}
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>新建数据看板</DialogTitle><DialogDescription>看板按项目隔离，后续可加入多个报表和漏斗。</DialogDescription></DialogHeader>
          <div className="grid gap-3"><div className="grid gap-1.5"><Label>看板名称</Label><Input value={dashboardName} onChange={(event) => setDashboardName(event.target.value)} placeholder="例如 广告经营日报" /></div><div className="grid gap-1.5"><Label>说明（可选）</Label><Input value={dashboardDescription} onChange={(event) => setDashboardDescription(event.target.value)} placeholder="看板用途与口径" /></div></div>
          {createDashboard.error ? <Badge variant="danger">{String(createDashboard.error)}</Badge> : null}
          <DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button><Button disabled={!dashboardName.trim() || createDashboard.isPending} onClick={() => createDashboard.mutate()}>{createDashboard.isPending ? "创建中…" : "创建"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>看板设置</DialogTitle><DialogDescription>修改名称和说明，不影响现有组件。</DialogDescription></DialogHeader>
          <div className="grid gap-3"><div className="grid gap-1.5"><Label>看板名称</Label><Input value={dashboardName} onChange={(event) => setDashboardName(event.target.value)} /></div><div className="grid gap-1.5"><Label>说明</Label><Input value={dashboardDescription} onChange={(event) => setDashboardDescription(event.target.value)} /></div></div>
          <DialogFooter><Button variant="outline" onClick={() => setSettingsOpen(false)}>取消</Button><Button disabled={!dashboardName.trim() || updateDashboard.isPending} onClick={() => updateDashboard.mutate()}>保存</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={monitoringOpen} onOpenChange={setMonitoringOpen}>
        <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>看板订阅与异常检测</DialogTitle>
            <DialogDescription>企业微信定时发送完整周期摘要；阈值规则每 5 分钟检测一次。新配置默认不会自动创建。</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-medium">企业微信摘要订阅</div>
                <div className="mt-1 text-xs text-muted-foreground">日报统计上一完整自然日，周报统计此前 7 个完整自然日；时区使用项目配置。</div>
              </div>
              <Button
                type="button"
                variant={subscriptionEnabled ? "default" : "outline"}
                onClick={() => setSubscriptionEnabled((value) => !value)}
              >
                {subscriptionEnabled ? "已启用" : "已关闭"}
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label>频率</Label>
                <Select value={subscriptionCadence} onValueChange={(value) => setSubscriptionCadence(value as "daily" | "weekly")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="daily">每日</SelectItem><SelectItem value="weekly">每周</SelectItem></SelectContent>
                </Select>
              </div>
              {subscriptionCadence === "weekly" ? (
                <div className="grid gap-1.5">
                  <Label>发送日</Label>
                  <Select value={subscriptionWeekday} onValueChange={setSubscriptionWeekday}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map((label, index) => <SelectItem key={label} value={String(index + 1)}>{label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              ) : <div />}
              <div className="grid gap-1.5">
                <Label>发送时间</Label>
                <Select value={subscriptionHour} onValueChange={setSubscriptionHour}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Array.from({ length: 24 }, (_, hour) => <SelectItem key={hour} value={String(hour)}>{String(hour).padStart(2, "0")}:00</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {monitoring.data?.data.subscription.last_sent_at ? `上次发送：${dayjs(monitoring.data.data.subscription.last_sent_at).format("YYYY-MM-DD HH:mm:ss")}` : "尚未发送"}
              </span>
              <Button type="button" disabled={saveSubscription.isPending} onClick={() => saveSubscription.mutate()}>
                {saveSubscription.isPending ? "保存中…" : "保存订阅"}
              </Button>
            </div>
            {saveSubscription.error ? <Badge variant="danger">{String(saveSubscription.error)}</Badge> : null}
          </div>

          <div className="grid gap-4 rounded-lg border p-4">
            <div>
              <div className="font-medium">项目级指标阈值</div>
              <div className="mt-1 text-xs text-muted-foreground">仅支持固定指标和已登记事件；通知进入静默期后，恢复时再推送恢复消息。</div>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="grid gap-1.5 md:col-span-2"><Label>规则名称</Label><Input value={ruleName} onChange={(event) => setRuleName(event.target.value)} placeholder="例如 ad_show 一小时低于 100" /></div>
              <div className="grid gap-1.5"><Label>事件</Label><Select value={ruleEvent} onValueChange={setRuleEvent}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__all__">全部事件</SelectItem>{eventNames.map((event) => <SelectItem key={event} value={event}>{event}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid gap-1.5"><Label>指标</Label><Select value={ruleMetric} onValueChange={(value) => setRuleMetric(value as DashboardAlertRule["metric"])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="event_count">事件次数</SelectItem><SelectItem value="unique_users">去重用户数</SelectItem></SelectContent></Select></div>
              <div className="grid gap-1.5"><Label>条件</Label><Select value={ruleOperator} onValueChange={(value) => setRuleOperator(value as DashboardAlertRule["operator"])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="lt">小于</SelectItem><SelectItem value="lte">小于等于</SelectItem><SelectItem value="gt">大于</SelectItem><SelectItem value="gte">大于等于</SelectItem></SelectContent></Select></div>
              <div className="grid gap-1.5"><Label>阈值</Label><Input type="number" min="0" value={ruleThreshold} onChange={(event) => setRuleThreshold(event.target.value)} /></div>
              <div className="grid gap-1.5"><Label>检测窗口</Label><Select value={ruleWindow} onValueChange={setRuleWindow}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="5">近 5 分钟</SelectItem><SelectItem value="15">近 15 分钟</SelectItem><SelectItem value="60">近 1 小时</SelectItem><SelectItem value="360">近 6 小时</SelectItem><SelectItem value="1440">近 24 小时</SelectItem><SelectItem value="10080">近 7 天</SelectItem></SelectContent></Select></div>
              <div className="grid gap-1.5"><Label>重复通知静默期</Label><Select value={ruleCooldown} onValueChange={setRuleCooldown}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="60">1 小时</SelectItem><SelectItem value="360">6 小时</SelectItem><SelectItem value="720">12 小时</SelectItem><SelectItem value="1440">24 小时</SelectItem><SelectItem value="10080">7 天</SelectItem></SelectContent></Select></div>
            </div>
            <div className="flex justify-end"><Button disabled={!ruleName.trim() || !Number.isFinite(Number(ruleThreshold)) || createAlertRule.isPending} onClick={() => createAlertRule.mutate()}>{createAlertRule.isPending ? "创建中…" : "创建规则"}</Button></div>
            {createAlertRule.error ? <Badge variant="danger">{String(createAlertRule.error)}</Badge> : null}

            {(monitoring.data?.data.rules || []).length ? (
              <div className="overflow-x-auto rounded-md border">
                <Table className="min-w-[900px]">
                  <TableHeader><TableRow><TableHead>规则</TableHead><TableHead>指标</TableHead><TableHead>窗口 / 静默</TableHead><TableHead>当前状态</TableHead><TableHead>最后检测</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader>
                  <TableBody>{(monitoring.data?.data.rules || []).map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell><div className="font-medium">{rule.name}</div><div className="text-xs text-muted-foreground">{rule.event || "全部事件"}</div></TableCell>
                      <TableCell className="text-sm">{rule.metric === "event_count" ? "事件次数" : "去重用户数"} {dashboardRuleOperator(rule.operator)} {rule.threshold.toLocaleString()}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{rule.window_minutes} 分钟 / {rule.cooldown_minutes} 分钟</TableCell>
                      <TableCell><Badge variant={!rule.enabled ? "secondary" : rule.last_state ? "danger" : "success"}>{!rule.enabled ? "已停用" : rule.last_state ? "异常" : "正常"}</Badge>{typeof rule.last_value === "number" ? <div className="mt-1 text-xs text-muted-foreground">值：{rule.last_value.toLocaleString()}</div> : null}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{rule.last_evaluated_at ? dayjs(rule.last_evaluated_at).format("YYYY-MM-DD HH:mm:ss") : "尚未检测"}</TableCell>
                      <TableCell className="text-right"><div className="flex justify-end gap-2"><Button size="sm" variant="outline" disabled={updateAlertRule.isPending} onClick={() => updateAlertRule.mutate({ rule, body: dashboardRuleInput(rule, !rule.enabled) })}>{rule.enabled ? "停用" : "启用"}</Button><Button size="sm" variant="outline" disabled={deleteAlertRule.isPending} onClick={() => { if (window.confirm(`确定删除规则“${rule.name}”？`)) deleteAlertRule.mutate(rule.id); }}>删除</Button></div></TableCell>
                    </TableRow>
                  ))}</TableBody>
                </Table>
              </div>
            ) : <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">暂无阈值规则。</div>}
            {updateAlertRule.error || deleteAlertRule.error ? <Badge variant="danger">{String(updateAlertRule.error || deleteAlertRule.error)}</Badge> : null}
          </div>

          <DialogFooter><Button variant="outline" onClick={() => setMonitoringOpen(false)}>关闭</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>添加组件</DialogTitle><DialogDescription>直接使用核心指标模板、已保存报表，或配置一个新的漏斗。</DialogDescription></DialogHeader>
          <div className="flex gap-2"><Button size="sm" variant={addMode === "report" ? "default" : "outline"} onClick={() => setAddMode("report")}>报表模板</Button><Button size="sm" variant={addMode === "funnel" ? "default" : "outline"} onClick={() => { setAddMode("funnel"); setNewWidgetType("funnel"); }}>漏斗</Button></div>
          {addMode === "report" ? (
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label>报表来源</Label>
                <Select value={templateId} onValueChange={(value) => { const template = reportRows.find((item) => item.key === value); const config = template?.config; setTemplateId(value); setNewWidgetTitle(template?.name || ""); setNewMetric(config ? defaultMetric(config) : "count"); const type = config?.chart; setNewWidgetType(type === "table" || type === "bar" ? type : "line"); }}>
                  <SelectTrigger><SelectValue placeholder="选择核心模板或我的报表" /></SelectTrigger>
                  <SelectContent>{reportRows.map((item) => <SelectItem key={item.key} value={item.key}>{item.group} · {item.name}</SelectItem>)}</SelectContent>
                </Select>
                {selectedTemplate ? <p className="text-xs text-muted-foreground">{selectedTemplate.description}</p> : null}
              </div>
              <div className="grid gap-1.5"><Label>组件名称</Label><Input value={newWidgetTitle} onChange={(event) => setNewWidgetTitle(event.target.value)} /></div>
              <WidgetTypeSelect value={newWidgetType} onChange={setNewWidgetType} includeFunnel={false} />
              {newWidgetType === "metric" && selectedTemplateConfig ? <MetricSelect value={newMetric} onChange={setNewMetric} config={selectedTemplateConfig} /> : null}
            </div>
          ) : (
            <div className="grid gap-3">
              <div className="grid gap-1.5"><Label>组件名称</Label><Input value={newWidgetTitle} onChange={(event) => setNewWidgetTitle(event.target.value)} placeholder="转化漏斗" /></div>
              <div><div className="mb-1.5 text-sm font-medium">漏斗步骤（按选择顺序）</div><EventCollectionPicker events={eventNames} value={funnelEvents} onChange={setFunnelEvents} emptyLabel="至少选择两个事件" max={8} /></div>
            </div>
          )}
          {createWidget.error ? <Badge variant="danger">{String(createWidget.error)}</Badge> : null}
          <DialogFooter><Button variant="outline" onClick={() => setAddOpen(false)}>取消</Button><Button disabled={createWidget.isPending || (addMode === "report" ? !templateId : funnelEvents.length < 2)} onClick={addMode === "report" ? addReportWidget : addFunnelWidget}>{createWidget.isPending ? "添加中…" : "添加"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingWidget} onOpenChange={(open) => !open && setEditingWidget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>组件设置</DialogTitle><DialogDescription>可修改名称和展示类型，查询口径保持不变。</DialogDescription></DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5"><Label>组件名称</Label><Input value={widgetTitle} onChange={(event) => setWidgetTitle(event.target.value)} /></div>
            {editingWidget && editingWidget.source_type !== "funnel" ? <WidgetTypeSelect value={widgetType} onChange={(value) => { setWidgetType(value); if (value === "metric") setWidgetMetric(defaultMetric(editingWidget.query_config as ReportConfig)); }} includeFunnel={false} /> : null}
            {editingWidget && editingWidget.source_type !== "funnel" && widgetType === "metric" ? <MetricSelect value={widgetMetric} onChange={setWidgetMetric} config={editingWidget.query_config as ReportConfig} /> : null}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setEditingWidget(null)}>取消</Button><Button disabled={!widgetTitle.trim() || saveWidget.isPending} onClick={() => editingWidget && saveWidget.mutate({ widget: editingWidget, body: widgetInput(editingWidget, undefined, { title: widgetTitle.trim(), widget_type: widgetType, display_config: { ...editingWidget.display_config, metric: widgetMetric } }) })}>保存</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WidgetTypeSelect({ value, onChange, includeFunnel }: { value: DashboardWidgetType; onChange: (value: DashboardWidgetType) => void; includeFunnel: boolean }) {
  return <div className="grid gap-1.5"><Label>展示类型</Label><Select value={value} onValueChange={(next) => onChange(next as DashboardWidgetType)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="metric">指标卡</SelectItem><SelectItem value="line">折线图</SelectItem><SelectItem value="bar">柱状图</SelectItem><SelectItem value="table">表格</SelectItem>{includeFunnel ? <SelectItem value="funnel">漏斗图</SelectItem> : null}</SelectContent></Select></div>;
}

function MetricSelect({ value, onChange, config }: { value: string; onChange: (value: string) => void; config: ReportConfig }) {
  const options = metricOptions(config);
  return <div className="grid gap-1.5"><Label>指标</Label><Select value={options.some((item) => item.value === value) ? value : options[0]?.value} onValueChange={onChange}><SelectTrigger><SelectValue placeholder="选择指标" /></SelectTrigger><SelectContent>{options.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div>;
}

function DashboardWidgetCard({ widget, projectId, range, editing, onEdit, onCopy, onDelete }: { widget: DashboardWidget; projectId: number; range: [Dayjs, Dayjs]; editing: boolean; onEdit: () => void; onCopy: () => void; onDelete: () => void }) {
  const Icon = chartIcon(widget.widget_type);
  const result = useQuery({
    queryKey: ["dashboard_widget_data", projectId, widget.id, range[0].valueOf(), range[1].valueOf(), widget.updated_at],
    queryFn: async (): Promise<WidgetResult> => {
      if (widget.source_type === "funnel") {
        const config = widget.query_config as { events?: string[]; steps?: { event: string; filters?: [] }[]; window_seconds?: number };
        const response = await api.funnel(projectId, { events: config.events || [], steps: config.steps || [], from: range[0].valueOf(), to: range[1].valueOf(), window_seconds: config.window_seconds || 86400 });
        return { kind: "funnel", steps: response.data.steps };
      }
      const config = widget.query_config as ReportConfig;
      if (config.mode === "cohort") {
        const response = await api.cohortTable(projectId, {
          cohort_event: config.cohort?.cohortEvent || "$AppStart",
          cohort_property: config.cohort?.cohortProperty || undefined,
          cohort_value: config.cohort?.cohortValue,
          metric_event: config.cohort?.metricEvent || "ad_show",
          offsets: config.cohort?.offsets || [0, 1],
          segment_id: config.segmentId || undefined,
          from: range[0].valueOf(),
          to: range[1].valueOf(),
        });
        return { kind: "cohort", rows: response.data.rows, config };
      }
      const response = await api.queryTable(projectId, {
        events: config.events || [],
        from: range[0].valueOf(),
        to: range[1].valueOf(),
        limit: 500,
        segment_id: config.segmentId || undefined,
        sum_properties: config.sumProperties || [],
        dimensions: widget.widget_type === "metric" ? [{ type: "overall", key: "overall" }] : [reportDimension(config)],
        filters: [],
      });
      return { kind: "standard", rows: response.data.rows, config };
    },
    enabled: widget.source_type !== "text",
  });

  return (
    <Card className="flex h-full min-w-0 flex-col overflow-hidden shadow-sm">
      <CardHeader className="flex shrink-0 flex-row items-center justify-between gap-2 border-b px-3 py-2.5">
        <CardTitle className="flex min-w-0 items-center gap-2 text-sm"><Icon className="h-4 w-4 shrink-0 text-primary" /><span className="truncate">{widget.title}</span></CardTitle>
        {editing ? <div className="flex shrink-0 items-center gap-0.5"><button className="dashboard-drag-handle cursor-grab rounded p-1.5 text-muted-foreground hover:bg-muted" title="拖动组件"><GripVertical className="h-4 w-4" /></button><Button size="icon" variant="ghost" className="h-7 w-7" onClick={onEdit} title="编辑"><Pencil className="h-3.5 w-3.5" /></Button><Button size="icon" variant="ghost" className="h-7 w-7" onClick={onCopy} title="复制"><Copy className="h-3.5 w-3.5" /></Button><Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={onDelete} title="删除"><Trash2 className="h-3.5 w-3.5" /></Button></div> : null}
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-auto p-3">
        {result.isLoading ? <div className="flex h-full min-h-24 items-center justify-center text-sm text-muted-foreground">加载中…</div> : result.error ? <div className="flex h-full min-h-24 items-center justify-center text-sm text-destructive">{String(result.error)}</div> : result.data ? <WidgetVisualization widget={widget} result={result.data} /> : <EmptyAnalysis className="mt-2 min-h-24" title="暂无数据" />}
      </CardContent>
    </Card>
  );
}

function WidgetVisualization({ widget, result }: { widget: DashboardWidget; result: WidgetResult }) {
  if (result.kind === "funnel") {
    if (!result.steps.length) return <EmptyAnalysis className="mt-2 min-h-24" title="漏斗暂无数据" />;
    const option = { tooltip: { trigger: "item", formatter: "{b}: {c} 人" }, series: [{ type: "funnel", left: "8%", right: "8%", top: 12, bottom: 12, minSize: "10%", label: { show: true, position: "inside", formatter: "{b}", color: "#fff" }, data: result.steps.map((step) => ({ name: `${step.event} ${(step.conversion * 100).toFixed(1)}%`, value: step.users })) }] };
    return <DashboardChart option={option} />;
  }

  if (!result.rows.length) return <EmptyAnalysis className="mt-2 min-h-24" title="当前范围暂无数据" />;
  if (widget.widget_type === "metric") {
    const metric = metricDisplay(widget, result);
    return <div className="flex h-full min-h-24 flex-col items-center justify-center"><div className="text-3xl font-semibold tabular-nums">{metric.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div><div className="mt-2 text-xs text-muted-foreground">{metric.label}</div></div>;
  }
  if (widget.widget_type === "table") return result.kind === "cohort" ? <CohortWidgetTable rows={result.rows} config={result.config} /> : <StandardWidgetTable rows={result.rows} config={result.config} />;

  const labels = result.kind === "cohort" ? result.rows.map((row) => row.cohort) : result.rows.map((row) => row.dimensions[0]?.label || "-");
  const series = result.kind === "cohort" ? cohortSeries(result.rows, result.config, widget.widget_type) : standardSeries(result.rows, result.config, widget.widget_type);
  const option = { tooltip: { trigger: "axis" }, legend: { bottom: 0, type: "scroll" }, grid: { left: 48, right: 20, top: 24, bottom: 48 }, xAxis: { type: "category", data: labels }, yAxis: { type: "value" }, series };
  return <DashboardChart option={option} />;
}

function DashboardChart({ option }: { option: Record<string, unknown> }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<{ resize: () => void } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let frame = 0;
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => chartRef.current?.resize());
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => chartRef.current?.resize());
    });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={containerRef} className="h-full min-h-[220px] w-full">
      <ReactECharts
        option={option}
        onChartReady={(instance) => {
          chartRef.current = instance;
        }}
        style={{ height: "100%", minHeight: 220, width: "100%" }}
      />
    </div>
  );
}

function standardSeries(rows: QueryTableRow[], config: ReportConfig, type: DashboardWidgetType) {
  const chart = type === "bar" ? "bar" : "line";
  return [
    ...(config.showCount !== false ? [{ name: "事件次数", type: chart, data: rows.map((row) => row.count) }] : []),
    ...(config.showUsers !== false ? [{ name: "去重用户", type: chart, data: rows.map((row) => row.users) }] : []),
    ...(config.sumProperties || []).map((property) => ({ name: `${property} 总和`, type: chart, data: rows.map((row) => row.sums[property] || 0) })),
    ...(config.formulas || []).filter((item) => item.expression).map((item) => ({ name: item.label || "公式", type: chart, data: rows.map((row) => formulaValue(item.expression, standardVariables(row)) || 0) })),
  ];
}

function cohortSeries(rows: CohortTableRow[], config: ReportConfig, type: DashboardWidgetType) {
  const chart = type === "bar" ? "bar" : "line";
  return [
    { name: "新增用户", type: chart, data: rows.map((row) => row.users) },
    ...(config.cohort?.offsets || [0, 1]).map((offset) => ({ name: `Day${offset} 次数`, type: chart, data: rows.map((row) => cohortVariables(row)[`d${offset}_count`] || 0) })),
    ...(config.formulas || []).filter((item) => item.expression).map((item) => ({ name: item.label || "公式", type: chart, data: rows.map((row) => formulaValue(item.expression, cohortVariables(row)) || 0) })),
  ];
}

function StandardWidgetTable({ rows, config }: { rows: QueryTableRow[]; config: ReportConfig }) {
  return <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>维度</TableHead>{config.showCount !== false ? <TableHead className="text-right">事件次数</TableHead> : null}{config.showUsers !== false ? <TableHead className="text-right">去重用户</TableHead> : null}{(config.sumProperties || []).map((property) => <TableHead key={property} className="text-right">{property}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map((row, index) => <TableRow key={index}><TableCell>{row.dimensions[0]?.label || "-"}</TableCell>{config.showCount !== false ? <TableCell className="text-right font-mono">{row.count.toLocaleString()}</TableCell> : null}{config.showUsers !== false ? <TableCell className="text-right font-mono">{row.users.toLocaleString()}</TableCell> : null}{(config.sumProperties || []).map((property) => <TableCell key={property} className="text-right font-mono">{(row.sums[property] || 0).toLocaleString()}</TableCell>)}</TableRow>)}</TableBody></Table></div>;
}

function CohortWidgetTable({ rows, config }: { rows: CohortTableRow[]; config: ReportConfig }) {
  const offsets = config.cohort?.offsets || [0, 1];
  return <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>新增日期</TableHead><TableHead className="text-right">新增用户</TableHead>{offsets.map((offset) => <TableHead key={offset} className="text-right">Day{offset} 次数</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map((row) => { const values = cohortVariables(row); return <TableRow key={row.cohort}><TableCell>{row.cohort}</TableCell><TableCell className="text-right font-mono">{row.users.toLocaleString()}</TableCell>{offsets.map((offset) => <TableCell key={offset} className="text-right font-mono">{(values[`d${offset}_count`] || 0).toLocaleString()}</TableCell>)}</TableRow>; })}</TableBody></Table></div>;
}
