import dayjs from "dayjs";

export type ReportDimensionKind = "day" | "hour" | "event" | "property";
export type ReportChartKind = "table" | "line" | "bar";
export type ReportFormulaColumn = { id: string; label: string; expression: string };
export type ReportMode = "standard" | "cohort";
export type ReportCohortConfig = {
  cohortEvent: string;
  cohortProperty: string;
  cohortValue: string;
  metricEvent: string;
  offsets: number[];
};

export type CoreReportConfig = {
  kind: "custom_report_v1";
  mode: ReportMode;
  from: number;
  to: number;
  events: string[];
  segmentId: number;
  dimension: ReportDimensionKind;
  property: string;
  chart: ReportChartKind;
  showCount: boolean;
  showUsers: boolean;
  sumProperties: string[];
  formulas: ReportFormulaColumn[];
  cohort: ReportCohortConfig;
  shortcut: boolean;
};

export type CoreReportTemplate = {
  id: string;
  name: string;
  description: string;
  config?: CoreReportConfig;
  href?: string;
};

export function createDefaultReportConfig(): CoreReportConfig {
  return {
    kind: "custom_report_v1",
    mode: "standard",
    from: dayjs().subtract(7, "day").startOf("day").valueOf(),
    to: dayjs().endOf("day").valueOf(),
    events: [],
    segmentId: 0,
    dimension: "day",
    property: "",
    chart: "table",
    showCount: true,
    showUsers: true,
    sumProperties: [],
    formulas: [{ id: "per_user", label: "人均事件次数", expression: "count / users" }],
    cohort: { cohortEvent: "$AppStart", cohortProperty: "$is_first_day", cohortValue: "true", metricEvent: "ad_show", offsets: [0, 1] },
    shortcut: false,
  };
}

export function coreReportTemplates(): CoreReportTemplate[] {
  const base = createDefaultReportConfig();
  return [
    {
      id: "new_users",
      name: "新增用户",
      description: "首日启动用户，按新增日期趋势展示。",
      config: { ...base, mode: "cohort", chart: "line", showCount: false, showUsers: false, formulas: [], cohort: { ...base.cohort, metricEvent: "$AppStart", offsets: [0] } },
    },
    {
      id: "ad_impressions",
      name: "广告展示次数",
      description: "按天统计 ad_show 事件次数与去重用户。",
      config: { ...base, events: ["ad_show"], chart: "line", formulas: [] },
    },
    {
      id: "ad_impressions_per_user",
      name: "人均广告展示",
      description: "ad_show 次数 ÷ 当日去重用户数。",
      config: { ...base, events: ["ad_show"], chart: "line", formulas: [{ id: "ad_per_user", label: "人均广告展示", expression: "count / users" }] },
    },
    {
      id: "ad_revenue_coin",
      name: "广告收入（金币）",
      description: "汇总 coin_earned.coin_amount，作为当前确认的广告收入口径。",
      config: { ...base, events: ["coin_earned"], chart: "bar", showCount: false, showUsers: false, sumProperties: ["coin_amount"], formulas: [] },
    },
    {
      id: "ads_overview",
      name: "广告分析",
      description: "广告展示、完成率、失败率与广告位分组表现。",
      href: "/console/ads",
    },
    {
      id: "retention",
      name: "留存",
      description: "新用户启动后 Day0～Day7 回访。",
      href: "/console/retention?initial_event=%24AppStart&return_event=%24AppStart&days=7",
    },
    {
      id: "conversion_funnel",
      name: "转化漏斗",
      description: "启动 → 广告展示 → 广告完成 → 金币到账。",
      href: "/console/funnel?events=%24AppStart%2Cad_show%2Cad_complete%2Ccoin_earned",
    },
  ];
}
