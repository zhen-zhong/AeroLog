"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, UserPlus } from "lucide-react";
import { api, MemberAccount, MemberProjectGrant, Project, ProjectMember } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { AnimatedContent } from "@/components/react-bits/animated-content";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuthStore } from "@/stores/auth-store";

const roles: ProjectMember["role"][] = ["viewer", "editor", "owner"];

const roleText: Record<ProjectMember["role"], string> = {
  owner: "项目负责人",
  editor: "可编辑",
  viewer: "只读",
};

const accountTypeText = {
  platform_admin: "平台管理员",
  platform_member: "平台成员",
  enterprise_admin: "企业管理员",
  enterprise_member: "企业成员",
};

type AccountType = keyof typeof accountTypeText;

export default function MembersPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const isPlatformAdmin = user?.role === "admin";
  const isCompanyAdmin = user?.role === "company_admin";
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<MemberAccount | null>(null);
  const [accountType, setAccountType] = useState<AccountType>("enterprise_member");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [companyChoice, setCompanyChoice] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyIndustry, setCompanyIndustry] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [selectedProjectIds, setSelectedProjectIds] = useState<number[]>([]);
  const [projectRole, setProjectRole] = useState<ProjectMember["role"]>("viewer");
  const [error, setError] = useState("");

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects(),
  });
  const projects = projectsQuery.data?.data || [];
  const canManageMembers = isPlatformAdmin || isCompanyAdmin;

  // 路由守卫：只有平台管理员和企业管理员可以进入成员管理。
  useEffect(() => {
    if (!user) return;
    if (!projectsQuery.isSuccess) return;
    if (!canManageMembers) router.replace("/console");
  }, [user, projectsQuery.isSuccess, canManageMembers, router]);

  const membersQuery = useQuery({
    queryKey: ["members"],
    queryFn: () => api.listMembers(),
    enabled: canManageMembers,
  });
  const companiesQuery = useQuery({
    queryKey: ["companies"],
    queryFn: () => api.listCompanies(),
    enabled: isPlatformAdmin,
  });

  const members = membersQuery.data?.data || [];
  const companies = companiesQuery.data?.data || [];
  const selectedCompanyId = companyChoice && companyChoice !== "new" ? Number(companyChoice) : undefined;
  const needsEnterprise = accountType === "enterprise_admin" || accountType === "enterprise_member";

  const projectOptions = useMemo(() => {
    if (isPlatformAdmin && needsEnterprise && selectedCompanyId) {
      return projects.filter((project) => project.company_id === selectedCompanyId);
    }
    if (isPlatformAdmin && needsEnterprise && companyChoice === "new") {
      return [];
    }
    return projects;
  }, [companyChoice, isPlatformAdmin, needsEnterprise, projects, selectedCompanyId]);

  const showProjectAssignments = !isPlatformAdmin || accountType === "platform_member" || accountType === "enterprise_member";

  const createMut = useMutation({
    mutationFn: (body: Parameters<typeof api.createMemberAccount>[0]) => api.createMemberAccount(body),
    onSuccess: () => {
      resetForm();
      setDrawerOpen(false);
      qc.invalidateQueries({ queryKey: ["members"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  function resetForm() {
    setAccountType("enterprise_member");
    setEmail("");
    setName("");
    setPassword("");
    setPhone("");
    setJobTitle("");
    setCompanyChoice("");
    setCompanyName("");
    setCompanyIndustry("");
    setCompanyPhone("");
    setSelectedProjectIds([]);
    setProjectRole("viewer");
    setError("");
  }

  function openDrawer() {
    resetForm();
    setDrawerOpen(true);
  }

  function toggleProject(projectID: number) {
    setSelectedProjectIds((prev) =>
      prev.includes(projectID) ? prev.filter((id) => id !== projectID) : [...prev, projectID],
    );
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      setError("请输入邮箱");
      return;
    }
    if (password.length < 8) {
      setError("密码至少 8 位");
      return;
    }
    if (isPlatformAdmin && needsEnterprise && !selectedCompanyId && !companyName.trim()) {
      setError("请选择公司或填写新公司名称");
      return;
    }
    createMut.mutate({
      account_type: accountType,
      email: email.trim(),
      name: name.trim() || undefined,
      password,
      phone: phone.trim() || undefined,
      job_title: jobTitle.trim() || undefined,
      company_id: selectedCompanyId,
      company_name: companyChoice === "new" ? companyName.trim() : undefined,
      company_industry: companyIndustry.trim() || undefined,
      company_phone: companyPhone.trim() || undefined,
      project_ids: showProjectAssignments ? selectedProjectIds : [],
      project_role: projectRole,
    });
  }

  return (
    <AnimatedContent>
      <PageHeader
        title="成员管理"
        description="平台与企业身份彼此独立；成员仅能访问被明确授权的项目。"
        actions={
          <Button onClick={openDrawer}>
            <UserPlus className="h-4 w-4" />
            添加成员
          </Button>
        }
      />

      <Card className="min-w-0">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-56">成员</TableHead>
                  <TableHead className="min-w-44">公司</TableHead>
                  <TableHead className="min-w-32">访问身份</TableHead>
                  <TableHead className="min-w-56">已授权项目</TableHead>
                  <TableHead className="min-w-32">联系方式</TableHead>
                  <TableHead className="min-w-44">创建时间</TableHead>
                  <TableHead className="w-24 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {membersQuery.isLoading ? (
                  Array.from({ length: 4 }).map((_, index) => (
                    <TableRow key={index}>
                      <TableCell colSpan={7}>
                        <Skeleton className="h-8 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : members.length ? (
                  members.map((member) => (
                    <MemberRow
                      key={member.id}
                      member={member}
                      canEdit={member.role !== "admin" && member.id !== user?.id && (isPlatformAdmin || (member.company_id === user?.company_id && !member.is_company_admin))}
                      onEdit={() => setEditingMember(member)}
                    />
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="h-28 text-center text-sm text-muted-foreground">
                      暂无成员
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>添加成员</SheetTitle>
            <SheetDescription>先选择访问身份，再为项目协作成员分配具体项目。项目默认不选。</SheetDescription>
          </SheetHeader>
          <form onSubmit={submit} className="space-y-5">
            {isPlatformAdmin && (
              <div className="space-y-2">
                <Label>账号类型</Label>
                <Select value={accountType} onValueChange={(v) => {
                  setAccountType(v as AccountType);
                  setSelectedProjectIds([]);
                  setCompanyChoice("");
                }}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="platform_admin">平台管理员</SelectItem>
                    <SelectItem value="platform_member">平台成员</SelectItem>
                    <SelectItem value="enterprise_admin">企业管理员</SelectItem>
                    <SelectItem value="enterprise_member">企业成员</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {accountType === "platform_admin" && "可管理整个 AeroLog 平台。"}
                  {accountType === "platform_member" && "可跨企业访问被明确授权的项目。"}
                  {accountType === "enterprise_admin" && "可管理所属企业下的项目与成员。"}
                  {accountType === "enterprise_member" && "只能访问所属企业中被明确授权的项目。"}
                </p>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="member-email">邮箱</Label>
                <Input id="member-email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="member@example.com" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="member-password">初始密码</Label>
                <Input id="member-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="至少 8 位" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="member-name">姓名</Label>
                <Input id="member-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="用户姓名" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="member-title">职位</Label>
                <Input id="member-title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="运营 / 产品 / 开发" />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="member-phone">手机号</Label>
                <Input id="member-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="可选" />
              </div>
            </div>

            {isPlatformAdmin && needsEnterprise && (
              <div className="space-y-4 rounded-md border bg-muted/20 p-3">
                <div className="space-y-2">
                  <Label>所属公司</Label>
                  <Select value={companyChoice} onValueChange={(v) => {
                    setCompanyChoice(v);
                    setSelectedProjectIds([]);
                  }}>
                    <SelectTrigger>
                      <SelectValue placeholder="选择已有公司或新建公司" />
                    </SelectTrigger>
                    <SelectContent>
                      {companies.map((company) => (
                        <SelectItem key={company.id} value={String(company.id)}>
                          {company.name}
                        </SelectItem>
                      ))}
                      {accountType === "enterprise_admin" && <SelectItem value="new">新建公司</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
                {companyChoice === "new" && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="company-name">公司名称</Label>
                      <Input id="company-name" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="公司全称" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="company-industry">所属行业</Label>
                      <Input id="company-industry" value={companyIndustry} onChange={(e) => setCompanyIndustry(e.target.value)} placeholder="可选" />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="company-phone">公司联系电话</Label>
                      <Input id="company-phone" value={companyPhone} onChange={(e) => setCompanyPhone(e.target.value)} placeholder="可选" />
                    </div>
                  </div>
                )}
              </div>
            )}

            {showProjectAssignments && (
              <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <Label>项目授权</Label>
                <Select value={projectRole} onValueChange={(v) => setProjectRole(v as ProjectMember["role"])}>
                  <SelectTrigger className="h-8 w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((item) => (
                      <SelectItem key={item} value={item}>
                        {roleText[item]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="max-h-56 overflow-y-auto rounded-md border">
                {projectOptions.length ? (
                  projectOptions.map((project) => (
                    <ProjectOption
                      key={project.id}
                      project={project}
                      checked={selectedProjectIds.includes(project.id)}
                      onToggle={() => toggleProject(project.id)}
                    />
                  ))
                ) : (
                  <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                    暂无可分配项目
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                当前已选择 {selectedProjectIds.length} 个项目；企业管理员拥有企业内项目的管理权限，无需逐项选择。
              </p>
              </div>
            )}

            {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setDrawerOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={createMut.isPending}>
                {createMut.isPending ? "创建中..." : "创建账号"}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      <EditMemberSheet
        member={editingMember}
        projects={projects}
        isPlatformAdmin={isPlatformAdmin}
        onClose={() => setEditingMember(null)}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["members"] });
          qc.invalidateQueries({ queryKey: ["projects"] });
        }}
      />
    </AnimatedContent>
  );
}

function MemberRow({
  member,
  canEdit,
  onEdit,
}: {
  member: MemberAccount;
  canEdit: boolean;
  onEdit: () => void;
}) {
  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2 font-medium">
          <span>{member.name || member.email}</span>
          {member.status !== 1 && (
            <Badge variant="secondary" className="shrink-0">已停用</Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground">{member.email}</div>
        {member.job_title && <div className="text-xs text-muted-foreground">{member.job_title}</div>}
      </TableCell>
      <TableCell className="text-muted-foreground">{member.company_name || "-"}</TableCell>
      <TableCell>
        {member.role === "admin" ? (
          <Badge variant="success">平台管理员</Badge>
        ) : member.role === "platform_member" ? (
          <Badge variant="outline">平台成员</Badge>
        ) : member.is_company_admin ? (
          <Badge variant="default">企业管理员</Badge>
        ) : (
          <Badge variant="secondary">企业成员</Badge>
        )}
      </TableCell>
      <TableCell>
        <div className="max-w-md truncate text-sm">{member.project_names || "-"}</div>
        <div className="text-xs text-muted-foreground">{member.project_count} 个项目</div>
      </TableCell>
      <TableCell className="text-muted-foreground">{member.phone || "-"}</TableCell>
      <TableCell className="text-muted-foreground">{formatDateTime(member.created_at)}</TableCell>
      <TableCell className="text-right">
        {canEdit ? (
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Pencil className="h-4 w-4" />
            编辑
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        )}
      </TableCell>
    </TableRow>
  );
}

function ProjectOption({
  project,
  checked,
  onToggle,
}: {
  project: Project;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-start gap-3 border-b px-3 py-3 text-left text-sm last:border-b-0 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
          checked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background"
        }`}
        aria-hidden="true"
      >
        {checked ? "✓" : ""}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{project.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {project.company_name || "未归属公司"} · {project.app_type}
          {project.package_name ? ` · ${project.package_name}` : ""}
        </span>
      </span>
    </button>
  );
}

function EditMemberSheet({
  member,
  projects,
  isPlatformAdmin,
  onClose,
  onSaved,
}: {
  member: MemberAccount | null;
  projects: Project[];
  isPlatformAdmin: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [grants, setGrants] = useState<Record<number, ProjectMember["role"]>>({});
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editStatus, setEditStatus] = useState<0 | 1>(1);
  const [error, setError] = useState("");

  const grantsQuery = useQuery({
    queryKey: ["member-projects", member?.id],
    queryFn: () => api.listMemberProjects(member!.id),
    enabled: !!member,
  });

  useEffect(() => {
    if (!member) {
      setGrants({});
      setEditName("");
      setEditEmail("");
      setEditStatus(1);
      setError("");
      return;
    }
    setEditName(member.name || "");
    setEditEmail(member.email || "");
    setEditStatus(member.status === 1 ? 1 : 0);
    const data = grantsQuery.data?.data;
    if (data) {
      const next: Record<number, ProjectMember["role"]> = {};
      for (const g of data as MemberProjectGrant[]) {
        next[g.project_id] = g.role;
      }
      setGrants(next);
    }
  }, [grantsQuery.data, member]);

  const candidateProjects = useMemo(() => {
    if (!member) return [] as Project[];
    if (isPlatformAdmin) {
      // 平台 admin 在同一公司内限定可选项目。
      if (member.company_id > 0) {
        return projects.filter((p) => p.company_id === member.company_id);
      }
      return projects;
    }
    return projects.filter((p) => p.role === "owner" && p.company_id === member.company_id);
  }, [isPlatformAdmin, member, projects]);

  // 企业管理员是企业级角色，不再从某个项目的 Owner 身份推导。
  const isCompanyAdmin = useMemo(() => {
    return !!member?.is_company_admin;
  }, [member]);
  const canEditStatus = isPlatformAdmin || !isCompanyAdmin;

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!member) return;
      // 1) 基本信息 patch（仅提交变更项）
      const patch: { name?: string; email?: string; status?: 0 | 1 } = {};
      const trimmedName = editName.trim();
      const trimmedEmail = editEmail.trim();
      if (trimmedName !== (member.name || "")) patch.name = trimmedName;
      if (trimmedEmail !== (member.email || "")) patch.email = trimmedEmail;
      if (editStatus !== (member.status === 1 ? 1 : 0)) patch.status = editStatus;
      if (Object.keys(patch).length > 0) {
        await api.updateMemberAccount(member.id, patch);
      }
      // 2) 项目授权同步
      await api.updateMemberProjects(member.id, {
        projects: Object.entries(grants).map(([pid, role]) => ({ project_id: Number(pid), role })),
      });
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  function toggleProject(id: number) {
    setGrants((prev) => {
      const next = { ...prev };
      if (next[id]) {
        delete next[id];
      } else {
        next[id] = "viewer";
      }
      return next;
    });
  }

  function changeRole(id: number, role: ProjectMember["role"]) {
    setGrants((prev) => ({ ...prev, [id]: role }));
  }

  const open = !!member;
  const selectedCount = Object.keys(grants).length;
  const candidateIds = new Set(candidateProjects.map((p) => p.id));
  const lockedGrants = Object.entries(grants)
    .filter(([pid]) => !candidateIds.has(Number(pid)))
    .map(([pid, role]) => ({ id: Number(pid), role }));

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>编辑成员</SheetTitle>
          <SheetDescription>
            {member ? `修改${member.name || member.email}的基本信息、账号状态以及项目授权。` : ""}
          </SheetDescription>
        </SheetHeader>
        {grantsQuery.isLoading ? (
          <div className="space-y-3 py-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-3 rounded-md border bg-muted/10 p-3">
              <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                <span>基本信息</span>
                {isCompanyAdmin && (
                  <Badge variant="secondary">企业管理员</Badge>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="edit-member-name">姓名</Label>
                  <Input
                    id="edit-member-name"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="用户姓名"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-member-email">邮箱</Label>
                  <Input
                    id="edit-member-email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    placeholder="member@example.com"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>账号状态</Label>
                  <Select
                    value={String(editStatus)}
                    onValueChange={(v) => setEditStatus(v === "1" ? 1 : 0)}
                    disabled={!canEditStatus}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">启用</SelectItem>
                      <SelectItem value="0">停用</SelectItem>
                    </SelectContent>
                  </Select>
                  {!canEditStatus && (
                    <p className="text-xs text-muted-foreground">
                      企业管理员的启用、停用需由平台管理员操作。
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>项目授权：已选 {selectedCount} 个</span>
              <span>可选 {candidateProjects.length} 个</span>
            </div>
            <div className="max-h-[40vh] overflow-y-auto rounded-md border">
              {candidateProjects.length ? (
                candidateProjects.map((project) => {
                  const role = grants[project.id];
                  const checked = !!role;
                  return (
                    <div key={project.id} className="flex items-start gap-3 border-b px-3 py-3 last:border-b-0">
                      <button
                        type="button"
                        onClick={() => toggleProject(project.id)}
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          checked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background"
                        }`}
                        aria-label="toggle"
                      >
                        {checked ? "✓" : ""}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{project.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {project.company_name || "未归属公司"} · {project.app_type}
                          {project.package_name ? ` · ${project.package_name}` : ""}
                        </div>
                      </div>
                      {checked && (
                        <Select value={role} onValueChange={(v) => changeRole(project.id, v as ProjectMember["role"])}>
                          <SelectTrigger className="h-8 w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {roles.map((item) => (
                              <SelectItem key={item} value={item}>
                                {roleText[item]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">暂无可分配项目</div>
              )}
            </div>
            {lockedGrants.length > 0 && (
              <div className="rounded-md border border-dashed bg-muted/20 p-3 text-xs text-muted-foreground">
                还有 {lockedGrants.length} 个项目不在当前管理范围内，保存时将保留原有授权。
              </div>
            )}
            {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>
                取消
              </Button>
              <Button type="button" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
                {saveMut.isPending ? "保存中..." : "保存"}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
