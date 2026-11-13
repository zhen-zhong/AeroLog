"use client";

import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Link2, Plus, ShieldCheck, ShieldOff } from "lucide-react";
import { api, Project, ProjectChannelCost, ProjectRevenueMapping, ProjectStatus } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/layout/page-header";
import { AnimatedContent } from "@/components/react-bits/animated-content";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useAuthStore } from "@/stores/auth-store";

const appTypes: { value: Project["app_type"]; label: string }[] = [
  { value: "web", label: "Web" },
  { value: "android", label: "Android" },
  { value: "ios", label: "iOS" },
  { value: "mini_program", label: "小程序" },
  { value: "server", label: "服务端" },
  { value: "other", label: "其他" },
];

const projectStatuses: { value: ProjectStatus; label: string; badge: "success" | "secondary" | "warning" | "danger" }[] = [
  { value: 1, label: "启用", badge: "success" },
  { value: 0, label: "未启用", badge: "secondary" },
  { value: 2, label: "冻结", badge: "warning" },
  { value: 3, label: "下线", badge: "danger" },
];

type ProjectSource = "sensorsdata" | "other";

type CreateProjectForm = {
  name: string;
  company_id?: number;
  app_type: Project["app_type"];
  package_name?: string;
  description?: string;
  status?: ProjectStatus;
  timezone: Project["timezone"];
  source: ProjectSource;
  sensors?: {
    endpoint: string;
    project: string;
    api_key: string;
    source_project_id?: string;
    reuse_subscription: boolean;
  };
};

function appTypeLabel(type: Project["app_type"]) {
  return appTypes.find((item) => item.value === type)?.label || "Web";
}

function projectStatusMeta(status: number) {
  return projectStatuses.find((item) => item.value === status) || projectStatuses[1];
}

export function ProjectsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<ProjectSource>("sensorsdata");
  const [name, setName] = useState("");
  const [appType, setAppType] = useState<Project["app_type"]>("web");
  const [packageName, setPackageName] = useState("");
  const [companyId, setCompanyId] = useState<number | undefined>();
  const [status, setStatus] = useState<ProjectStatus>(1);
  const [timezone, setTimezone] = useState<Project["timezone"]>("Asia/Shanghai");
  const [description, setDescription] = useState("");
  const [sensorsEndpoint, setSensorsEndpoint] = useState("http://47.84.178.190:8107");
  const [sensorsAPIKey, setSensorsAPIKey] = useState("");
  const [reuseSensorsSubscription, setReuseSensorsSubscription] = useState(false);
  const [sensorsProjectID, setSensorsProjectID] = useState("");
  const [error, setError] = useState("");
  const [sensorsProject, setSensorsProject] = useState<Project | null>(null);
  const [revenueProject, setRevenueProject] = useState<Project | null>(null);
  const [channelCostProject, setChannelCostProject] = useState<Project | null>(null);
  const user = useAuthStore((s) => s.user);
  const isPlatformAdmin = user?.role === "admin";
  const canManageProjects = isPlatformAdmin || user?.role === "company_admin";

  const { data, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects(),
  });
  const companiesQuery = useQuery({
    queryKey: ["companies"],
    queryFn: () => api.listCompanies(),
    enabled: isPlatformAdmin,
  });

  const projects = data?.data || [];
  const companies = companiesQuery.data?.data || [];
  const needsPackageName = appType === "android" || appType === "ios";

  const createMut = useMutation({
    mutationFn: async (body: CreateProjectForm) => {
      const project = await api.createProject(body);
      if (!body.sensors) return project;

      try {
        await api.connectSensorsIntegration(project.data.id, body.sensors);
      } catch (e) {
        const reason = e instanceof Error ? e.message : "未知错误";
        throw new Error(`项目已创建，但神策接入失败：${reason}。可在项目列表点击“神策接入”后重试。`);
      }
      return project;
    },
    onSuccess: () => {
      setOpen(false);
      setSource("sensorsdata");
      setName("");
      setAppType("web");
      setPackageName("");
      setCompanyId(undefined);
      setStatus(1);
      setTimezone("Asia/Shanghai");
      setDescription("");
      setSensorsEndpoint("http://47.84.178.190:8107");
      setSensorsAPIKey("");
      setReuseSensorsSubscription(false);
      setSensorsProjectID("");
      setError("");
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e: Error) => {
      setError(e.message);
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const securityMut = useMutation({
    mutationFn: (body: { id: number; require_signature: boolean }) =>
      api.updateProjectSecurity(body.id, { require_signature: body.require_signature }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const statusMut = useMutation({
    mutationFn: (body: { id: number; status: ProjectStatus }) =>
      api.updateProjectStatus(body.id, { status: body.status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const timezoneMut = useMutation({
    mutationFn: (body: { id: number; timezone: Project["timezone"] }) =>
      api.updateProjectTimezone(body.id, { timezone: body.timezone }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  function toggleSignature(project: Project) {
    securityMut.mutate({
      id: project.id,
      require_signature: !project.require_signature,
    });
  }

  function changeStatus(project: Project, nextStatus: ProjectStatus) {
    if (project.status === nextStatus) return;
    statusMut.mutate({ id: project.id, status: nextStatus });
  }

  function changeTimezone(project: Project, nextTimezone: Project["timezone"]) {
    if (project.timezone === nextTimezone) return;
    timezoneMut.mutate({ id: project.id, timezone: nextTimezone });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError(source === "sensorsdata" ? "请填写神策项目英文名" : "项目名不能为空");
      return;
    }
    if (isPlatformAdmin && !companyId) {
      setError("请选择项目所属公司");
      return;
    }
    if (source === "other" && needsPackageName && !packageName.trim()) {
      setError("App 项目必须填写包名");
      return;
    }
    if (source === "sensorsdata" && (!sensorsEndpoint.trim() || !sensorsAPIKey.trim())) {
      setError("请填写神策服务地址和 API Key");
      return;
    }
    if (source === "sensorsdata" && reuseSensorsSubscription && !sensorsProjectID.trim()) {
      setError("复用已有订阅时必须填写神策项目 ID");
      return;
    }
    createMut.mutate({
      name: name.trim(),
      company_id: companyId,
      app_type: source === "sensorsdata" ? "other" : appType,
      package_name: packageName.trim() || undefined,
      description: description.trim() || undefined,
      status,
      timezone,
      source,
      ...(source === "sensorsdata" ? {
        sensors: {
          endpoint: sensorsEndpoint.trim(),
          project: name.trim(),
          api_key: sensorsAPIKey.trim(),
          ...(sensorsProjectID.trim() ? { source_project_id: sensorsProjectID.trim() } : {}),
          reuse_subscription: reuseSensorsSubscription,
        },
      } : {}),
    });
  }

  return (
    <AnimatedContent>
      <PageHeader
        title="项目管理"
        description="统一配置项目、数据来源、神策实时订阅与分析时区。"
        actions={canManageProjects ? (
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            新建项目
          </Button>
        ) : undefined}
      />

      <Card className="min-w-0">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-20">ID</TableHead>
                  <TableHead className="min-w-40">项目名</TableHead>
                  <TableHead className="min-w-28">应用类型</TableHead>
                  <TableHead className="min-w-36">数据源配置</TableHead>
                  <TableHead className="min-w-56">包名</TableHead>
                  <TableHead className="min-w-72">Token</TableHead>
                  <TableHead className="min-w-64">描述</TableHead>
                  <TableHead className="min-w-40">签名校验</TableHead>
                  <TableHead className="min-w-24">状态</TableHead>
                  <TableHead className="min-w-36">分析时区</TableHead>
                  <TableHead className="min-w-48">创建时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 4 }).map((_, index) => (
                    <TableRow key={index}>
                      <TableCell colSpan={11}>
                        <Skeleton className="h-8 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : projects.length ? (
                  projects.map((project) => (
                    <ProjectRow
                      key={project.id}
                      project={project}
                      pending={securityMut.isPending}
                      statusPending={statusMut.isPending}
                      timezonePending={timezoneMut.isPending}
                      onToggleSignature={toggleSignature}
                      onStatusChange={changeStatus}
                      onTimezoneChange={changeTimezone}
                      onSensorsConnect={setSensorsProject}
                      onRevenueConfig={setRevenueProject}
                      onChannelCostConfig={setChannelCostProject}
                    />
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={11} className="h-28 text-center text-sm text-muted-foreground">
                      暂无项目
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>新建项目</SheetTitle>
            <SheetDescription>先选择数据来源；神策项目会在创建后立即配置实时数据接入。</SheetDescription>
          </SheetHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label>数据来源</Label>
              <Select value={source} onValueChange={(value) => setSource(value as ProjectSource)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sensorsdata">神策</SelectItem>
                  <SelectItem value="other">其他（SDK / 手动上报）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-name">{source === "sensorsdata" ? "神策项目英文名" : "项目名"}</Label>
              <Input
                id="project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={source === "sensorsdata" ? "如：RbowDrama" : "如：mall-app"}
              />
              {source === "sensorsdata" && <p className="text-xs text-muted-foreground">此名称同时作为 AeroLog 项目名。</p>}
            </div>
            {isPlatformAdmin && (
              <div className="space-y-2">
                <Label>所属公司</Label>
                <Select value={companyId ? String(companyId) : ""} onValueChange={(v) => setCompanyId(Number(v))}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择公司" />
                  </SelectTrigger>
                  <SelectContent>
                    {companies.map((company) => (
                      <SelectItem key={company.id} value={String(company.id)}>
                        {company.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>分析时区</Label>
              <Select value={timezone} onValueChange={(value) => setTimezone(value as Project["timezone"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Asia/Shanghai">UTC+08:00（中国标准时间）</SelectItem>
                  <SelectItem value="UTC">UTC+00:00</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">影响报表按天、留存、会话和趋势的自然日边界。</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-package">包名{source === "other" && needsPackageName ? "（必填）" : "（可选）"}</Label>
              <Input
                id="project-package"
                value={packageName}
                onChange={(e) => setPackageName(e.target.value)}
                placeholder="如：com.company.app"
              />
              <p className="text-xs text-muted-foreground">用于标识 Android 或 iOS 应用；神策项目可按需补充。</p>
            </div>
            {source === "sensorsdata" ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="new-sensors-endpoint">神策服务地址</Label>
                  <Input id="new-sensors-endpoint" value={sensorsEndpoint} onChange={(e) => setSensorsEndpoint(e.target.value)} autoComplete="url" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-sensors-key">API Key</Label>
                  <Input id="new-sensors-key" type="password" value={sensorsAPIKey} onChange={(e) => setSensorsAPIKey(e.target.value)} placeholder="神策 API Key" autoComplete="new-password" />
                  <p className="text-xs text-muted-foreground">仅加密保存；项目列表和接口不会返回明文。</p>
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" checked={reuseSensorsSubscription} onChange={(e) => setReuseSensorsSubscription(e.target.checked)} />
                  复用已有神策订阅，不再新建订阅
                </label>
                {reuseSensorsSubscription && (
                  <div className="space-y-2">
                    <Label htmlFor="new-sensors-source-id">神策项目 ID</Label>
                    <Input id="new-sensors-source-id" value={sensorsProjectID} onChange={(e) => setSensorsProjectID(e.target.value)} placeholder="如：29" inputMode="numeric" />
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>应用类型</Label>
                  <Select value={appType} onValueChange={(v) => setAppType(v as Project["app_type"])}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {appTypes.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            <div className="space-y-2">
              <Label>项目状态</Label>
              <Select value={String(status)} onValueChange={(v) => setStatus(Number(v) as ProjectStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {projectStatuses.map((item) => (
                    <SelectItem key={item.value} value={String(item.value)}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-desc">描述</Label>
              <Textarea
                id="project-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="这个项目采集哪些端和业务线"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={createMut.isPending}>
                {createMut.isPending ? "创建中..." : source === "sensorsdata" ? "创建并接入" : "创建"}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
      <SensorsIntegrationSheet
        project={sensorsProject}
        onOpenChange={(next) => { if (!next) setSensorsProject(null); }}
      />
      <RevenueMappingsSheet
        project={revenueProject}
        onOpenChange={(next) => { if (!next) setRevenueProject(null); }}
      />
      <ChannelCostsSheet
        project={channelCostProject}
        onOpenChange={(next) => { if (!next) setChannelCostProject(null); }}
      />
    </AnimatedContent>
  );
}

function ProjectRow({
  project,
  pending,
  statusPending,
  timezonePending,
  onToggleSignature,
  onStatusChange,
  onTimezoneChange,
  onSensorsConnect,
  onRevenueConfig,
  onChannelCostConfig,
}: {
  project: Project;
  pending: boolean;
  statusPending: boolean;
  timezonePending: boolean;
  onToggleSignature: (project: Project) => void;
  onStatusChange: (project: Project, status: ProjectStatus) => void;
  onTimezoneChange: (project: Project, timezone: Project["timezone"]) => void;
  onSensorsConnect: (project: Project) => void;
  onRevenueConfig: (project: Project) => void;
  onChannelCostConfig: (project: Project) => void;
}) {
  return (
    <TableRow>
      <TableCell className="font-medium">{project.id}</TableCell>
      <TableCell>{project.name}</TableCell>
      <TableCell>
        <Badge variant="outline">{appTypeLabel(project.app_type)}</Badge>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2 whitespace-nowrap">
          <Badge variant={project.data_source === "sensorsdata" ? "success" : "secondary"}>
            {project.data_source === "sensorsdata" ? "神策" : "AeroLog"}
          </Badge>
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => onSensorsConnect(project)} disabled={project.role !== "owner"}>
            <Link2 className="h-3.5 w-3.5" />
            配置神策
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => onRevenueConfig(project)} disabled={project.role !== "owner"}>
            广告收入
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => onChannelCostConfig(project)} disabled={project.role !== "owner"}>
            渠道成本
          </Button>
        </div>
      </TableCell>
      <TableCell className="max-w-56 truncate text-muted-foreground">{project.package_name || "-"}</TableCell>
      <TableCell>
        <Token token={project.token} />
      </TableCell>
      <TableCell className="max-w-xs truncate text-muted-foreground">{project.description || "-"}</TableCell>
      <TableCell>
        <SignatureToggle project={project} pending={pending || project.role !== "owner"} onToggle={onToggleSignature} />
      </TableCell>
      <TableCell>
        <ProjectStatusSelect
          status={project.status}
          disabled={statusPending || project.role !== "owner"}
          onChange={(nextStatus) => onStatusChange(project, nextStatus)}
        />
      </TableCell>
      <TableCell>
        <ProjectTimezoneSelect
          timezone={project.timezone || "Asia/Shanghai"}
          disabled={timezonePending || project.role !== "owner"}
          onChange={(nextTimezone) => onTimezoneChange(project, nextTimezone)}
        />
      </TableCell>
      <TableCell className="text-muted-foreground">{formatDateTime(project.created_at)}</TableCell>
    </TableRow>
  );
}

function ProjectTimezoneSelect({
  timezone,
  disabled,
  onChange,
}: {
  timezone: Project["timezone"];
  disabled: boolean;
  onChange: (timezone: Project["timezone"]) => void;
}) {
  return (
    <Select value={timezone} onValueChange={(value) => onChange(value as Project["timezone"])} disabled={disabled}>
      <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="Asia/Shanghai">UTC+08:00</SelectItem>
        <SelectItem value="UTC">UTC+00:00</SelectItem>
      </SelectContent>
    </Select>
  );
}

function SensorsIntegrationSheet({ project, onOpenChange }: { project: Project | null; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient();
  const [endpoint, setEndpoint] = useState("http://47.84.178.190:8107");
  const [sourceProject, setSourceProject] = useState("");
  const [apiKey, setAPIKey] = useState("");
  const [sourceProjectID, setSourceProjectID] = useState("");
  const [reuse, setReuse] = useState(false);
  const [error, setError] = useState("");
  const integration = useQuery({
    queryKey: ["sensors-integration", project?.id],
    queryFn: () => api.getSensorsIntegration(project!.id),
    enabled: !!project,
    retry: false,
  });
  const saved = integration.data?.data;
  const health = useQuery({
    queryKey: ["sensors-integration-health", project?.id],
    queryFn: () => api.getSensorsIntegrationHealth(project!.id),
    enabled: !!project && !!saved,
    retry: false,
    refetchInterval: 30_000,
  });
  const connect = useMutation({
    mutationFn: () => api.connectSensorsIntegration(project!.id, {
      endpoint: endpoint.trim(), project: sourceProject.trim(), api_key: apiKey.trim(),
      ...(sourceProjectID.trim() ? { source_project_id: sourceProjectID.trim() } : {}),
      reuse_subscription: reuse,
    }),
    onSuccess: () => {
      setAPIKey(""); setError("");
      qc.invalidateQueries({ queryKey: ["sensors-integration", project?.id] });
      qc.invalidateQueries({ queryKey: ["sensors-integration-health", project?.id] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const verify = useMutation({
    mutationFn: () => api.verifySensorsIntegration(project!.id),
    onSuccess: () => {
      setError("");
      qc.invalidateQueries({ queryKey: ["sensors-integration", project?.id] });
      qc.invalidateQueries({ queryKey: ["sensors-integration-health", project?.id] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const healthData = health.data?.data;

  useEffect(() => {
    if (!project) return;
    setError("");
    setAPIKey("");
    if (!saved) {
      setEndpoint("http://47.84.178.190:8107");
      setSourceProject("");
      setSourceProjectID("");
      setReuse(false);
      return;
    }
    setEndpoint(saved.endpoint);
    setSourceProject(saved.source_project);
    setSourceProjectID(saved.source_project_id);
    setReuse(!saved.subscription_id);
  }, [project?.id, saved?.updated_at]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!endpoint.trim() || !sourceProject.trim()) { setError("请填写神策地址和项目英文名"); return; }
    if (!saved && !apiKey.trim()) { setError("请填写神策 API Key"); return; }
    if (reuse && !sourceProjectID.trim()) { setError("复用已有订阅时必须填写神策项目 ID"); return; }
    connect.mutate();
  }

  return (
    <Sheet open={!!project} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>数据源配置 · 神策</SheetTitle>
          <SheetDescription>{project ? `为「${project.name}」配置神策实时数据路由。共享 Kafka 接收应用不会重复创建。` : ""}</SheetDescription>
        </SheetHeader>
        {saved && (
          <>
            <div className="mt-5 rounded-lg border bg-muted/30 p-3 text-sm">
              <p className="font-medium">已连接：{saved.source_project}（ID {saved.source_project_id}）</p>
              <p className="mt-1 break-all text-muted-foreground">API Key：{saved.api_key_hint || "已保存"}；订阅：{saved.subscription_id || "已有订阅"}</p>
            </div>
            <div className="mt-3 rounded-lg border p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium">入库健康</p>
                <Button type="button" size="sm" variant="outline" onClick={() => verify.mutate()} disabled={verify.isPending}>
                  {verify.isPending ? "校验中..." : "验证神策连接"}
                </Button>
              </div>
              {healthData ? (
                <div className="mt-2 space-y-1 text-muted-foreground">
                  <p>最后入库：{healthData.last_event_at ? formatDateTime(healthData.last_event_at) : "暂无神策事件"}</p>
                  <p>近 5 分钟：{healthData.events_last_5_minutes} 条；近 1 小时：{healthData.events_last_hour} 条</p>
                  <p>最近校验：{healthData.last_verified_at ? formatDateTime(healthData.last_verified_at) : "未校验"}</p>
                  {healthData.last_error && <p className="text-destructive">最近错误：{healthData.last_error}</p>}
                </div>
              ) : (
                <p className="mt-2 text-muted-foreground">{health.isLoading ? "读取入库状态中..." : "暂时无法读取入库状态"}</p>
              )}
            </div>
          </>
        )}
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sensors-endpoint">神策服务地址</Label>
            <Input id="sensors-endpoint" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="http://your-sensors-host:8107" autoComplete="url" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sensors-project">神策项目英文名</Label>
            <Input id="sensors-project" value={sourceProject} onChange={(e) => setSourceProject(e.target.value)} placeholder="如：RbowDrama" autoComplete="off" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sensors-key">API Key</Label>
            <Input id="sensors-key" type="password" value={apiKey} onChange={(e) => setAPIKey(e.target.value)} placeholder={saved ? "留空保持已保存的 API Key" : "神策 API Key"} autoComplete="new-password" />
            <p className="text-xs text-muted-foreground">
              {saved ? `已保存：${saved.api_key_hint || "API Key"}；留空不修改。` : "仅加密保存；项目列表和接口不会返回明文。"}
            </p>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={reuse} onChange={(e) => setReuse(e.target.checked)} />
            复用已有神策订阅，不再新建订阅
          </label>
          {reuse && (
            <div className="space-y-2">
              <Label htmlFor="sensors-source-id">神策项目 ID</Label>
              <Input id="sensors-source-id" value={sourceProjectID} onChange={(e) => setSourceProjectID(e.target.value)} placeholder="如：29" inputMode="numeric" />
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
            <Button type="submit" disabled={connect.isPending}>{connect.isPending ? "保存中..." : saved ? "保存配置" : reuse ? "保存并启用路由" : "创建订阅并启用路由"}</Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

type RevenueMappingForm = Omit<ProjectRevenueMapping, "id" | "project_id" | "created_at" | "updated_at">;

const emptyRevenueMapping = (): RevenueMappingForm => ({
  name: "",
  event: "",
  amount_property: "",
  currency_property: "",
  multiplier: 1,
  include_in_ltv: true,
});

function RevenueMappingsSheet({ project, onOpenChange }: { project: Project | null; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<RevenueMappingForm>(emptyRevenueMapping());
  const [editing, setEditing] = useState<ProjectRevenueMapping | null>(null);
  const [error, setError] = useState("");
  const mappings = useQuery({
    queryKey: ["project-revenue-mappings", project?.id],
    queryFn: () => api.listProjectRevenueMappings(project!.id),
    enabled: !!project,
    retry: false,
  });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["project-revenue-mappings", project?.id] });
    qc.invalidateQueries({ queryKey: ["ads_channel_revenue-mappings", project?.id] });
  };
  const save = useMutation({
    mutationFn: () => editing
      ? api.updateProjectRevenueMapping(project!.id, editing.id, form)
      : api.createProjectRevenueMapping(project!.id, form),
    onSuccess: () => {
      setForm(emptyRevenueMapping());
      setEditing(null);
      setError("");
      invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });
  const remove = useMutation({
    mutationFn: (mappingId: number) => api.deleteProjectRevenueMapping(project!.id, mappingId),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  });

  useEffect(() => {
    if (!project) return;
    setForm(emptyRevenueMapping());
    setEditing(null);
    setError("");
  }, [project?.id]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.event.trim() || !form.amount_property.trim()) {
      setError("请填写收入事件和金额字段");
      return;
    }
    if (!Number.isFinite(form.multiplier) || form.multiplier <= 0) {
      setError("换算系数必须大于 0");
      return;
    }
    save.mutate();
  }

  function edit(item: ProjectRevenueMapping) {
    setEditing(item);
    setForm({
      name: item.name,
      event: item.event,
      amount_property: item.amount_property,
      currency_property: item.currency_property,
      multiplier: item.multiplier,
      include_in_ltv: item.include_in_ltv,
    });
    setError("");
  }

  return (
    <Sheet open={!!project} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>广告收入映射</SheetTitle>
          <SheetDescription>{project ? `为「${project.name}」配置收入事件。广告经营页会汇总全部规则；LTV 仅累计已勾选规则。` : ""}</SheetDescription>
        </SheetHeader>
        <div className="mt-5 space-y-2">
          {mappings.isLoading ? <p className="text-sm text-muted-foreground">读取规则中...</p> : (mappings.data?.data || []).length ? (mappings.data?.data || []).map((item) => (
            <div key={item.id} className="rounded-lg border p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{item.name}</p>
                  <p className="mt-1 break-all text-muted-foreground">{item.event} · {item.amount_property} × {item.multiplier}{item.currency_property ? ` · 币种字段：${item.currency_property}` : ""}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{item.include_in_ltv ? "计入 LTV" : "不计入 LTV"}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => edit(item)}>编辑</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => remove.mutate(item.id)} disabled={remove.isPending}>删除</Button>
                </div>
              </div>
            </div>
          )) : <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">暂无规则。不同广告平台可分别新增事件和金额字段。</p>}
        </div>
        <form onSubmit={submit} className="mt-6 space-y-4 border-t pt-5">
          <div className="flex items-center justify-between gap-3"><p className="font-medium">{editing ? "编辑规则" : "新增规则"}</p>{editing && <Button type="button" size="sm" variant="ghost" onClick={() => { setEditing(null); setForm(emptyRevenueMapping()); setError(""); }}>取消编辑</Button>}</div>
          <div className="space-y-2">
            <Label htmlFor="revenue-mapping-name">规则名称</Label>
            <Input id="revenue-mapping-name" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="如：AdMob 广告收入" autoComplete="off" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="revenue-mapping-event">收入事件</Label>
              <Input id="revenue-mapping-event" value={form.event} onChange={(e) => setForm((prev) => ({ ...prev, event: e.target.value }))} placeholder="如：ad_revenue" autoComplete="off" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="revenue-mapping-amount">金额字段</Label>
              <Input id="revenue-mapping-amount" value={form.amount_property} onChange={(e) => setForm((prev) => ({ ...prev, amount_property: e.target.value }))} placeholder="如：revenue" autoComplete="off" />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="revenue-mapping-multiplier">换算系数</Label>
              <Input id="revenue-mapping-multiplier" type="number" min="0" step="any" value={form.multiplier} onChange={(e) => setForm((prev) => ({ ...prev, multiplier: Number(e.target.value) }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="revenue-mapping-currency">币种字段（可选）</Label>
              <Input id="revenue-mapping-currency" value={form.currency_property} onChange={(e) => setForm((prev) => ({ ...prev, currency_property: e.target.value }))} placeholder="如：currency" autoComplete="off" />
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={form.include_in_ltv} onChange={(e) => setForm((prev) => ({ ...prev, include_in_ltv: e.target.checked }))} />计入渠道 LTV</label>
          <p className="text-xs text-muted-foreground">换算系数用于分、微元等单位换算；币种字段仅记录字段来源，不做自动汇率换算。</p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>关闭</Button><Button type="submit" disabled={save.isPending}>{save.isPending ? "保存中..." : editing ? "保存修改" : "新增规则"}</Button></div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

type ChannelCostForm = Omit<ProjectChannelCost, "id" | "project_id" | "source" | "created_at" | "updated_at">;

function emptyChannelCost(): ChannelCostForm {
  return { cost_date: new Date().toISOString().slice(0, 10), media_source: "", campaign_name: "", cost: 0, currency: "USD" };
}

function ChannelCostsSheet({ project, onOpenChange }: { project: Project | null; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<ChannelCostForm>(emptyChannelCost());
  const [csv, setCSV] = useState("");
  const [error, setError] = useState("");
  const costs = useQuery({
    queryKey: ["project-channel-costs", project?.id],
    queryFn: () => api.listProjectChannelCosts(project!.id),
    enabled: !!project,
    retry: false,
  });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["project-channel-costs", project?.id] });
    qc.invalidateQueries({ queryKey: ["ads_channel_business", project?.id] });
  };
  const save = useMutation({
    mutationFn: () => api.createProjectChannelCost(project!.id, form),
    onSuccess: () => { setForm(emptyChannelCost()); setError(""); invalidate(); },
    onError: (e: Error) => setError(e.message),
  });
  const importCosts = useMutation({
    mutationFn: () => api.importProjectChannelCosts(project!.id, parseChannelCostsCSV(csv)),
    onSuccess: () => { setCSV(""); setError(""); invalidate(); },
    onError: (e: Error) => setError(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.deleteProjectChannelCost(project!.id, id),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  });

  useEffect(() => {
    if (!project) return;
    setForm(emptyChannelCost());
    setCSV("");
    setError("");
  }, [project?.id]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.cost_date || !form.media_source.trim() || !Number.isFinite(form.cost) || form.cost < 0) {
      setError("请填写日期、媒体来源及大于或等于 0 的成本");
      return;
    }
    save.mutate();
  }

  function submitCSV() {
    try {
      const rows = parseChannelCostsCSV(csv);
      if (!rows.length) throw new Error("请至少粘贴一条成本数据");
      importCosts.mutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "CSV 格式错误");
    }
  }

  return (
    <Sheet open={!!project} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>渠道成本</SheetTitle>
          <SheetDescription>{project ? `为「${project.name}」录入按日渠道成本。ROI、ROAS 仅在成本与广告收入为相同币种或单位时有效。` : ""}</SheetDescription>
        </SheetHeader>
        <div className="mt-5 space-y-2">
          {costs.isLoading ? <p className="text-sm text-muted-foreground">读取成本数据中...</p> : (costs.data?.data || []).length ? (costs.data?.data || []).map((item) => (
            <div key={item.id} className="flex items-start justify-between gap-3 rounded-lg border p-3 text-sm">
              <div className="min-w-0"><p className="font-medium">{item.cost_date} · {item.media_source}</p><p className="mt-1 break-all text-muted-foreground">{item.campaign_name || "全部活动"} · {item.cost.toLocaleString()} {item.currency || ""} · {item.source === "csv" ? "CSV" : "手工"}</p></div>
              <Button type="button" variant="outline" size="sm" onClick={() => remove.mutate(item.id)} disabled={remove.isPending}>删除</Button>
            </div>
          )) : <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">暂无渠道成本。可逐条新增，或粘贴 CSV 批量导入。</p>}
        </div>
        <form onSubmit={submit} className="mt-6 space-y-4 border-t pt-5">
          <p className="font-medium">新增或覆盖单日成本</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="channel-cost-date">日期</Label><Input id="channel-cost-date" type="date" value={form.cost_date} onChange={(e) => setForm((prev) => ({ ...prev, cost_date: e.target.value }))} /></div>
            <div className="space-y-2"><Label htmlFor="channel-cost-source">媒体来源</Label><Input id="channel-cost-source" value={form.media_source} onChange={(e) => setForm((prev) => ({ ...prev, media_source: e.target.value }))} placeholder="如：Google Ads" autoComplete="off" /></div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="channel-cost-campaign">广告活动（可选）</Label><Input id="channel-cost-campaign" value={form.campaign_name} onChange={(e) => setForm((prev) => ({ ...prev, campaign_name: e.target.value }))} placeholder="不填则仅按媒体来源归集" autoComplete="off" /></div>
            <div className="space-y-2"><Label htmlFor="channel-cost-value">成本</Label><Input id="channel-cost-value" type="number" min="0" step="any" value={form.cost} onChange={(e) => setForm((prev) => ({ ...prev, cost: Number(e.target.value) }))} /></div>
          </div>
          <div className="space-y-2"><Label htmlFor="channel-cost-currency">币种或单位</Label><Input id="channel-cost-currency" value={form.currency} onChange={(e) => setForm((prev) => ({ ...prev, currency: e.target.value }))} placeholder="如：USD" autoComplete="off" /></div>
          <div className="flex justify-end"><Button type="submit" disabled={save.isPending}>{save.isPending ? "保存中..." : "保存成本"}</Button></div>
        </form>
        <div className="mt-6 space-y-3 border-t pt-5">
          <p className="font-medium">批量导入 CSV</p>
          <p className="text-xs text-muted-foreground">每行：日期,媒体来源,广告活动,成本,币种。首行表头可省略；广告活动、币种可留空。</p>
          <Textarea value={csv} onChange={(e) => setCSV(e.target.value)} placeholder={"2026-11-13,Google Ads,UAC-Android,123.45,USD\n2026-11-13,Mintegral,,56.78,USD"} className="min-h-28 font-mono text-xs" />
          <div className="flex justify-end"><Button type="button" variant="outline" onClick={submitCSV} disabled={importCosts.isPending}>{importCosts.isPending ? "导入中..." : "导入并覆盖同键记录"}</Button></div>
        </div>
        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
      </SheetContent>
    </Sheet>
  );
}

function parseChannelCostsCSV(value: string): ChannelCostForm[] {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length && /日期|date/i.test(lines[0].split(",")[0])) lines.shift();
  return lines.map((line, index) => {
    const cells = line.split(",").map((cell) => cell.trim());
    if (cells.length < 4 || cells.length > 5) throw new Error(`第 ${index + 1} 行需要 4 或 5 列`);
    const cost = Number(cells[3]);
    if (!cells[0] || !cells[1] || !Number.isFinite(cost) || cost < 0) throw new Error(`第 ${index + 1} 行日期、媒体来源或成本无效`);
    return { cost_date: cells[0], media_source: cells[1], campaign_name: cells[2] || "", cost, currency: cells[4] || "" };
  });
}

function ProjectStatusSelect({
  status,
  disabled,
  onChange,
}: {
  status: ProjectStatus;
  disabled: boolean;
  onChange: (status: ProjectStatus) => void;
}) {
  return (
    <Select value={String(status)} onValueChange={(v) => onChange(Number(v) as ProjectStatus)} disabled={disabled}>
      <SelectTrigger className="h-8 w-28">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {projectStatuses.map((item) => (
          <SelectItem key={item.value} value={String(item.value)}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SignatureToggle({
  project,
  pending,
  onToggle,
}: {
  project: Project;
  pending: boolean;
  onToggle: (project: Project) => void;
}) {
  return (
    <Button
      type="button"
      variant={project.require_signature ? "default" : "outline"}
      size="sm"
      className="h-8 gap-1.5"
      disabled={pending}
      onClick={() => onToggle(project)}
      title={project.require_signature ? "关闭 HMAC 签名强制校验" : "开启 HMAC 签名强制校验"}
    >
      {project.require_signature ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldOff className="h-3.5 w-3.5" />}
      {project.require_signature ? "已强制" : "未强制"}
    </Button>
  );
}

function Token({ token }: { token: string }) {
  async function copy() {
    await navigator.clipboard?.writeText(token);
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <code className="truncate rounded bg-muted px-2 py-1 text-xs">{token}</code>
      <Button variant="ghost" size="icon" onClick={copy} aria-label="复制 token">
        <Copy className="h-4 w-4" />
      </Button>
    </div>
  );
}
