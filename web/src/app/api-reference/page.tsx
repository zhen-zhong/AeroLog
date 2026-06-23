import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { MarketingShell } from "@/components/landing/MarketingShell";

const endpoints = [
  ["事件上报", "POST /v1/track", "由 Collector 接收一次用户行为，SDK 已内置此调用。"],
  ["项目列表", "GET /v1/projects", "读取当前账号可访问的项目。"],
  ["漏斗分析", "POST /v1/projects/:id/analytics/funnel", "按行为步骤计算路径转化与流失。"],
  ["留存分析", "GET /v1/projects/:id/analytics/retention", "按初始行为和返回行为计算同期留存。"],
];

export default function ApiReferencePage() {
  return (
    <MarketingShell>
      <main>
        <section className="border-b border-border/70 px-6 py-20 sm:py-24">
          <div className="mx-auto max-w-5xl">
            <p className="text-sm font-semibold text-primary">API 参考</p>
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">把行为数据接入你的业务。</h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">所有 SDK 都基于同一套事件协议；服务端接入可直接参考以下能力。</p>
          </div>
        </section>
        <section className="px-6 py-14 sm:py-20">
          <div className="mx-auto max-w-5xl overflow-hidden rounded-xl border border-border">
            {endpoints.map(([name, endpoint, description]) => (
              <div key={endpoint} className="grid gap-3 border-b border-border p-5 last:border-b-0 md:grid-cols-[180px_1fr_1.2fr] md:items-center">
                <h2 className="font-semibold">{name}</h2>
                <code className="w-fit rounded bg-secondary px-2 py-1 text-xs text-secondary-foreground">{endpoint}</code>
                <p className="text-sm leading-6 text-muted-foreground">{description}</p>
              </div>
            ))}
          </div>
          <Link href="/docs" className="mx-auto mt-8 flex max-w-5xl items-center gap-1.5 text-sm font-semibold text-primary hover:text-primary/75">
            查看 SDK 接入指南 <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      </main>
    </MarketingShell>
  );
}
