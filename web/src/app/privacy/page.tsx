import { MarketingShell } from "@/components/landing/MarketingShell";

export default function PrivacyPage() {
  return (
    <MarketingShell>
      <main className="px-6 py-16 sm:py-20">
        <article className="mx-auto max-w-3xl">
          <p className="text-sm font-semibold text-primary">隐私政策</p>
          <h1 className="mt-4 text-4xl font-bold tracking-tight">我们如何对待数据</h1>
          <p className="mt-4 text-sm text-muted-foreground">最后更新：2026 年 6 月 23 日</p>
          <div className="mt-12 space-y-9 text-sm leading-7 text-muted-foreground">
            <section>
              <h2 className="text-xl font-semibold text-foreground">数据处理范围</h2>
              <p className="mt-3">AeroLog 仅按客户配置接收与处理用于产品分析的事件、属性与身份标识。客户应确保其采集行为符合适用法律与其对终端用户作出的承诺。</p>
            </section>
            <section>
              <h2 className="text-xl font-semibold text-foreground">数据安全</h2>
              <p className="mt-3">我们通过访问控制、传输保护与最小权限原则保护平台数据。平台管理员可管理组织、项目与成员的访问范围。</p>
            </section>
            <section>
              <h2 className="text-xl font-semibold text-foreground">数据控制</h2>
              <p className="mt-3">客户可以在项目中配置采集内容、成员权限与数据保留策略；如需处理数据相关请求，请联系你的组织管理员。</p>
            </section>
          </div>
        </article>
      </main>
    </MarketingShell>
  );
}
