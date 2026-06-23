"use client";

import { motion, useReducedMotion } from "framer-motion";
import { AnimatedCounter } from "@/components/landing/AnimatedCounter";

const platforms = [
  { icon: "📱", name: "Android", action: "打开应用" },
  { icon: "🍎", name: "iOS", action: "完成浏览" },
  { icon: "🌐", name: "Web", action: "加入购物车" },
];

export function DataFlowAnimation() {
  const reduceMotion = useReducedMotion();

  return (
    <div className="relative aspect-square w-full lg:aspect-[6/5]">
      <div className="absolute inset-[7%] rounded-[28%] bg-primary/15 blur-3xl" />

      <motion.div
        className="relative h-full overflow-hidden rounded-2xl border border-border bg-card/90 p-4 backdrop-blur sm:p-5"
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
      >
        <div className="aero-scan-line absolute inset-x-0 top-0 h-px" />
        <div className="pointer-events-none absolute inset-0 aero-signal-surface opacity-25" />

        <div className="relative z-10 flex h-full flex-col gap-2 sm:gap-3">
          <header className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-foreground">今天，用户正在这样使用你的产品</p>
              <p className="mt-1 text-[11px] text-muted-foreground">来自 Android、iOS 与 Web 的真实行为</p>
            </div>
            <motion.span
              className="mt-1 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary"
              animate={reduceMotion ? undefined : { opacity: [0.65, 1, 0.65] }}
              transition={{ duration: 1.6, repeat: Infinity }}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-primary" /> 实时
            </motion.span>
          </header>

          <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
            {platforms.map((platform, index) => (
              <motion.div
                key={platform.name}
                className="rounded-lg border border-border bg-background/80 px-2 py-2.5 text-center sm:p-3"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.16 + index * 0.1, duration: 0.3 }}
              >
                <div className="text-base leading-none sm:text-lg">{platform.icon}</div>
                <div className="mt-1 text-[10px] font-semibold sm:text-xs">{platform.name}</div>
                <motion.div
                  className="mt-1.5 rounded bg-secondary px-1 py-1 text-[9px] text-secondary-foreground"
                  animate={reduceMotion ? undefined : { opacity: [0.55, 1, 0.55] }}
                  transition={{ duration: 1.7, delay: index * 0.25, repeat: Infinity }}
                >
                  {platform.action}
                </motion.div>
              </motion.div>
            ))}
          </div>

          <section className="rounded-xl border border-primary/25 bg-primary/[0.055] p-3 sm:p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xs font-semibold text-foreground sm:text-sm">用户旅程，一目了然</h2>
                <p className="mt-0.5 text-[10px] text-muted-foreground">从第一次触达，到一次真实转化</p>
              </div>
              <span className="rounded-full bg-background px-2 py-1 text-[9px] font-medium text-primary">
                转化率 <AnimatedCounter end={28.6} decimals={1} suffix="%" duration={1.6} />
              </span>
            </div>

            <motion.p
              className="mt-4 rounded-lg bg-background/70 px-3 py-2.5 text-xs leading-5 text-muted-foreground"
              animate={reduceMotion ? undefined : { opacity: [0.72, 1, 0.72] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            >
              多端行为已自动汇总，让团队在同一视角下理解用户价值。
            </motion.p>
          </section>

          <div className="grid grid-cols-4 gap-1.5 sm:gap-3">
            {[
              { label: "正在浏览", end: 9036, suffix: " 人" },
              { label: "准备下单", end: 5247, suffix: " 人" },
              { label: "新增转化", end: 2118, prefix: "+" },
              { label: "次日留存", end: 68.4, suffix: "%", decimals: 1 },
            ].map(({ label, end, prefix, suffix, decimals }, index) => (
              <motion.div
                key={label}
                className="rounded-lg border border-border bg-card/75 px-1.5 py-2 sm:px-3 sm:py-2.5"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.48 + index * 0.08, duration: 0.3 }}
              >
                <div className="whitespace-nowrap text-[8px] text-muted-foreground sm:text-[10px]">{label}</div>
                <div className="mt-1 text-xs font-semibold tabular-nums text-foreground sm:text-sm">
                  <AnimatedCounter end={end} prefix={prefix} suffix={suffix} decimals={decimals} duration={1.5 + index * 0.15} />
                </div>
              </motion.div>
            ))}
          </div>

          <section className="mt-auto rounded-lg border border-border bg-background/65 px-3 py-2.5 sm:px-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[10px] font-semibold text-foreground sm:text-xs">数据流向</div>
              <div className="inline-flex items-center gap-1.5 text-[9px] text-muted-foreground">
                <motion.span
                  className="h-1.5 w-1.5 rounded-full bg-primary"
                  animate={reduceMotion ? undefined : { opacity: [0.35, 1, 0.35], scale: [0.8, 1.1, 0.8] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
                自动更新
              </div>
            </div>
            <div className="mt-2.5 grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-1.5 text-center text-[9px] sm:gap-2 sm:text-[10px]">
              <span className="rounded-md bg-secondary px-1.5 py-1.5 font-medium text-secondary-foreground">多端行为</span>
              <span className="text-primary">→</span>
              <span className="rounded-md bg-primary/10 px-1.5 py-1.5 font-medium text-primary">统一分析</span>
              <span className="text-primary">→</span>
              <span className="rounded-md bg-accent px-1.5 py-1.5 font-medium text-accent-foreground">增长洞察</span>
            </div>
          </section>
        </div>
      </motion.div>
    </div>
  );
}
