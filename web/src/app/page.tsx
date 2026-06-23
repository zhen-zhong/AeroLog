"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Zap,
  Shield,
  Globe,
  BarChart3,
  Code,
  Layers,
  TrendingUp,
  Check,
  Star,
  LogIn,
  UserPlus,
  PanelLeft,
  Menu,
  X,
  Sparkles,
} from "lucide-react";
import { DataFlowAnimation } from "@/components/landing/DataFlowAnimation";
import { AnimatedCounter } from "@/components/landing/AnimatedCounter";
import { FloatingParticles } from "@/components/landing/FloatingParticles";

export default function LandingPage() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div className="relative min-h-dvh overflow-hidden bg-background text-foreground">
      {/* 渐变背景层 */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-accent/30" />
        <div className="absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-[500px] w-[500px] rounded-full bg-accent/40 blur-3xl" />
        <div className="absolute top-1/3 left-1/2 h-[400px] w-[400px] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
      </div>

      {/* 网格扫描层 */}
      <div className="pointer-events-none fixed inset-0 -z-10 aero-signal-surface opacity-40" />

      {/* 浮动粒子 */}
      <FloatingParticles />

      {/* 顶部导航 */}
      <nav
        className={`fixed left-0 right-0 top-0 z-50 transition-all duration-300 ${
          isScrolled
            ? "border-b border-border/60 bg-background/85 backdrop-blur-md shadow-sm"
            : "bg-transparent"
        }`}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-2"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <PanelLeft className="h-4 w-4" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold">AeroLog</div>
              <div className="text-xs text-muted-foreground">埋点分析平台</div>
            </div>
          </motion.div>

          {/* 桌面端菜单 */}
          <div className="hidden items-center gap-8 md:flex">
            {[
              { id: "features", label: "功能特性" },
              { id: "architecture", label: "技术架构" },
              { id: "testimonials", label: "客户案例" },
            ].map((item, i) => (
              <motion.a
                key={item.id}
                href={`#${item.id}`}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {item.label}
              </motion.a>
            ))}
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.32 }}
            >
              <Link
                href="/docs"
                className="inline-flex h-9 items-center text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                接入指南
              </Link>
            </motion.div>
          </div>

          {/* 右侧操作按钮 */}
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="hidden h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground sm:inline-flex"
            >
              <LogIn className="h-4 w-4" />
              登录
            </Link>
            <Link
              href="/login?mode=register"
              className="hidden h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground sm:inline-flex"
            >
              <UserPlus className="h-4 w-4" />
              注册
            </Link>
            <Link href="/console">
              <motion.button
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:shadow-lg hover:shadow-primary/30"
              >
                前往控制台
                <ArrowRight className="h-4 w-4" />
              </motion.button>
            </Link>

            {/* 移动菜单 */}
            <button
              className="ml-1 inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card md:hidden"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="菜单"
            >
              {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* 移动端下拉菜单 */}
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="border-t border-border/60 bg-background/95 backdrop-blur md:hidden"
          >
            <div className="flex flex-col gap-1 p-4">
              {[
                { id: "features", label: "功能特性" },
                { id: "architecture", label: "技术架构" },
                { id: "testimonials", label: "客户案例" },
              ].map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  onClick={() => setMobileMenuOpen(false)}
                  className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  {item.label}
                </a>
              ))}
              <div className="mt-1 border-t border-border/60 pt-2">
                <Link
                  href="/docs"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  接入指南
                </Link>
              </div>
              <div className="my-2 border-t border-border/60" />
              <Link
                href="/login"
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              >
                <LogIn className="h-4 w-4" /> 登录
              </Link>
              <Link
                href="/login?mode=register"
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              >
                <UserPlus className="h-4 w-4" /> 注册
              </Link>
            </div>
          </motion.div>
        )}
      </nav>

      {/* Hero */}
      <section className="relative px-6 pb-20 pt-32 sm:pt-40">
        <div className="mx-auto max-w-7xl">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2 }}
                className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>新一代多端埋点分析平台</span>
              </motion.div>

              <h1 className="text-4xl font-bold leading-tight md:text-6xl">
                让每一个{" "}
                <span className="bg-gradient-to-r from-primary via-primary to-accent-foreground bg-clip-text text-transparent">
                  数据点
                </span>
                <br />
                都产生价值
              </h1>

              <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
                AeroLog 是高性能多端埋点分析平台，参考神策架构设计，支持
                Android、iOS、Web 三端统一采集。毫秒级响应、十亿级事件处理，助你用数据驱动决策。
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/login?mode=register">
                  <motion.button
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-primary px-7 text-base font-semibold text-primary-foreground shadow-md transition-all hover:shadow-xl hover:shadow-primary/40 sm:w-auto"
                  >
                    <UserPlus className="h-5 w-5" />
                    免费注册
                  </motion.button>
                </Link>
                <Link href="/console">
                  <motion.button
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md border border-border bg-card px-7 text-base font-semibold text-foreground transition-all hover:bg-accent hover:text-accent-foreground sm:w-auto"
                  >
                    前往控制台
                    <ArrowRight className="h-5 w-5" />
                  </motion.button>
                </Link>
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-primary" />
                  <span>免费额度充足</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-primary" />
                  <span>无需信用卡</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-primary" />
                  <span>5 分钟接入</span>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3, duration: 0.6 }}
              className="relative"
            >
              <DataFlowAnimation />
            </motion.div>
          </div>
        </div>
      </section>

      {/* 数据统计 */}
      <section className="relative border-y border-border/60 bg-card/40 px-6 py-14 backdrop-blur">
        <div className="mx-auto max-w-7xl">
          <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
            {[
              { value: 99.9, suffix: "%", label: "服务可用性", prefix: "" },
              { value: 50, suffix: "ms", label: "平均响应时间", prefix: "<" },
              { value: 10, suffix: "亿+", label: "日处理事件", prefix: "" },
              { value: 1000, suffix: "+", label: "企业用户", prefix: "" },
            ].map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="text-center"
              >
                <div className="bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-4xl font-bold text-transparent md:text-5xl">
                  <AnimatedCounter
                    end={stat.value}
                    suffix={stat.suffix}
                    prefix={stat.prefix}
                  />
                </div>
                <div className="mt-2 text-sm text-muted-foreground">{stat.label}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* 功能特性 */}
      <section id="features" className="relative px-6 py-24">
        <div className="mx-auto max-w-7xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-16 text-center"
          >
            <h2 className="text-3xl font-bold md:text-4xl">
              为什么选择{" "}
              <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                AeroLog
              </span>
            </h2>
            <p className="mt-3 text-lg text-muted-foreground">
              专为现代应用打造的全栈数据分析解决方案
            </p>
          </motion.div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: Globe,
                title: "多端覆盖",
                desc: "Android、iOS、Web 三端 SDK，统一协议，一次接入，全端采集",
              },
              {
                icon: Zap,
                title: "高性能架构",
                desc: "Go + Kafka + ClickHouse 技术栈，轻松应对十亿级事件处理",
              },
              {
                icon: Shield,
                title: "数据不丢失",
                desc: "离线缓存 + WAL 机制 + 至少一次消费，确保数据完整可靠",
              },
              {
                icon: BarChart3,
                title: "实时分析",
                desc: "毫秒级查询响应，可视化报表，助力即时决策",
              },
              {
                icon: Code,
                title: "开发者友好",
                desc: "简洁 API，完善文档，5 分钟快速接入，开箱即用",
              },
              {
                icon: Layers,
                title: "弹性扩展",
                desc: "从单机到分布式集群，无缝扩展，伴随业务成长",
              },
            ].map((feature, i) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
                whileHover={{ y: -4 }}
                className="group relative overflow-hidden rounded-xl border border-border bg-card/80 p-6 backdrop-blur transition-all hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10"
              >
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <feature.icon className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-semibold">{feature.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {feature.desc}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* 技术架构 */}
      <section id="architecture" className="relative bg-card/40 px-6 py-24 backdrop-blur">
        <div className="mx-auto max-w-7xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-16 text-center"
          >
            <h2 className="text-3xl font-bold md:text-4xl">强大的技术架构</h2>
            <p className="mt-3 text-lg text-muted-foreground">
              参考神策分层架构，为高并发场景优化
            </p>
          </motion.div>

          <div className="grid items-center gap-12 lg:grid-cols-2">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="space-y-4"
            >
              {[
                {
                  step: "01",
                  title: "SDK 采集层",
                  desc: "多端 SDK 统一协议，离线缓存，批量上报，智能重试",
                },
                {
                  step: "02",
                  title: "Collector 接收层",
                  desc: "Go + Gin 高并发接收，鉴权限流，Schema 校验，WAL 兜底",
                },
                {
                  step: "03",
                  title: "Kafka 消息队列",
                  desc: "事件缓冲，削峰填谷，保证数据不丢，支持水平扩展",
                },
                {
                  step: "04",
                  title: "Consumer ETL",
                  desc: "UA 解析，IP 定位，数据清洗，至少一次消费保障",
                },
                {
                  step: "05",
                  title: "存储与查询",
                  desc: "ClickHouse 列式存储，毫秒查询；Postgres 元数据管理",
                },
              ].map((item, i) => (
                <motion.div
                  key={item.step}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.08 }}
                  className="aero-flow flex gap-4 rounded-lg border border-border bg-card p-4 transition-all hover:border-primary/50 hover:shadow-md"
                >
                  <div className="text-2xl font-bold text-primary/40">{item.step}</div>
                  <div>
                    <h3 className="font-semibold">{item.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{item.desc}</p>
                  </div>
                </motion.div>
              ))}
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="relative self-stretch"
            >
              <div className="h-full rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-accent/30 p-6 backdrop-blur sm:p-8">
                <div className="flex h-full flex-col">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-2xl font-bold">高可用架构</div>
                      <div className="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">
                        从单机启动，到集群扩展，业务增长无需重建数据底座。
                      </div>
                    </div>
                    <motion.div
                      animate={{ opacity: [0.55, 1, 0.55] }}
                      transition={{ duration: 1.8, repeat: Infinity }}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
                    >
                      <TrendingUp className="h-4 w-4" />
                    </motion.div>
                  </div>

                  <div className="mt-6 rounded-xl border border-primary/25 bg-background/70 p-4">
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <div className="text-3xl font-bold tabular-nums text-primary">99.99%</div>
                        <div className="mt-1 text-xs text-muted-foreground">服务可用性目标</div>
                      </div>
                      <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">运行正常</span>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3">
                    {[
                      [Shield, "多副本容错", "关键服务故障自动隔离，保障数据持续可用。"],
                      [Layers, "弹性扩展", "流量增长时可按需增加处理能力，平稳承接高峰。"],
                    ].map(([Icon, title, description]) => (
                      <div key={title as string} className="flex gap-3">
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-secondary text-primary">
                          <Icon className="h-4 w-4" />
                        </span>
                        <div>
                          <div className="text-sm font-semibold">{title as string}</div>
                          <div className="mt-0.5 text-xs leading-5 text-muted-foreground">{description as string}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-5 border-t border-border/70 pt-4 text-xs font-medium text-muted-foreground">
                    单机部署 · 集群扩展 · 多区域容灾
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* 客户评价 */}
      <section id="testimonials" className="relative px-6 py-24">
        <div className="mx-auto max-w-7xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-16 text-center"
          >
            <h2 className="text-3xl font-bold md:text-4xl">客户好评</h2>
            <p className="mt-3 text-lg text-muted-foreground">受到众多企业的信赖与好评</p>
          </motion.div>

          <div className="grid gap-6 md:grid-cols-3">
            {[
              {
                name: "某电商平台",
                role: "技术总监",
                content:
                  "接入 AeroLog 后，数据分析效率提升 10 倍，实时看板帮助我们快速响应市场变化。",
                rating: 5,
              },
              {
                name: "某游戏公司",
                role: "数据分析师",
                content:
                  "性能非常出色，高峰期也能保持稳定。多端 SDK 让我们的用户行为分析更加全面。",
                rating: 5,
              },
              {
                name: "某 SaaS 企业",
                role: "产品经理",
                content:
                  "开发者体验极佳，文档完善，接入简单。技术支持团队响应迅速，强烈推荐！",
                rating: 5,
              },
            ].map((testimonial, i) => (
              <motion.div
                key={testimonial.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                whileHover={{ y: -4 }}
                className="rounded-xl border border-border bg-card/80 p-6 backdrop-blur transition-all hover:border-primary/40 hover:shadow-lg"
              >
                <div className="mb-4 flex gap-1">
                  {Array.from({ length: testimonial.rating }).map((_, idx) => (
                    <Star key={idx} className="h-4 w-4 fill-primary text-primary" />
                  ))}
                </div>
                <p className="text-sm leading-relaxed text-foreground/90">
                  “{testimonial.content}”
                </p>
                <div className="mt-6 border-t border-border/60 pt-4">
                  <div className="text-sm font-semibold">{testimonial.name}</div>
                  <div className="text-xs text-muted-foreground">{testimonial.role}</div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* 接入指南 */}
      <section id="integration" className="relative bg-card/40 px-6 py-24 backdrop-blur">
        <div className="mx-auto max-w-7xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-12 max-w-2xl"
          >
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
              <Code className="h-3.5 w-3.5" />
              接入指南
            </div>
            <h2 className="text-3xl font-bold md:text-4xl">从第一条事件开始</h2>
            <p className="mt-3 text-lg text-muted-foreground">
              三端统一协议，按对应平台完成安装、初始化与事件上报即可开始分析。
            </p>
          </motion.div>

          <div className="grid gap-5 md:grid-cols-3">
            {[
              {
                id: "android",
                platform: "Android",
                title: "Kotlin / Java SDK",
                description: "支持自动采集、Room 离线缓存与批量重试。",
                steps: ["引入 SDK module", "Application 中初始化", "track 上报事件"],
                href: "/docs/android",
                Icon: Code,
              },
              {
                id: "web",
                platform: "Web",
                title: "TypeScript SDK",
                description: "npm 安装即可使用，内置 IndexedDB 离线兜底。",
                steps: ["安装 @aerolog/web", "配置 token", "track / identify"],
                href: "/docs/web",
                Icon: Globe,
              },
              {
                id: "ios",
                platform: "iOS",
                title: "Swift Package SDK",
                description: "通过 SPM 引入，支持后台 flush 与本地持久化。",
                steps: ["添加 Swift Package", "配置 AeroLog", "track 上报事件"],
                href: "/docs/ios",
                Icon: Layers,
              },
            ].map(({ id, platform, title, description, steps, href, Icon }, index) => (
              <motion.article
                id={`guide-${id}`}
                key={id}
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.08 }}
                className="rounded-xl border border-border bg-card/85 p-6"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
                    {platform}
                  </span>
                </div>
                <h3 className="mt-5 text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
                <ol className="mt-5 space-y-2 text-sm text-foreground/85">
                  {steps.map((step, stepIndex) => (
                    <li key={step} className="flex items-center gap-2">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-secondary-foreground">
                        {stepIndex + 1}
                      </span>
                      {step}
                    </li>
                  ))}
                </ol>
                <Link
                  href={href}
                  className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-primary transition-colors hover:text-primary/75"
                >
                  查看接入文档 <ArrowRight className="h-4 w-4" />
                </Link>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative px-6 py-24">
        <div className="mx-auto max-w-4xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card/60 to-accent/40 px-8 py-16 backdrop-blur"
          >
            <h2 className="text-3xl font-bold md:text-5xl">准备好开始了吗？</h2>
            <p className="mt-4 text-lg text-muted-foreground">
              加入数千家企业，用数据驱动增长
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/login?mode=register">
                <motion.button
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.96 }}
                  className="inline-flex h-12 items-center gap-2 rounded-md bg-primary px-8 text-base font-semibold text-primary-foreground shadow-md transition-all hover:shadow-xl hover:shadow-primary/40"
                >
                  <UserPlus className="h-5 w-5" />
                  免费注册
                </motion.button>
              </Link>
              <Link href="/login">
                <motion.button
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.96 }}
                  className="inline-flex h-12 items-center gap-2 rounded-md border border-border bg-card px-8 text-base font-semibold text-foreground transition-all hover:bg-accent hover:text-accent-foreground"
                >
                  <LogIn className="h-5 w-5" />
                  立即登录
                </motion.button>
              </Link>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">无需信用卡 · 永久免费额度</p>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative border-t border-border/60 bg-card/60 px-6 py-12 backdrop-blur">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-8 md:grid-cols-4">
            <div>
              <div className="mb-4 flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  <PanelLeft className="h-4 w-4" />
                </div>
                <span className="text-lg font-bold">AeroLog</span>
              </div>
              <p className="text-sm text-muted-foreground">
                新一代高性能多端埋点分析平台
              </p>
            </div>
            <div>
              <h4 className="mb-3 text-sm font-semibold">产品</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#features" className="hover:text-foreground">功能特性</a></li>
                <li><a href="#architecture" className="hover:text-foreground">技术架构</a></li>
              </ul>
            </div>
            <div>
              <h4 className="mb-3 text-sm font-semibold">开发者</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="/docs" className="hover:text-foreground">文档</Link></li>
                <li><Link href="/api-reference" className="hover:text-foreground">API 参考</Link></li>
                <li><Link href="/docs" className="hover:text-foreground">接入指南</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="mb-3 text-sm font-semibold">公司</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="/about" className="hover:text-foreground">关于我们</Link></li>
                <li><a href="mailto:hello@aerolog.local" className="hover:text-foreground">联系我们</a></li>
                <li><Link href="/privacy" className="hover:text-foreground">隐私政策</Link></li>
              </ul>
            </div>
          </div>
          <div className="mt-10 border-t border-border/60 pt-6 text-center text-xs text-muted-foreground">
            © 2026 AeroLog. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
