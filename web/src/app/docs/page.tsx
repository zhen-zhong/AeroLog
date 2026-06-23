import Link from "next/link";
import { ArrowRight, Code2, Globe2, Smartphone } from "lucide-react";
import { MarketingShell } from "@/components/landing/MarketingShell";

const guides = [
  {
    href: "/docs/android",
    title: "Android 接入",
    description: "Kotlin / Java SDK，支持自动采集、离线缓存与批量重试。",
    Icon: Smartphone,
    badge: "Android",
  },
  {
    href: "/docs/web",
    title: "Web 接入",
    description: "TypeScript SDK，快速接入页面浏览、点击与业务事件。",
    Icon: Globe2,
    badge: "Web",
  },
  {
    href: "/docs/ios",
    title: "iOS 接入",
    description: "Swift Package SDK，适配原生应用生命周期与离线场景。",
    Icon: Code2,
    badge: "iOS",
  },
];

export default function DocsPage() {
  return (
    <MarketingShell>
      <main>
        <section className="border-b border-border/70 px-6 py-20 sm:py-24">
          <div className="mx-auto max-w-5xl">
            <p className="text-sm font-semibold text-primary">接入指南</p>
            <h1 className="mt-4 max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">从第一条事件开始</h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
              选择你的平台，完成项目配置、SDK 初始化和一次事件上报，即可在 AeroLog 中查看用户行为。
            </p>
          </div>
        </section>

        <section className="px-6 py-14 sm:py-20">
          <div className="mx-auto grid max-w-5xl gap-5 md:grid-cols-3">
            {guides.map(({ href, title, description, Icon, badge }) => (
              <Link key={href} href={href} className="group rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary/45 hover:bg-primary/[0.03]">
                <div className="flex items-start justify-between gap-4">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">{badge}</span>
                </div>
                <h2 className="mt-5 text-xl font-semibold">{title}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
                <span className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
                  查看步骤 <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className="bg-secondary/45 px-6 py-14">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-2xl font-semibold">通用接入流程</h2>
            <div className="mt-8 grid gap-5 md:grid-cols-3">
              {[
                ["创建项目", "在控制台创建应用，获得项目 Token。"],
                ["初始化 SDK", "将 Token 与采集地址配置到你的应用。"],
                ["验证首个事件", "上报一次行为，在实时事件流中确认结果。"],
              ].map(([title, text], index) => (
                <div key={title} className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{index + 1}</span>
                  <div>
                    <h3 className="font-semibold">{title}</h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </MarketingShell>
  );
}
