import { MarketingShell } from "@/components/landing/MarketingShell";

export default function AboutPage() {
  return (
    <MarketingShell>
      <main>
        <section className="border-b border-border/70 px-6 py-20 sm:py-24">
          <div className="mx-auto max-w-4xl">
            <p className="text-sm font-semibold text-primary">关于 AeroLog</p>
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">把用户行为，变成更好的产品决策。</h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
              AeroLog 为产品、运营、增长与研发团队提供统一的行为数据基础，让每一次浏览、点击和转化都能被理解与使用。
            </p>
          </div>
        </section>
        <section className="px-6 py-16 sm:py-20">
          <div className="mx-auto grid max-w-4xl gap-12 md:grid-cols-2">
            <div>
              <h2 className="text-2xl font-semibold">我们相信数据应该被看懂</h2>
              <p className="mt-4 leading-7 text-muted-foreground">
                好的数据产品不只是记录更多事件，而是帮助团队更快回答：用户从哪里来、为什么留下、又在哪一步离开。
              </p>
            </div>
            <div>
              <h2 className="text-2xl font-semibold">为多端体验而生</h2>
              <p className="mt-4 leading-7 text-muted-foreground">
                Android、iOS 与 Web 使用统一的行为语言，团队可以在同一视角下理解完整用户旅程，并将洞察带回实际业务。
              </p>
            </div>
          </div>
        </section>
      </main>
    </MarketingShell>
  );
}
