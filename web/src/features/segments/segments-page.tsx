"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, Plus, Trash2, Users } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { AnimatedContent } from "@/components/react-bits/animated-content";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, SegmentRules, UserSegment } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useProjectStore } from "@/stores/project-store";

const none = "__none__";

export function SegmentsPage() {
  const projectId = useProjectStore((state) => state.projectId);
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [profileProperty, setProfileProperty] = useState("");
  const [profileValue, setProfileValue] = useState("");
  const [event, setEvent] = useState("");
  const [eventCondition, setEventCondition] = useState<"has" | "not_has">("has");
  const [lookbackDays, setLookbackDays] = useState("30");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    setName("");
    setDescription("");
    setProfileProperty("");
    setProfileValue("");
    setEvent("");
    setEventCondition("has");
    setLookbackDays("30");
    setFormError("");
  }, [projectId]);

  const segments = useQuery({
    queryKey: ["segments", projectId],
    queryFn: () => api.listSegments(projectId!),
    enabled: !!projectId,
  });
  const properties = useQuery({
    queryKey: ["user-properties", projectId],
    queryFn: () => api.listProperties(projectId!, { scope: "user" }),
    enabled: !!projectId,
  });
  const events = useQuery({
    queryKey: ["segment-events", projectId],
    queryFn: () => api.topEvents(projectId!, { limit: 500 }),
    enabled: !!projectId,
  });

  const rules = useMemo<SegmentRules>(() => {
    const out: SegmentRules = {};
    if (profileProperty) {
      out.profile_property = profileProperty;
      out.profile_value = profileValue;
    }
    if (event) {
      out.event = event;
      out.event_condition = eventCondition;
      const days = Number(lookbackDays);
      if (Number.isFinite(days)) out.lookback_days = days;
    }
    return out;
  }, [event, eventCondition, lookbackDays, profileProperty, profileValue]);

  const preview = useMutation({
    mutationFn: () => api.previewSegment(projectId!, rules),
    onError: (error: Error) => setFormError(error.message),
  });
  const create = useMutation({
    mutationFn: () => api.createSegment(projectId!, { name: name.trim(), description: description.trim(), rules }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["segments", projectId] });
      setName("");
      setDescription("");
      setFormError("");
    },
    onError: (error: Error) => setFormError(error.message),
  });
  const remove = useMutation({
    mutationFn: (segmentId: number) => api.deleteSegment(projectId!, segmentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["segments", projectId] }),
  });

  function loadSegment(segment: UserSegment) {
    setName(segment.name);
    setDescription(segment.description);
    setProfileProperty(segment.rules.profile_property || "");
    setProfileValue(segment.rules.profile_value || "");
    setEvent(segment.rules.event || "");
    setEventCondition(segment.rules.event_condition || "has");
    setLookbackDays(String(segment.rules.lookback_days || 30));
    setFormError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const canPreview = !!projectId && (!!profileProperty || !!event);
  const canSave = canPreview && !!name.trim();

  return (
    <AnimatedContent>
      <PageHeader title="用户分群" description="保存动态规则，按用户属性与近期事件实时圈选用户。" />

      {!projectId ? (
        <EmptyState title="暂无项目" description="先选择或创建项目，再创建用户分群。" />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
          <Card>
            <CardHeader>
              <CardTitle>新建分群</CardTitle>
              <CardDescription>条件按 AND 合并。“未触发”以已有用户画像为基数。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="segment-name">分群名称</Label>
                  <Input id="segment-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={128} placeholder="例如：近 7 天未展示广告用户" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="segment-description">说明</Label>
                  <Input id="segment-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} placeholder="可选" />
                </div>
              </div>

              <div className="rounded-lg border p-4">
                <div className="mb-4 flex items-center gap-2 font-medium"><Users className="h-4 w-4" />用户属性条件</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select value={profileProperty || none} onValueChange={(value) => setProfileProperty(value === none ? "" : value)}>
                    <SelectTrigger><SelectValue placeholder="选择用户属性" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={none}>不限制用户属性</SelectItem>
                      {(properties.data?.data || []).map((property) => (
                        <SelectItem key={property.id} value={property.name}>{property.display_name || property.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input value={profileValue} onChange={(value) => setProfileValue(value.target.value)} disabled={!profileProperty} placeholder={profileProperty ? "属性值，例如 Android / true / 1" : "先选择用户属性"} />
                </div>
              </div>

              <div className="rounded-lg border p-4">
                <div className="mb-4 flex items-center gap-2 font-medium"><Plus className="h-4 w-4" />事件条件</div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Select value={event || none} onValueChange={(value) => setEvent(value === none ? "" : value)}>
                    <SelectTrigger><SelectValue placeholder="选择事件" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={none}>不限制事件</SelectItem>
                      {(events.data?.data || []).map((row) => <SelectItem key={row.event} value={row.event}>{row.event}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={eventCondition} onValueChange={(value) => setEventCondition(value as "has" | "not_has")} disabled={!event}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="has">已触发</SelectItem>
                      <SelectItem value="not_has">未触发</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input type="number" min={1} max={365} value={lookbackDays} onChange={(value) => setLookbackDays(value.target.value)} disabled={!event} placeholder="近 N 天" />
                </div>
                {event && <p className="mt-3 text-sm text-muted-foreground">近 {lookbackDays || "30"} 天 {eventCondition === "has" ? "触发" : "未触发"} <code>{event}</code>。</p>}
              </div>

              {formError && <p className="text-sm text-destructive">{formError}</p>}
              {preview.data && <div className="rounded-md bg-muted px-3 py-2 text-sm">预计圈选 <strong>{preview.data.data.users.toLocaleString()}</strong> 位用户</div>}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={!canPreview || preview.isPending} onClick={() => { setFormError(""); preview.mutate(); }}>
                  {preview.isPending && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}预览人数
                </Button>
                <Button type="button" disabled={!canSave || create.isPending} onClick={() => { setFormError(""); create.mutate(); }}>
                  {create.isPending && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}保存分群
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>已保存分群</CardTitle>
              <CardDescription>成员数随数据更新实时变化。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {segments.isLoading ? <p className="text-sm text-muted-foreground">加载中…</p> : (segments.data?.data || []).length ? (segments.data?.data || []).map((segment) => (
                <div key={segment.id} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{segment.name}</p>
                      {segment.description && <p className="mt-1 text-sm text-muted-foreground">{segment.description}</p>}
                    </div>
                    <Button type="button" size="icon" variant="ghost" aria-label={`删除 ${segment.name}`} disabled={remove.isPending} onClick={() => remove.mutate(segment.id)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {segment.rules.profile_property && <Badge variant="secondary">{segment.rules.profile_property} = {segment.rules.profile_value || '""'}</Badge>}
                    {segment.rules.event && <Badge variant="info">近 {segment.rules.lookback_days} 天{segment.rules.event_condition === "not_has" ? "未触发" : "触发"} {segment.rules.event}</Badge>}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>更新于 {formatDateTime(segment.updated_at)}</span>
                    <Button type="button" variant="link" size="sm" onClick={() => loadSegment(segment)}>载入规则</Button>
                  </div>
                </div>
              )) : <EmptyState title="尚未保存分群" description="配置左侧规则后保存。" />}
            </CardContent>
          </Card>
        </div>
      )}
    </AnimatedContent>
  );
}
