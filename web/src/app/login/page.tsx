"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, LockKeyhole, UserPlus } from "lucide-react";
import { api } from "@/lib/api";
import { AnimatedContent } from "@/components/react-bits/animated-content";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuthStore } from "@/stores/auth-store";

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginPanel />
    </Suspense>
  );
}

function LoginFallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-6 text-sm text-muted-foreground">
      正在打开登录页...
    </div>
  );
}

function LoginPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = useAuthStore((s) => s.token);
  const setAuth = useAuthStore((s) => s.setAuth);
  const [mode, setMode] = useState<"login" | "register">(
    () => (searchParams.get("mode") === "register" ? "register" : "login"),
  );
  const [email, setEmail] = useState("admin@aerolog.local");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyIndustry, setCompanyIndustry] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [password, setPassword] = useState("aerolog123");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const next = useMemo(() => {
    const raw = searchParams.get("next");
    return raw && raw.startsWith("/") ? raw : "/console";
  }, [searchParams]);

  useEffect(() => {
    if (token) router.replace(next);
  }, [next, router, token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res =
        mode === "login"
          ? await api.login({ email, password })
          : await api.register({
              email,
              name,
              password,
              phone,
              job_title: jobTitle,
              company_name: companyName,
              company_industry: companyIndustry,
              company_phone: companyPhone,
            });
      setAuth(res.data.token, res.data.user);
      router.replace(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <AnimatedContent className="w-full max-w-xl">
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <LockKeyhole className="h-5 w-5" />
              </div>
              <Badge variant="info">真实登录</Badge>
            </div>
            <div>
              <CardTitle className="text-xl">登录 AeroLog 控制台</CardTitle>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {mode === "login"
                  ? "默认本地管理员：admin@aerolog.local / aerolog123"
                  : "对外开户会同时创建公司空间，项目用于接入具体 App 或 Web。"}
              </p>
            </div>
          </CardHeader>
          <CardContent>
            <Tabs value={mode} onValueChange={(v) => setMode(v as "login" | "register")} className="mb-5">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">登录</TabsTrigger>
                <TabsTrigger value="register">注册</TabsTrigger>
              </TabsList>
            </Tabs>

            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">邮箱</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                />
              </div>
              {mode === "register" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="company-name">公司名称</Label>
                    <Input
                      id="company-name"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder="如：星河科技有限公司"
                      autoComplete="organization"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="company-industry">行业</Label>
                    <Input
                      id="company-industry"
                      value={companyIndustry}
                      onChange={(e) => setCompanyIndustry(e.target.value)}
                      placeholder="电商 / SaaS / 游戏"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="company-phone">公司电话</Label>
                    <Input
                      id="company-phone"
                      value={companyPhone}
                      onChange={(e) => setCompanyPhone(e.target.value)}
                      placeholder="选填"
                      autoComplete="tel"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="name">联系人姓名</Label>
                    <Input
                      id="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="控制台显示名"
                      autoComplete="name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="job-title">职位</Label>
                    <Input
                      id="job-title"
                      value={jobTitle}
                      onChange={(e) => setJobTitle(e.target.value)}
                      placeholder="数据负责人 / 开发"
                      autoComplete="organization-title"
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="phone">联系人手机</Label>
                    <Input
                      id="phone"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="选填"
                      autoComplete="tel"
                    />
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="password">密码</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="至少 8 位"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  required
                />
              </div>
              {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={submitting}>
                {mode === "login" ? <ArrowRight className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                {submitting ? "处理中..." : mode === "login" ? "登录" : "注册并登录"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </AnimatedContent>
    </div>
  );
}
