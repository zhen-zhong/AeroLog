"use client";

import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { api, MemberAccount, Project, ProjectMember } from "@/lib/api";
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
  owner: "Owner",
  editor: "Editor",
  viewer: "Viewer",
};

const accountTypeText = {
  internal: "平台内部账号",
  company: "公司账号",
};

type AccountType = keyof typeof accountTypeText;

export default function MembersPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isPlatformAdmin = user?.role === "admin";
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [accountType, setAccountType] = useState<AccountType>("company");
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

  const membersQuery = useQuery({
    queryKey: ["members"],
    queryFn: () => api.listMembers(),
  });
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects(),
  });
  const companiesQuery = useQuery({
    queryKey: ["companies"],
    queryFn: () => api.listCompanies(),
    enabled: isPlatformAdmin,
  });

  const members = membersQuery.data?.data || [];
  const projects = projectsQuery.data?.data || [];
  const companies = companiesQuery.data?.data || [];
  const selectedCompanyId = companyChoice && companyChoice !== "new" ? Number(companyChoice) : undefined;

  const projectOptions = useMemo(() => {
    if (isPlatformAdmin && accountType === "company" && selectedCompanyId) {
      return projects.filter((project) => project.company_id === selectedCompanyId);
    }
    if (isPlatformAdmin && accountType === "company" && companyChoice === "new") {
      return [];
    }
    if (!isPlatformAdmin) {
      return projects.filter((project) => project.role === "owner");
    }
    return projects;
  }, [accountType, companyChoice, isPlatformAdmin, projects, selectedCompanyId]);

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
    setAccountType("company");
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
    if (isPlatformAdmin && accountType === "company" && !selectedCompanyId && !companyName.trim()) {
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
      project_ids: selectedProjectIds,
      project_role: projectRole,
    });
  }

  return (
    <AnimatedContent>
      <PageHeader
        title="成员管理"
        description="添加成员会同时完成账号注册，并按项目授权；未授权项目默认不可见。"
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
                  <TableHead className="min-w-32">账号类型</TableHead>
                  <TableHead className="min-w-56">已授权项目</TableHead>
                  <TableHead className="min-w-32">联系方式</TableHead>
                  <TableHead className="min-w-44">创建时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {membersQuery.isLoading ? (
                  Array.from({ length: 4 }).map((_, index) => (
                    <TableRow key={index}>
                      <TableCell colSpan={6}>
                        <Skeleton className="h-8 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : members.length ? (
                  members.map((member) => <MemberRow key={member.id} member={member} />)
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="h-28 text-center text-sm text-muted-foreground">
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
            <SheetDescription>填写注册信息，并选择该成员可以访问的项目。项目默认不选。</SheetDescription>
          </SheetHeader>
          <form onSubmit={submit} className="space-y-5">
            {isPlatformAdmin && (
              <div className="space-y-2">
                <Label>账号类型</Label>
                <Select value={accountType} onValueChange={(v) => {
                  setAccountType(v as AccountType);
                  setSelectedProjectIds([]);
                }}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="company">公司账号</SelectItem>
                    <SelectItem value="internal">平台内部账号</SelectItem>
                  </SelectContent>
                </Select>
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

            {isPlatformAdmin && accountType === "company" && (
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
                      <SelectItem value="new">新建公司</SelectItem>
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

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <Label>指定项目</Label>
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
                当前已选择 {selectedProjectIds.length} 个项目；不选择则账号创建后暂时无法查看任何项目。
              </p>
            </div>

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
    </AnimatedContent>
  );
}

function MemberRow({ member }: { member: MemberAccount }) {
  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{member.name || member.email}</div>
        <div className="text-xs text-muted-foreground">{member.email}</div>
        {member.job_title && <div className="text-xs text-muted-foreground">{member.job_title}</div>}
      </TableCell>
      <TableCell className="text-muted-foreground">{member.company_name || "-"}</TableCell>
      <TableCell>
        <Badge variant={member.role === "admin" ? "success" : "secondary"}>
          {member.role === "admin" ? "平台 Admin" : "项目成员"}
        </Badge>
      </TableCell>
      <TableCell>
        <div className="max-w-md truncate text-sm">{member.project_names || "-"}</div>
        <div className="text-xs text-muted-foreground">{member.project_count} 个项目</div>
      </TableCell>
      <TableCell className="text-muted-foreground">{member.phone || "-"}</TableCell>
      <TableCell className="text-muted-foreground">{formatDateTime(member.created_at)}</TableCell>
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
