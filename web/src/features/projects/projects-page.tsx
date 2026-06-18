"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Plus, ShieldCheck, ShieldOff } from "lucide-react";
import { api, Project } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/layout/page-header";
import { AnimatedContent } from "@/components/react-bits/animated-content";
import { CountUp } from "@/components/react-bits/count-up";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

export function ProjectsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects(),
  });

  const projects = data?.data || [];
  const activeCount = projects.filter((project) => project.status === 1).length;

  const createMut = useMutation({
    mutationFn: (body: { name: string; description?: string }) => api.createProject(body),
    onSuccess: () => {
      setOpen(false);
      setName("");
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

  function toggleSignature(project: Project) {
    securityMut.mutate({
      id: project.id,
      require_signature: !project.require_signature,
    });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("项目名不能为空");
      return;
    }
    createMut.mutate({ name: name.trim(), description: description.trim() || undefined });
  }

  return (
    <AnimatedContent>
      <PageHeader
        title="项目管理"
        description="创建 SDK 上报项目，管理 token 和接入凭证。"
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            新建项目
          </Button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <MetricCard label="项目总数" value={projects.length} loading={isLoading} />
        <MetricCard label="启用项目" value={activeCount} loading={isLoading} />
        <MetricCard label="最近创建" value={projects[0]?.id || 0} loading={isLoading} />
      </div>

      <Card className="hidden md:block">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">ID</TableHead>
                <TableHead>项目名</TableHead>
                <TableHead>Token</TableHead>
                <TableHead>描述</TableHead>
                <TableHead className="w-40">签名校验</TableHead>
                <TableHead className="w-24">状态</TableHead>
                <TableHead className="w-48">创建时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, index) => (
                  <TableRow key={index}>
                    <TableCell colSpan={7}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                projects.map((project) => (
                  <ProjectRow
                    key={project.id}
                    project={project}
                    pending={securityMut.isPending}
                    onToggleSignature={toggleSignature}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:hidden">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-36" />)
        ) : (
          projects.map((project) => (
            <ProjectMobileCard
              key={project.id}
              project={project}
              pending={securityMut.isPending}
              onToggleSignature={toggleSignature}
            />
          ))
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建项目</DialogTitle>
            <DialogDescription>创建后会自动生成 SDK 上报 token。</DialogDescription>
          </DialogHeader>
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
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={createMut.isPending}>
                {createMut.isPending ? "创建中..." : "创建"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AnimatedContent>
  );
}

function MetricCard({ label, value, loading }: { label: string; value: number; loading: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-7 w-20" /> : <div className="text-2xl font-semibold"><CountUp value={value} /></div>}
      </CardContent>
    </Card>
  );
}

function ProjectRow({
  project,
  pending,
  onToggleSignature,
}: {
  project: Project;
  pending: boolean;
  onToggleSignature: (project: Project) => void;
}) {
  return (
    <TableRow>
      <TableCell className="font-medium">{project.id}</TableCell>
      <TableCell>{project.name}</TableCell>
      <TableCell>
        <Token token={project.token} />
      </TableCell>
      <TableCell className="max-w-xs truncate text-muted-foreground">{project.description || "-"}</TableCell>
      <TableCell>
        <SignatureToggle project={project} pending={pending} onToggle={onToggleSignature} />
      </TableCell>
      <TableCell>{project.status === 1 ? <Badge variant="success">启用</Badge> : <Badge variant="secondary">禁用</Badge>}</TableCell>
      <TableCell className="text-muted-foreground">{formatDateTime(project.created_at)}</TableCell>
    </TableRow>
  );
}

function ProjectMobileCard({
  project,
  pending,
  onToggleSignature,
}: {
  project: Project;
  pending: boolean;
  onToggleSignature: (project: Project) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{project.name}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">ID {project.id}</p>
          </div>
          {project.status === 1 ? <Badge variant="success">启用</Badge> : <Badge variant="secondary">禁用</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Token token={project.token} />
        <SignatureToggle project={project} pending={pending} onToggle={onToggleSignature} />
        <p className="text-sm text-muted-foreground">{project.description || "暂无描述"}</p>
        <p className="text-xs text-muted-foreground">{formatDateTime(project.created_at)}</p>
      </CardContent>
    </Card>
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
