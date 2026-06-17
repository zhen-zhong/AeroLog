"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
  Route,
  ShieldCheck,
  Users,
  Waypoints,
} from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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
    ],
  },
];

const navItems = navGroups.flatMap((group) => group.items);

function useActivePath() {
  const pathname = usePathname() || "/";
  return [...navItems]
    .sort((a, b) => b.href.length - a.href.length)
    .find((item) => pathname.startsWith(item.href))?.href;
}

function NavList({ closeOnNavigate = false }: { closeOnNavigate?: boolean }) {
  const activePath = useActivePath();
  return (
    <nav className="flex flex-col gap-5">
      {navGroups.map((group) => (
        <div key={group.label}>
          <div className="mb-2 px-3 text-xs font-medium text-muted-foreground">{group.label}</div>
          <div className="flex flex-col gap-1">
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = activePath === item.href;
              const link = (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                    active && "bg-accent text-accent-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
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

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r bg-card lg:block">
        <div className="flex h-full flex-col">
          <div className="flex h-16 items-center gap-2 border-b px-5">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <PanelLeft className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold leading-5">AeroLog</div>
              <div className="text-xs text-muted-foreground">埋点分析控制台</div>
            </div>
          </div>
          <div className="flex-1 px-3 py-4">
            <NavList />
          </div>
          <div className="border-t p-4">
            <Badge variant="info">MVP 数据治理</Badge>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              事件、属性、画像和身份映射已经进入同一条消费链路。
            </p>
          </div>
        </div>
      </aside>

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

      <main className="min-h-dvh lg:pl-64">
        <div className="mx-auto w-full max-w-[1480px] px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
          {children}
        </div>
      </main>
    </div>
  );
}
