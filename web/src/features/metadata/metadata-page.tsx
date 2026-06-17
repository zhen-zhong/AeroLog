"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, EventDefinition, PropertyDefinition } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/layout/page-header";
import { useProjectStore } from "@/stores/project-store";
import { EmptyState } from "@/components/data/empty-state";
import { AnimatedContent } from "@/components/react-bits/animated-content";
import { CountUp } from "@/components/react-bits/count-up";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type MetadataView = "events" | "eventProps" | "userProps";

export function MetadataPage() {
  const projectId = useProjectStore((s) => s.projectId);
  const [view, setView] = useState<MetadataView>("events");

  const events = useQuery({
    queryKey: ["events", projectId],
    queryFn: () => api.listEvents(projectId!),
    enabled: !!projectId,
  });

  const eventProps = useQuery({
    queryKey: ["properties", projectId, "event"],
    queryFn: () => api.listProperties(projectId!, { scope: "event" }),
    enabled: !!projectId,
  });

  const userProps = useQuery({
    queryKey: ["properties", projectId, "user"],
    queryFn: () => api.listProperties(projectId!, { scope: "user" }),
    enabled: !!projectId,
  });

  const currentData = useMemo(() => {
    if (view === "events") return events.data?.data || [];
    if (view === "eventProps") return eventProps.data?.data || [];
    return userProps.data?.data || [];
  }, [eventProps.data?.data, events.data?.data, userProps.data?.data, view]);

  const loading =
    view === "events" ? events.isLoading :
    view === "eventProps" ? eventProps.isLoading :
    userProps.isLoading;

  return (
    <AnimatedContent>
      <PageHeader
        title="数据治理"
        description="自动发现事件、事件属性和用户属性，沉淀可确认、可解释、可治理的数据字典。"
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <MetricCard label="事件字典" value={events.data?.data.length || 0} loading={events.isLoading} />
        <MetricCard label="事件属性" value={eventProps.data?.data.length || 0} loading={eventProps.isLoading} />
        <MetricCard label="用户属性" value={userProps.data?.data.length || 0} loading={userProps.isLoading} />
      </div>

      {!projectId ? (
        <EmptyState title="暂无项目" description="请先在项目管理页面创建项目，随后 SDK 上报会自动补全元数据。" />
      ) : (
        <Tabs value={view} onValueChange={(v) => setView(v as MetadataView)}>
          <div className="overflow-x-auto pb-1">
            <TabsList>
              <TabsTrigger value="events">事件字典</TabsTrigger>
              <TabsTrigger value="eventProps">事件属性</TabsTrigger>
              <TabsTrigger value="userProps">用户属性</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="events">
            <DictionaryTable
              loading={loading}
              rows={currentData as EventDefinition[]}
              mode="events"
            />
          </TabsContent>
          <TabsContent value="eventProps">
            <DictionaryTable
              loading={loading}
              rows={currentData as PropertyDefinition[]}
              mode="properties"
            />
          </TabsContent>
          <TabsContent value="userProps">
            <DictionaryTable
              loading={loading}
              rows={currentData as PropertyDefinition[]}
              mode="properties"
            />
          </TabsContent>
        </Tabs>
      )}
    </AnimatedContent>
  );
}

function MetricCard({ label, value, loading }: { label: string; value: number; loading: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-7 w-16" /> : <div className="text-2xl font-semibold"><CountUp value={value} /></div>}
      </CardContent>
    </Card>
  );
}

function DictionaryTable({
  rows,
  loading,
  mode,
}: {
  rows: EventDefinition[] | PropertyDefinition[];
  loading: boolean;
  mode: "events" | "properties";
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{mode === "events" ? "事件名" : "属性名"}</TableHead>
              {mode === "properties" && <TableHead className="w-28">类型</TableHead>}
              {mode === "properties" && <TableHead className="w-24">范围</TableHead>}
              <TableHead className="hidden md:table-cell">显示名</TableHead>
              <TableHead className="w-28">状态</TableHead>
              <TableHead className="hidden lg:table-cell">首次出现</TableHead>
              <TableHead className="hidden lg:table-cell">最近出现</TableHead>
              <TableHead className="hidden xl:table-cell">描述</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 6 }).map((_, index) => (
                <TableRow key={index}>
                  <TableCell colSpan={mode === "events" ? 6 : 8}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : rows.length ? (
              rows.map((row) => (
                <TableRow key={`${mode}:${row.id}`}>
                  <TableCell className="min-w-48 font-medium">
                    <code className="rounded bg-muted px-2 py-1 text-xs">{row.name}</code>
                  </TableCell>
                  {mode === "properties" && (
                    <TableCell>{typeBadge((row as PropertyDefinition).data_type)}</TableCell>
                  )}
                  {mode === "properties" && (
                    <TableCell>{scopeBadge((row as PropertyDefinition).scope)}</TableCell>
                  )}
                  <TableCell className="hidden md:table-cell">{row.display_name || "-"}</TableCell>
                  <TableCell>{row.status === 1 ? <Badge variant="success">启用</Badge> : <Badge variant="secondary">禁用</Badge>}</TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">{formatDateTime(row.first_seen)}</TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">{formatDateTime(row.last_seen)}</TableCell>
                  <TableCell className="hidden max-w-xs truncate text-muted-foreground xl:table-cell">{row.description || "-"}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={mode === "events" ? 6 : 8}>
                  <div className="py-12 text-center text-sm text-muted-foreground">暂无数据</div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function typeBadge(type: string) {
  const variant = type === "mixed" ? "danger" : type === "unknown" ? "secondary" : "info";
  return <Badge variant={variant}>{type}</Badge>;
}

function scopeBadge(scope: "event" | "user") {
  return scope === "user" ? <Badge variant="default">用户</Badge> : <Badge variant="outline">事件</Badge>;
}
