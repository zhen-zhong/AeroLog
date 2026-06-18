"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs, { Dayjs } from "dayjs";
import {
  Bookmark,
  Copy,
  Download,
  Filter,
  Hourglass,
  Link as LinkIcon,
  Play,
  Plus,
  RotateCcw,
  Share2,
  Trash2,
  Unlink,
  X,
} from "lucide-react";
import {
  AnalyticsHeader,
  ChartPanel,
  DateTimeRange,
  EmptyAnalysis,
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
import { api, AnalyticsJob, QueryDimension, QueryFilter, QueryTemplate } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useProjectStore } from "@/stores/project-store";

type DraftFilter = {
  id: string;
  event: string;
  property: string;
  op: "eq" | "neq" | "exists";
  value: string;
};

const DRAFT_STORAGE_KEY = "aerolog:query-builder:draft";

export default function QueryBuilderPage() {
  const projectId = useProjectStore((s) => s.projectId);
  const [range, setRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(7, "day").startOf("day"),
    dayjs().endOf("day"),
  ]);
  const [events, setEvents] = useState<string[]>([]);
  const [dimensions, setDimensions] = useState<QueryDimension[]>([{ type: "event", key: "event" }]);
  const [filters, setFilters] = useState<DraftFilter[]>([
    { id: crypto.randomUUID(), event: "", property: "", op: "eq", value: "" },
  ]);
  const [draftReady, setDraftReady] = useState(false);
  const [tplName, setTplName] = useState("");
  const [tplDesc, setTplDesc] = useState("");
  const [tplShared, setTplShared] = useState(false);
  const [shareLink, setShareLink] = useState<string>("");
  const queryClient = useQueryClient();

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
      if (!raw) {
        setDraftReady(true);
        return;
      }
      const draft = JSON.parse(raw) as {
        from?: number;
        to?: number;
        events?: string[];
        dimensions?: QueryDimension[];
        filters?: DraftFilter[];
      };
      if (draft.from && draft.to) setRange([dayjs(draft.from), dayjs(draft.to)]);
      if (Array.isArray(draft.events)) setEvents(draft.events);
      if (Array.isArray(draft.dimensions) && draft.dimensions.length) setDimensions(draft.dimensions);
      if (Array.isArray(draft.filters) && draft.filters.length) {
        setFilters(draft.filters.map((item) => ({ ...item, id: item.id || crypto.randomUUID() })));
      }
    } catch {
      // ignore broken local draft
    } finally {
      setDraftReady(true);
    }
  }, []);

  useEffect(() => {
    if (!draftReady) return;
    window.localStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify({
        from: range[0].valueOf(),
        to: range[1].valueOf(),
        events,
        dimensions,
        filters,
      }),
    );
  }, [range, events, dimensions, filters, draftReady]);

  const tsRange = useMemo(() => ({ from: range[0].valueOf(), to: range[1].valueOf() }), [range]);

  const top = useQuery({
    queryKey: ["query_top_events", projectId, tsRange],
    queryFn: () => api.topEvents(projectId!, { ...tsRange, limit: 80 }),
    enabled: !!projectId,
    placeholderData: (previousData) => previousData,
  });

  const props = useQuery({
    queryKey: ["query_properties", projectId],
    queryFn: () => api.listProperties(projectId!, { scope: "event" }),
    enabled: !!projectId,
    placeholderData: (previousData) => previousData,
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

  const buildQueryBody = (limit = 200) => ({
    events,
    ...tsRange,
    limit,
    dimensions,
    filters: filters
      .filter((item) => item.property || item.event)
      .map<QueryFilter>((item) => ({
        event: item.event || undefined,
        property: item.property || undefined,
        op: item.op,
        value: item.op === "exists" ? undefined : item.value,
      })),
  });

  const exportCsv = useMutation({
    mutationFn: () => api.queryTableExport(projectId!, buildQueryBody()),
  });

  const templates = useQuery({
    queryKey: ["query_templates", projectId],
    queryFn: () => api.listQueryTemplates(projectId!),
    enabled: !!projectId,
    placeholderData: (previousData) => previousData,
  });

  const saveTemplate = useMutation({
    mutationFn: () =>
      api.createQueryTemplate(projectId!, {
        name: tplName.trim(),
        description: tplDesc.trim(),
        is_shared: tplShared,
        config: buildQueryBody(),
      }),
    onSuccess: () => {
      setTplName("");
      setTplDesc("");
      setTplShared(false);
      queryClient.invalidateQueries({ queryKey: ["query_templates", projectId] });
    },
  });

  const deleteTemplate = useMutation({
    mutationFn: (tid: number) => api.deleteQueryTemplate(projectId!, tid),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["query_templates", projectId] }),
  });

  const toggleShare = useMutation({
    mutationFn: ({ tid, enable }: { tid: number; enable: boolean }) =>
      api.shareQueryTemplate(projectId!, tid, enable),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["query_templates", projectId] }),
  });

  const jobs = useQuery({
    queryKey: ["analytics_jobs", projectId],
    queryFn: () => api.listAnalyticsJobs(projectId!),
    enabled: !!projectId,
    refetchInterval: 5_000,
    placeholderData: (previousData) => previousData,
  });

  const createJob = useMutation({
    mutationFn: () =>
      api.createAnalyticsJob(projectId!, {
        type: "query_export",
        input: buildQueryBody(50000),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["analytics_jobs", projectId] }),
  });

  const downloadJob = useMutation({
    mutationFn: (job: AnalyticsJob) =>
      api.downloadAnalyticsJob(
        projectId!,
        job.id,
        job.result?.filename || `query_export_${job.id}.csv`,
      ),
  });

  function applyTemplate(tpl: QueryTemplate) {
    const cfg = tpl.config as Record<string, unknown>;
    if (typeof cfg.from === "number" && typeof cfg.to === "number") {
      setRange([dayjs(cfg.from as number), dayjs(cfg.to as number)]);
    }
    if (Array.isArray(cfg.events)) setEvents(cfg.events as string[]);
    if (Array.isArray(cfg.dimensions) && cfg.dimensions.length) {
      setDimensions(cfg.dimensions as QueryDimension[]);
    }
    if (Array.isArray(cfg.filters)) {
      const list = cfg.filters as Array<Partial<DraftFilter>>;
      setFilters(
        list.length
          ? list.map((it) => ({
              id: crypto.randomUUID(),
              event: it.event || "",
              property: it.property || "",
              op: (it.op as DraftFilter["op"]) || "eq",
              value: typeof it.value === "string" ? it.value : "",
            }))
          : [{ id: crypto.randomUUID(), event: "", property: "", op: "eq", value: "" }],
      );
    }
  }

  function buildShareLink(token: string) {
    if (typeof window === "undefined") return token;
    return `${window.location.origin}/console/query/shared/${encodeURIComponent(token)}`;
  }

  async function copyShareLink(token: string) {
    const link = buildShareLink(token);
    setShareLink(link);
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // 用户浏览器禁用 clipboard 时仅展示
    }
  }

  const rows = query.data?.data.rows || [];
  const selectedEventLabel = events.length ? `${events.length} 个事件` : "全部事件";
  const resultDimensions = query.data?.data.dimensions || dimensions;
  const tableMinWidth = Math.max(920, resultDimensions.length * 220 + 340);

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
                {propertyRows.map((item) => (
                  <DimensionButton
                    key={item.id}
                    active={dimensions.some((dim) => dim.type === "property" && dim.key === item.name)}
                    label={item.name}
                    onClick={() => toggleDimension({ type: "property", key: item.name })}
                  />
                ))}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Button type="button" disabled={!projectId || query.isPending} onClick={() => query.mutate()}>
                  <Play className="h-4 w-4" />
                  {query.isPending ? "查询中" : "生成表格"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!projectId || exportCsv.isPending}
                  onClick={() => exportCsv.mutate()}
                >
                  <Download className="h-4 w-4" />
                  {exportCsv.isPending ? "导出中" : "导出 CSV"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!projectId || createJob.isPending}
                  onClick={() => createJob.mutate()}
                >
                  <Hourglass className="h-4 w-4" />
                  {createJob.isPending ? "提交中" : "异步导出"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEvents([]);
                    setDimensions([{ type: "event", key: "event" }]);
                    setFilters([{ id: crypto.randomUUID(), event: "", property: "", op: "eq", value: "" }]);
                    window.localStorage.removeItem(DRAFT_STORAGE_KEY);
                    query.reset();
                  }}
                >
                  <RotateCcw className="h-4 w-4" />
                  重置
                </Button>
              </div>
              {query.error ? <Badge variant="danger" className="items-center">{String(query.error.message || query.error)}</Badge> : null}
              {exportCsv.error ? <Badge variant="danger" className="items-center">{String(exportCsv.error.message || exportCsv.error)}</Badge> : null}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="grid gap-3 pt-4 sm:pt-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium">保存为模板</div>
                <Badge variant="outline" className="items-center gap-1"><Bookmark className="h-3 w-3" />Templates</Badge>
              </div>
              <Input
                value={tplName}
                onChange={(e) => setTplName(e.target.value)}
                placeholder="模板名称，例如 渠道转化诊断"
              />
              <Input
                value={tplDesc}
                onChange={(e) => setTplDesc(e.target.value)}
                placeholder="备注（可选）"
              />
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={tplShared}
                  onChange={(e) => setTplShared(e.target.checked)}
                />
                创建后立即生成分享链接
              </label>
              <Button
                type="button"
                disabled={!projectId || !tplName.trim() || saveTemplate.isPending}
                onClick={() => saveTemplate.mutate()}
              >
                <Plus className="h-4 w-4" />
                {saveTemplate.isPending ? "保存中" : "保存模板"}
              </Button>
              {saveTemplate.error ? <Badge variant="danger" className="items-center">{String(saveTemplate.error.message || saveTemplate.error)}</Badge> : null}
              {shareLink ? (
                <div className="flex items-center gap-2 rounded-md border bg-background p-2 text-xs">
                  <LinkIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="truncate font-mono">{shareLink}</span>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-5">
        <ChartPanel title="查询结果" description="按所选维度聚合，指标为事件次数和去重用户数" contentClassName="p-0 sm:p-0">
          {rows.length ? (
            <div className="max-w-full overflow-x-auto">
              <Table style={{ minWidth: tableMinWidth }}>
                <TableHeader>
                  <TableRow>
                    {resultDimensions.map((dim) => (
                      <TableHead key={`${dim.type}:${dim.key}`} className="w-56 whitespace-nowrap">
                        {dim.type === "event" ? "事件" : dim.key}
                      </TableHead>
                    ))}
                    <TableHead className="w-24 whitespace-nowrap text-right">次数</TableHead>
                    <TableHead className="w-24 whitespace-nowrap text-right">用户</TableHead>
                    <TableHead className="w-44 whitespace-nowrap">样例用户</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, index) => (
                    <TableRow key={index}>
                      {row.dimensions.map((dim) => (
                        <TableCell key={`${index}:${dim.type}:${dim.key}`} className="max-w-56 truncate font-medium">
                          {dim.label}
                        </TableCell>
                      ))}
                      <TableCell className="text-right font-mono">{row.count.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono">{row.users.toLocaleString()}</TableCell>
                      <TableCell>
                        {row.sample_users?.length ? (
                          <div className="flex max-w-44 flex-wrap gap-1">
                            {row.sample_users.slice(0, 3).map((user) => (
                              <Link
                                key={user}
                                href={`/console/users?project_id=${projectId}&distinct_id=${encodeURIComponent(user)}&from=${tsRange.from}&to=${tsRange.to}`}
                                className="max-w-full truncate rounded-md bg-secondary px-2 py-1 text-xs text-primary hover:bg-accent hover:text-accent-foreground"
                                title="查看用户时间线"
                              >
                                {user}
                              </Link>
                            ))}
                          </div>
                        ) : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <EmptyAnalysis title="暂无查询结果" description="选择事件、参数过滤和维度后点击生成表格。" />
          )}
        </ChartPanel>

        <ChartPanel title="查询模板" description="保存当前查询配置以复用、分享" contentClassName="p-0 sm:p-0">
          <TemplateList
            templates={templates.data?.data || []}
            onApply={applyTemplate}
            onDelete={(tid) => deleteTemplate.mutate(tid)}
            onShare={(tid, enable) => toggleShare.mutate({ tid, enable })}
            onCopy={copyShareLink}
            buildShareLink={buildShareLink}
          />
        </ChartPanel>

        <ChartPanel title="异步任务" description="大结果集后台执行，完成后可下载 CSV" contentClassName="p-0 sm:p-0">
          <JobList
            jobs={jobs.data?.data || []}
            onDownload={(job) => downloadJob.mutate(job)}
            downloadingJobId={downloadJob.variables?.id}
          />
        </ChartPanel>
        </div>
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

function TemplateList({
  templates,
  onApply,
  onDelete,
  onShare,
  onCopy,
  buildShareLink,
}: {
  templates: QueryTemplate[];
  onApply: (tpl: QueryTemplate) => void;
  onDelete: (tid: number) => void;
  onShare: (tid: number, enable: boolean) => void;
  onCopy: (token: string) => void;
  buildShareLink: (token: string) => string;
}) {
  if (!templates.length) {
    return <EmptyAnalysis title="暂无模板" description="在左侧填写名称并保存当前查询，即可在此处复用、分享。" />;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>名称</TableHead>
          <TableHead className="hidden md:table-cell">备注</TableHead>
          <TableHead className="w-44">分享</TableHead>
          <TableHead className="w-32 text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {templates.map((tpl) => (
          <TableRow key={tpl.id}>
            <TableCell className="font-medium">
              <button
                type="button"
                className="text-left hover:underline"
                onClick={() => onApply(tpl)}
                title="加载到查询构造器"
              >
                {tpl.name}
              </button>
            </TableCell>
            <TableCell className="hidden max-w-[280px] truncate text-muted-foreground md:table-cell">
              {tpl.description || "-"}
            </TableCell>
            <TableCell>
              {tpl.is_shared && tpl.share_token ? (
                <div className="flex items-center gap-1">
                  <Badge variant="success" className="items-center gap-1"><Share2 className="h-3 w-3" />已分享</Badge>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => onCopy(tpl.share_token!)}
                    title={buildShareLink(tpl.share_token!)}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <Badge variant="secondary">未分享</Badge>
              )}
            </TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end gap-1">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => onShare(tpl.id, !tpl.is_shared)}
                  title={tpl.is_shared ? "取消分享" : "开启分享"}
                >
                  {tpl.is_shared ? <Unlink className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => onDelete(tpl.id)}
                  title="删除"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function JobList({
  jobs,
  onDownload,
  downloadingJobId,
}: {
  jobs: AnalyticsJob[];
  onDownload: (job: AnalyticsJob) => void;
  downloadingJobId?: number;
}) {
  if (!jobs.length) {
    return <EmptyAnalysis title="暂无异步任务" description="点击「异步导出」可把当前查询提交到后台，结果集 5 万行内，完成后在此查看。" />;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-16">#</TableHead>
          <TableHead className="w-28">类型</TableHead>
          <TableHead className="w-28">状态</TableHead>
          <TableHead className="w-24 text-right">行数</TableHead>
          <TableHead className="hidden md:table-cell">提交时间</TableHead>
          <TableHead className="hidden md:table-cell">完成时间</TableHead>
          <TableHead>说明</TableHead>
          <TableHead className="w-20 text-right">下载</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job) => (
          <TableRow key={job.id}>
            <TableCell className="font-mono text-xs">{job.id}</TableCell>
            <TableCell>{job.type}</TableCell>
            <TableCell>{jobStatusBadge(job.status)}</TableCell>
            <TableCell className="text-right font-mono">{job.rows_count?.toLocaleString?.() || 0}</TableCell>
            <TableCell className="hidden text-muted-foreground md:table-cell">
              {job.created_at ? dayjs(job.created_at).format("MM-DD HH:mm") : "-"}
            </TableCell>
            <TableCell className="hidden text-muted-foreground md:table-cell">
              {job.finished_at ? dayjs(job.finished_at).format("MM-DD HH:mm") : "-"}
            </TableCell>
            <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground">
              {job.error_message || (job.status === "succeeded" ? `已完成，共 ${job.rows_count} 行` : "处理中…")}
            </TableCell>
            <TableCell className="text-right">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={job.status !== "succeeded" || downloadingJobId === job.id}
                onClick={() => onDownload(job)}
                title="下载 CSV"
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function jobStatusBadge(status: AnalyticsJob["status"]) {
  switch (status) {
    case "succeeded":
      return <Badge variant="success">完成</Badge>;
    case "failed":
      return <Badge variant="danger">失败</Badge>;
    case "running":
      return <Badge variant="info">运行中</Badge>;
    default:
      return <Badge variant="secondary">排队</Badge>;
  }
}
