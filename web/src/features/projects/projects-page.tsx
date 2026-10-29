"use client";

import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Link2, Plus, ShieldCheck, ShieldOff } from "lucide-react";
import { api, Project, ProjectStatus } from "@/lib/api";
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
  const [description, setDescription] = useState("");
  const [sensorsEndpoint, setSensorsEndpoint] = useState("http://47.84.178.190:8107");
  const [sensorsAPIKey, setSensorsAPIKey] = useState("");
  const [reuseSensorsSubscription, setReuseSensorsSubscription] = useState(false);
  const [sensorsProjectID, setSensorsProjectID] = useState("");
  const [error, setError] = useState("");
  const [sensorsProject, setSensorsProject] = useState<Project | null>(null);
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
      package_name: source === "other" && needsPackageName ? packageName.trim() : undefined,
      description: description.trim() || undefined,
      status,
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
        description="项目对应一个具体接入应用，例如 Web 站点、Android App、iOS App 或小程序。"
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
                  <TableHead className="min-w-40">公司</TableHead>
                  <TableHead className="min-w-40">项目名</TableHead>
                  <TableHead className="min-w-28">应用类型</TableHead>
                  <TableHead className="min-w-56">包名</TableHead>
                  <TableHead className="min-w-72">Token</TableHead>
                  <TableHead className="min-w-64">描述</TableHead>
                  <TableHead className="min-w-40">签名校验</TableHead>
                  <TableHead className="min-w-24">状态</TableHead>
                  <TableHead className="min-w-32">数据接入</TableHead>
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
                      onToggleSignature={toggleSignature}
                      onStatusChange={changeStatus}
                      onSensorsConnect={setSensorsProject}
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
                {needsPackageName && (
                  <div className="space-y-2">
                    <Label htmlFor="project-package">包名</Label>
                    <Input
                      id="project-package"
                      value={packageName}
                      onChange={(e) => setPackageName(e.target.value)}
                      placeholder="com.company.app"
                    />
                  </div>
                )}
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
    </AnimatedContent>
  );
}

function ProjectRow({
  project,
  pending,
  statusPending,
  onToggleSignature,
  onStatusChange,
  onSensorsConnect,
}: {
  project: Project;
  pending: boolean;
  statusPending: boolean;
  onToggleSignature: (project: Project) => void;
  onStatusChange: (project: Project, status: ProjectStatus) => void;
  onSensorsConnect: (project: Project) => void;
}) {
  return (
    <TableRow>
      <TableCell className="font-medium">{project.id}</TableCell>
      <TableCell className="text-muted-foreground">{project.company_name || "-"}</TableCell>
      <TableCell>{project.name}</TableCell>
      <TableCell>
        <Badge variant="outline">{appTypeLabel(project.app_type)}</Badge>
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
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => onSensorsConnect(project)} disabled={project.role !== "owner"}>
          <Link2 className="h-3.5 w-3.5" />
          神策接入
        </Button>
      </TableCell>
      <TableCell className="text-muted-foreground">{formatDateTime(project.created_at)}</TableCell>
    </TableRow>
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
  const connect = useMutation({
    mutationFn: () => api.connectSensorsIntegration(project!.id, {
      endpoint: endpoint.trim(), project: sourceProject.trim(), api_key: apiKey.trim(),
      ...(sourceProjectID.trim() ? { source_project_id: sourceProjectID.trim() } : {}),
      reuse_subscription: reuse,
    }),
    onSuccess: () => {
      setAPIKey(""); setError("");
      qc.invalidateQueries({ queryKey: ["sensors-integration", project?.id] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const saved = integration.data?.data;

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
          <SheetTitle>神策实时接入</SheetTitle>
          <SheetDescription>{project ? `为「${project.name}」创建独立数据路由。共享 Kafka 接收应用不会重复创建。` : ""}</SheetDescription>
        </SheetHeader>
        {saved && (
          <div className="mt-5 rounded-lg border bg-muted/30 p-3 text-sm">
            <p className="font-medium">已连接：{saved.source_project}（ID {saved.source_project_id}）</p>
            <p className="mt-1 break-all text-muted-foreground">API Key：{saved.api_key_hint || "已保存"}；订阅：{saved.subscription_id || "已有订阅"}</p>
          </div>
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
