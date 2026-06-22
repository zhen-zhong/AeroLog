"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Boxes,
  Bug,
  CircleDot,
  FolderKanban,
  GitBranch,
  LayoutDashboard,
  Menu,
  PanelLeft,
  RefreshCw,
  Route,
  ShieldCheck,
  UserCog,
  Users,
  Waypoints,
} from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { TopHeader } from "@/components/layout/top-header";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { useUIStore } from "@/stores/ui-store";

const navGroups = [
  {
    label: "报表",
    items: [
      { href: "/console", label: "概览", icon: LayoutDashboard },
      { href: "/console/realtime", label: "实时", icon: CircleDot },
      { href: "/console/event", label: "事件", icon: BarChart3 },
      { href: "/console/query", label: "查询", icon: Boxes },
      { href: "/console/debugger", label: "调试器", icon: Bug },
      { href: "/console/conversions", label: "转化", icon: Waypoints },
      { href: "/console/funnel", label: "漏斗", icon: GitBranch },
      { href: "/console/retention", label: "留存", icon: Route },
      { href: "/console/users", label: "用户", icon: Users },
    ],
  },
  {
    label: "配置",
    items: [
      { href: "/console/governance", label: "数据治理", icon: ShieldCheck },
      { href: "/admin/projects", label: "项目管理", icon: FolderKanban },
      { href: "/admin/members", label: "成员管理", icon: UserCog, requires: "company_admin" as const },
    ],
  },
];

const navItems = navGroups.flatMap((group) => group.items);
const routeHistoryKey = "aerolog-route-history";

function useActivePath() {
  const pathname = usePathname() || "/";
  return [...navItems]
    .sort((a, b) => b.href.length - a.href.length)
    .find((item) => pathname.startsWith(item.href))?.href;
}

function NavList({
  collapsed = false,
  closeOnNavigate = false,
}: {
  collapsed?: boolean;
  closeOnNavigate?: boolean;
}) {
  const activePath = useActivePath();
  const user = useAuthStore((s) => s.user);
  const isPlatformAdmin = user?.role === "admin";
  const isCompanyAdmin = user?.role === "company_admin";
  const canManageMembers = isPlatformAdmin || isCompanyAdmin;
  return (
    <nav className={cn("flex flex-col", collapsed ? "gap-3" : "gap-5")}>
      {navGroups.map((group) => (
        <div key={group.label}>
          {!collapsed && (
            <div className="mb-2 px-3 text-xs font-medium text-muted-foreground">{group.label}</div>
          )}
          <div className="flex flex-col gap-1">
            {group.items
              .filter((item) => {
                if ("requires" in item && item.requires === "company_admin") {
                  return canManageMembers;
                }
                return true;
              })
              .map((item) => {
              const Icon = item.icon;
              const active = activePath === item.href;
              const link = (
                <Link
                  key={item.href}
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    "flex h-9 items-center rounded-md text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                    collapsed ? "mx-auto w-9 justify-center" : "gap-2 px-3",
                    active && "bg-accent text-accent-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span>{item.label}</span>}
                </Link>
              );
              if (!closeOnNavigate) return link;
              return (
                <SheetClose key={item.href} asChild>
                  {link}
                </SheetClose>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function routeLabel(pathname: string) {
  const item = [...navItems]
    .sort((a, b) => b.href.length - a.href.length)
    .find((nav) => pathname.startsWith(nav.href));
  return item?.label || pathname;
}

function RouteHistoryBar() {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const qc = useQueryClient();
  const [routes, setRoutes] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (pathname === "/" || pathname === "/login" || pathname.startsWith("/console/query/shared/")) return;
    setRoutes((prev) => {
      const cleaned = prev.filter((item) => item && item !== "/");
      const next = cleaned.includes(pathname) ? cleaned : [...cleaned, pathname].slice(-8);
      window.localStorage.setItem(routeHistoryKey, JSON.stringify(next));
      return next;
    });
  }, [pathname]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(routeHistoryKey);
      if (raw) {
        const next = (JSON.parse(raw) as string[]).filter((item) => item && item !== "/");
        setRoutes(next);
        window.localStorage.setItem(routeHistoryKey, JSON.stringify(next));
      }
    } catch {
      setRoutes([]);
    }
  }, []);

  function closeRoute(route: string) {
    setRoutes((prev) => {
      const next = prev.filter((item) => item !== route);
      window.localStorage.setItem(routeHistoryKey, JSON.stringify(next));
      return next;
    });
  }

  async function refreshCurrentRoute() {
    setRefreshing(true);
    try {
      await qc.invalidateQueries({ refetchType: "active" });
      router.refresh();
    } finally {
      window.setTimeout(() => setRefreshing(false), 180);
    }
  }

  return (
    <div className="sticky top-14 z-20 border-b bg-card/90 backdrop-blur lg:top-14">
      <div className="flex min-h-11 items-center justify-between gap-3 px-4 py-2 sm:px-6 lg:px-8">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
          {routes.length ? (
            routes.map((route) => (
              <div
                key={route}
                className={cn(
                  "group flex h-7 shrink-0 items-center rounded-md border text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
                  route === pathname
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground",
                )}
              >
                <Link href={route} className="px-2.5 py-1">
                  {routeLabel(route)}
                </Link>
                <button
                  type="button"
                  className="mr-1 flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    closeRoute(route);
                  }}
                  aria-label={`关闭${routeLabel(route)}`}
                  title="关闭"
                >
                  ×
                </button>
              </div>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">暂无访问记录</span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={refreshCurrentRoute}
          disabled={refreshing}
          aria-label="刷新当前页面"
          title="刷新当前页面"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
        </Button>
      </div>
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const setAuth = useAuthStore((s) => s.setAuth);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const setHasHydrated = useAuthStore((s) => s.setHasHydrated);
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const isPublicPage = pathname === "/login" || pathname.startsWith("/console/query/shared/");

  useEffect(() => {
    if (hasHydrated) return;
    const timer = window.setTimeout(() => setHasHydrated(true), 500);
    return () => window.clearTimeout(timer);
  }, [hasHydrated, setHasHydrated]);

  useEffect(() => {
    if (!hasHydrated || isPublicPage || token) return;
    const next = encodeURIComponent(pathname);
    router.replace(`/login?next=${next}`);
  }, [hasHydrated, isPublicPage, pathname, router, token]);

  useEffect(() => {
    if (!hasHydrated || isPublicPage || !token) return;
    let cancelled = false;
    api.me()
      .then((res) => {
        if (!cancelled) setAuth(token, res.data);
      })
      .catch(() => {
        if (!cancelled) {
          clearAuth();
          router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [clearAuth, hasHydrated, isPublicPage, pathname, router, setAuth, token]);

  if (isPublicPage) {
    return <div className="min-h-dvh bg-background">{children}</div>;
  }

  if (!hasHydrated || !token) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-6 text-sm text-muted-foreground">
        正在校验登录状态...
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 hidden border-r bg-card transition-[width] duration-200 ease-in-out lg:block",
          collapsed ? "w-16" : "w-64",
        )}
      >
        <div className="flex h-full flex-col">
          <div
            className={cn(
              "flex h-14 items-center border-b",
              collapsed ? "justify-center px-2" : "gap-2 px-5",
            )}
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <PanelLeft className="h-4 w-4" />
            </div>
            {!collapsed && (
              <div>
                <div className="text-sm font-semibold leading-5">AeroLog</div>
                <div className="text-xs text-muted-foreground">埋点分析控制台</div>
              </div>
            )}
          </div>
          <div className={cn("flex-1 py-4", collapsed ? "px-2" : "px-3")}>
            <NavList collapsed={collapsed} />
          </div>
          {!collapsed && (
            <div className="border-t p-4">
              <Badge variant="info">MVP 数据治理</Badge>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                事件、属性、画像和身份映射已经进入同一条消费链路。
              </p>
            </div>
          )}
        </div>
      </aside>

      {/* 移动端 Header（保留原逻辑） */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-card px-4 lg:hidden">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <PanelLeft className="h-4 w-4" />
          </div>
          <span className="text-sm font-semibold">AeroLog</span>
        </div>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" aria-label="打开菜单">
              <Menu className="h-4 w-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-80">
            <SheetHeader>
              <SheetTitle>AeroLog</SheetTitle>
            </SheetHeader>
            <div className="mt-6">
              <NavList closeOnNavigate />
            </div>
          </SheetContent>
        </Sheet>
      </header>

      <main
        className={cn(
          "min-h-dvh transition-[padding] duration-200 ease-in-out",
          collapsed ? "lg:pl-16" : "lg:pl-64",
        )}
      >
        <TopHeader />
        <RouteHistoryBar />
        <div className="mx-auto w-full max-w-[1480px] px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
          {children}
        </div>
      </main>
    </div>
  );
}
