"use client";

import dayjs, { Dayjs } from "dayjs";
import type { ReactNode } from "react";
import { Check, Clock3, Filter, Layers3, Sparkles } from "lucide-react";
import { AnimatedContent } from "@/components/react-bits/animated-content";
import { CountUp } from "@/components/react-bits/count-up";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface AnalyticsEvent {
  event: string;
  count: number;
  users: number;
}

export interface AnalyticsProject {
  id: number;
  name: string;
}

export function toInputDateTime(value: Dayjs) {
  return value.format("YYYY-MM-DDTHH:mm");
}

export function fromInputDateTime(value: string, fallback: Dayjs) {
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed : fallback;
}

export function AnalyticsHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <AnimatedContent className="mb-5 overflow-hidden rounded-lg border bg-card">
      <div className="relative px-4 py-5 sm:px-6">
        <div className="pointer-events-none absolute inset-0 aero-signal-surface" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              实时行为分析
            </div>
            <h1 className="text-2xl font-semibold tracking-normal text-foreground sm:text-3xl">
              {title}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          </div>
          {action ? <div className="relative flex flex-wrap gap-2">{action}</div> : null}
        </div>
      </div>
    </AnimatedContent>
  );
}

export function ProjectPicker({
  projects,
  value,
  onChange,
  className,
}: {
  projects: AnalyticsProject[];
  value?: number;
  onChange: (value: number) => void;
  className?: string;
}) {
  return (
    <Select value={value ? String(value) : undefined} onValueChange={(next) => onChange(Number(next))}>
      <SelectTrigger className={cn("w-full sm:w-56", className)}>
        <SelectValue placeholder="选择项目" />
      </SelectTrigger>
      <SelectContent>
        {projects.map((project) => (
          <SelectItem key={project.id} value={String(project.id)}>
            {project.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function EventPicker({
  events,
  value,
  onChange,
  placeholder = "选择事件",
  className,
}: {
  events: AnalyticsEvent[];
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn("w-full sm:w-64", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {events.map((item) => (
          <SelectItem key={item.event} value={item.event}>
            {item.event}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function DateTimeRange({
  value,
  onChange,
  compact = false,
  stacked = false,
}: {
  value: [Dayjs, Dayjs];
  onChange: (value: [Dayjs, Dayjs]) => void;
  compact?: boolean;
  stacked?: boolean;
}) {
  return (
    <div className={cn("grid gap-3", !stacked && "sm:grid-cols-2", compact && "gap-2")}>
      <div className="grid gap-1.5">
        <Label htmlFor="from-time">开始时间</Label>
        <Input
          className="min-w-0"
          id="from-time"
          type="datetime-local"
          value={toInputDateTime(value[0])}
          onChange={(event) => onChange([fromInputDateTime(event.target.value, value[0]), value[1]])}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="to-time">结束时间</Label>
        <Input
          className="min-w-0"
          id="to-time"
          type="datetime-local"
          value={toInputDateTime(value[1])}
          onChange={(event) => onChange([value[0], fromInputDateTime(event.target.value, value[1])])}
        />
      </div>
    </div>
  );
}

export function ReportControls({
  range,
  onRangeChange,
  comparison = "无对比",
  filters = [],
  className,
}: {
  range: [Dayjs, Dayjs];
  onRangeChange: (value: [Dayjs, Dayjs]) => void;
  comparison?: string;
  filters?: string[];
  className?: string;
}) {
  return (
    <ToolbarPanel className={className}>
      <div className="grid gap-4 xl:grid-cols-[minmax(360px,1fr)_220px] xl:items-end">
        <DateTimeRange value={range} onChange={onRangeChange} compact />
        <div className="grid gap-1.5">
          <Label>对比</Label>
          <div className="flex h-9 items-center rounded-md border bg-background px-3 text-sm text-muted-foreground">
            {comparison}
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <span className="inline-flex h-8 items-center gap-2 rounded-md border bg-background px-3 text-xs font-medium text-muted-foreground">
          <Filter className="h-3.5 w-3.5" />
          筛选器
        </span>
        {filters.length ? (
          filters.map((filter) => (
            <Badge key={filter} variant="info" className="h-8 items-center">
              {filter}
            </Badge>
          ))
        ) : (
          <span className="inline-flex h-8 items-center rounded-md border border-dashed px-3 text-xs text-muted-foreground">
            全部用户
          </span>
        )}
      </div>
    </ToolbarPanel>
  );
}

export function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <Input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
        }}
      />
    </div>
  );
}

export function MetricTile({
  label,
  value,
  hint,
  loading,
}: {
  label: string;
  value: number;
  hint?: string;
  loading?: boolean;
}) {
  return (
    <Card className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px aero-scan-line" />
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <div className="text-2xl font-semibold tabular-nums">
            <CountUp value={value} />
          </div>
        )}
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export function ToolbarPanel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <AnimatedContent delay={50}>
      <Card className={cn("mb-5", className)}>
        <CardContent className="pt-4 sm:pt-5">{children}</CardContent>
      </Card>
    </AnimatedContent>
  );
}

export function ChartPanel({
  title,
  description,
  children,
  className,
  contentClassName,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <AnimatedContent delay={90}>
      <Card className={cn("overflow-hidden", className)}>
        <CardHeader className="border-b bg-secondary/35">
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        <CardContent className={cn("pt-5", contentClassName)}>{children}</CardContent>
      </Card>
    </AnimatedContent>
  );
}

export function EventRankList({
  events,
  active,
  onSelect,
  loading,
}: {
  events: AnalyticsEvent[];
  active?: string;
  onSelect: (event: string) => void;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="grid gap-2">
        {Array.from({ length: 7 }).map((_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {events.map((item, index) => {
        const selected = active === item.event;
        return (
          <button
            key={item.event}
            type="button"
            onClick={() => onSelect(item.event)}
            className={cn(
              "group flex w-full items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-left text-sm transition-[background,border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-accent/60 motion-reduce:transform-none",
              selected && "border-primary/50 bg-accent text-accent-foreground",
            )}
          >
            <span className="flex min-w-0 items-center gap-3">
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-xs font-semibold text-muted-foreground",
                  selected && "border-primary/30 bg-primary text-primary-foreground",
                )}
              >
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium">{item.event}</span>
                <span className="text-xs text-muted-foreground">{item.users.toLocaleString()} 用户</span>
              </span>
            </span>
            <span className="font-mono text-sm tabular-nums">{item.count.toLocaleString()}</span>
          </button>
        );
      })}
    </div>
  );
}

export function EventStepSelector({
  options,
  value,
  onChange,
}: {
  options: AnalyticsEvent[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const toggle = (event: string) => {
    if (value.includes(event)) {
      onChange(value.filter((item) => item !== event));
      return;
    }
    if (value.length < 8) onChange([...value, event]);
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {options.map((item) => {
          const active = value.includes(item.event);
          return (
            <button
              key={item.event}
              type="button"
              onClick={() => toggle(item.event)}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium transition-colors hover:border-primary/40 hover:bg-accent",
                active && "border-primary/50 bg-primary text-primary-foreground hover:bg-primary/90",
              )}
            >
              {active ? <Check className="h-3.5 w-3.5" /> : <Layers3 className="h-3.5 w-3.5" />}
              {item.event}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Clock3 className="h-3.5 w-3.5" />
        当前顺序：
        {value.length ? (
          value.map((item, index) => (
            <Badge key={`${item}:${index}`} variant="info">
              {index + 1}. {item}
            </Badge>
          ))
        ) : (
          <span>请选择 2-8 个事件</span>
        )}
      </div>
    </div>
  );
}

export function EmptyAnalysis({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center rounded-lg border border-dashed bg-secondary/30 px-4 py-10 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-md border bg-background text-primary">
        <Sparkles className="h-5 w-5" />
      </div>
      <div className="text-sm font-medium">{title}</div>
      {description ? <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">{description}</p> : null}
    </div>
  );
}
