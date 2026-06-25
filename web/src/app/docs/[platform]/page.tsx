import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { MarketingShell } from "@/components/landing/MarketingShell";

const guides = {
  android: {
    title: "Android 接入",
    subtitle: "使用 Kotlin / Java SDK 采集应用行为。",
    install: "在宿主工程中引入 AeroLog Android SDK。",
    setup: `import android.app.Application
import dev.aerolog.sdk.AeroLog
import dev.aerolog.sdk.AeroConfig

class MyApp : Application() {
  override fun onCreate() {
    super.onCreate()

    // SaaS：默认上报到 https://collector.aerolog.cc
    AeroLog.init(
      this,
      AeroConfig(token = "YOUR_PROJECT_TOKEN")
    )

    // 私有化部署：覆盖 serverUrl
    AeroLog.init(
      this,
      AeroConfig(
        token = "YOUR_PROJECT_TOKEN",
        serverUrl = "https://collector.your-company.com"
      )
    )
  }
}`,
    track: `AeroLog.track(
  "button_click",
  mapOf("button" to "checkout")
)`,
  },
  web: {
    title: "Web 接入",
    subtitle: "使用 TypeScript SDK 采集网站与 Web 应用行为。",
    install: "安装 Web SDK：pnpm add @aerolog/web（或 npm i / yarn add）。",
    setup: `// 建议在应用入口初始化，如 Next.js 的 app/layout.tsx 顶部
// 或传统 SPA 的 src/main.ts / src/index.ts
import { init } from "@aerolog/web";

// SaaS：默认上报到 https://collector.aerolog.cc
export const aero = init({
  token: "YOUR_PROJECT_TOKEN",
});

// 私有化部署：覆盖 serverUrl
export const aero2 = init({
  token: "YOUR_PROJECT_TOKEN",
  serverUrl: "https://collector.your-company.com",
});`,
    track: `aero.track("button_click", {
  button: "checkout"
});`,
  },
  ios: {
    title: "iOS 接入",
    subtitle: "使用 Swift Package SDK 采集原生 iOS 应用行为。",
    install: "在 Xcode 中添加 AeroLog Swift Package（File → Add Packages）。",
    setup: `import UIKit
import AeroLog

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {

    // SaaS：默认上报到 https://collector.aerolog.cc
    AeroLog.shared.setup(AeroConfig(token: "YOUR_PROJECT_TOKEN"))

    // 私有化部署：覆盖 serverUrl
    AeroLog.shared.setup(AeroConfig(
      token: "YOUR_PROJECT_TOKEN",
      serverUrl: "https://collector.your-company.com"
    ))

    return true
  }
}`,
    track: `AeroLog.shared.track(
  "button_click",
  properties: ["button": "checkout"]
)`,
  },
} as const;

export function generateStaticParams() {
  return Object.keys(guides).map((platform) => ({ platform }));
}

export default function PlatformGuidePage({ params }: { params: { platform: string } }) {
  const guide = guides[params.platform as keyof typeof guides];
  if (!guide) notFound();

  return (
    <MarketingShell>
      <main className="px-6 py-12 sm:py-16">
        <article className="mx-auto max-w-3xl">
          <Link href="/docs" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> 返回接入指南
          </Link>
          <p className="mt-10 text-sm font-semibold text-primary">SDK 接入</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">{guide.title}</h1>
          <p className="mt-4 text-lg text-muted-foreground">{guide.subtitle}</p>

          <div className="mt-12 space-y-10">
            <GuideStep number="1" title="安装或引入 SDK">
              <p>{guide.install}</p>
            </GuideStep>
            <GuideStep number="2" title="初始化">
              <CodeBlock code={guide.setup} />
            </GuideStep>
            <GuideStep number="3" title="上报事件">
              <p>在用户完成关键操作时调用 track，上报事件名和必要的业务属性。</p>
              <CodeBlock code={guide.track} />
            </GuideStep>
          </div>
        </article>
      </main>
    </MarketingShell>
  );
}

function GuideStep({ number, title, children }: { number: string; title: string; children: ReactNode }) {
  return (
    <section>
      <div className="flex items-center gap-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{number}</span>
        <h2 className="text-xl font-semibold">{title}</h2>
      </div>
      <div className="mt-4 pl-10 text-sm leading-7 text-muted-foreground">{children}</div>
    </section>
  );
}

function CodeBlock({ code }: { code: string }) {
  return <pre className="mt-4 overflow-x-auto rounded-lg bg-secondary p-4 text-xs leading-6 text-secondary-foreground"><code>{code}</code></pre>;
}
