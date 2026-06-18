"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Plus, ShieldCheck, ShieldOff } from "lucide-react";
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

function appTypeLabel(type: Project["app_type"]) {
  return appTypes.find((item) => item.value === type)?.label || "Web";
}

function projectStatusMeta(status: number) {
  return projectStatuses.find((item) => item.value === status) || projectStatuses[1];
}

export function ProjectsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [appType, setAppType] = useState<Project["app_type"]>("web");
  const [packageName, setPackageName] = useState("");
  const [companyId, setCompanyId] = useState<number | undefined>();
  const [status, setStatus] = useState<ProjectStatus>(1);
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const user = useAuthStore((s) => s.user);
  const isPlatformAdmin = user?.role === "admin";

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
    mutationFn: (body: {
      name: string;
      company_id?: number;
      app_type: Project["app_type"];
      package_name?: string;
      description?: string;
      status?: ProjectStatus;
    }) => api.createProject(body),
    onSuccess: () => {
      setOpen(false);
      setName("");
      setAppType("web");
      setPackageName("");
      setCompanyId(undefined);
      setStatus(1);
      setDescription("");
      setError("");
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e: Error) => setError(e.message),
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
      setError("项目名不能为空");
      return;
    }
    if (isPlatformAdmin && !companyId) {
      setError("请选择项目所属公司");
      return;
    }
    if (needsPackageName && !packageName.trim()) {
      setError("App 项目必须填写包名");
      return;
    }
    createMut.mutate({
      name: name.trim(),
      company_id: companyId,
      app_type: appType,
      package_name: needsPackageName ? packageName.trim() : undefined,
      description: description.trim() || undefined,
      status,
    });
  }

  return (
    <AnimatedContent>
      <PageHeader
        title="项目管理"
        description="项目对应一个具体接入应用，例如 Web 站点、Android App、iOS App 或小程序。"
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            新建项目
          </Button>
        }
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
                  <TableHead className="min-w-48">创建时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 4 }).map((_, index) => (
                    <TableRow key={index}>
                      <TableCell colSpan={10}>
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
                    />
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={10} className="h-28 text-center text-sm text-muted-foreground">
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
            <SheetDescription>项目对应一个具体 App 或 Web，创建后自动生成 SDK 上报 token。</SheetDescription>
          </SheetHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="project-name">项目名</Label>
              <Input
                id="project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如：mall-app"
              />
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
                  placeholder={appType === "ios" ? "com.company.app" : "com.company.app"}
                />
              </div>
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
                {createMut.isPending ? "创建中..." : "创建"}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </AnimatedContent>
  );
}

function ProjectRow({
  project,
  pending,
  statusPending,
  onToggleSignature,
  onStatusChange,
}: {
  project: Project;
  pending: boolean;
  statusPending: boolean;
  onToggleSignature: (project: Project) => void;
  onStatusChange: (project: Project, status: ProjectStatus) => void;
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
        <SignatureToggle project={project} pending={pending} onToggle={onToggleSignature} />
      </TableCell>
      <TableCell>
        <ProjectStatusSelect
          status={project.status}
          disabled={statusPending || project.role !== "owner"}
          onChange={(nextStatus) => onStatusChange(project, nextStatus)}
        />
      </TableCell>
      <TableCell className="text-muted-foreground">{formatDateTime(project.created_at)}</TableCell>
    </TableRow>
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
  const meta = projectStatusMeta(status);
  return (
    <Select value={String(status)} onValueChange={(v) => onChange(Number(v) as ProjectStatus)} disabled={disabled}>
      <SelectTrigger className="h-8 w-28">
        <SelectValue>
          <Badge variant={meta.badge}>{meta.label}</Badge>
        </SelectValue>
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
