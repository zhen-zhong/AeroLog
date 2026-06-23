import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, PanelLeft } from "lucide-react";

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border/70 bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <PanelLeft className="h-4 w-4" />
            </span>
            <span className="text-sm font-semibold">AeroLog</span>
          </Link>
          <nav className="hidden items-center gap-5 text-sm text-muted-foreground md:flex">
            <Link href="/docs" className="hover:text-foreground">文档</Link>
            <Link href="/api-reference" className="hover:text-foreground">API 参考</Link>
            <Link href="/about" className="hover:text-foreground">关于我们</Link>
          </nav>
          <Link
            href="/console"
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
          >
            前往控制台 <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </header>
      {children}
      <footer className="border-t border-border/70 px-6 py-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 AeroLog</span>
          <div className="flex gap-4">
            <Link href="/about" className="hover:text-foreground">关于我们</Link>
            <Link href="/privacy" className="hover:text-foreground">隐私政策</Link>
            <Link href="/docs" className="hover:text-foreground">文档</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
