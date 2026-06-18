"use client";

import { useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Link as LinkIcon } from "lucide-react";
import { AnalyticsHeader, EmptyAnalysis } from "@/features/analytics/analytics-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api, QueryTemplate } from "@/lib/api";
import { useProjectStore } from "@/stores/project-store";

const DRAFT_STORAGE_KEY = "aerolog:query-builder:draft";

export default function SharedQueryTemplatePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const setProjectId = useProjectStore((s) => s.setProjectId);
  const token = decodeURIComponent(params.token || "");

  const template = useQuery({
    queryKey: ["shared_query_template", token],
    queryFn: () => api.getSharedQueryTemplate(token),
    enabled: !!token,
  });

  const tpl = template.data?.data;
  const summary = useMemo(() => summarizeTemplate(tpl), [tpl]);

  function openTemplate() {
    if (!tpl) return;
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(tpl.config || {}));
    setProjectId(tpl.project_id);
    router.push("/console/query");
  }

  return (
    <div>
      <AnalyticsHeader
        title="共享查询模板"
        description="打开他人分享的自助查询配置，并载入到当前查询构造器。"
        action={<Badge variant="info" className="h-9 items-center gap-2"><LinkIcon className="h-3.5 w-3.5" />Shared</Badge>}
      />

      <Card>
        <CardContent className="grid gap-4 pt-4 sm:pt-4">
          {template.isPending ? (
            <EmptyAnalysis title="正在读取模板" description="正在校验分享链接并加载查询配置。" />
          ) : template.error || !tpl ? (
            <EmptyAnalysis title="分享链接不可用" description="这个模板可能已取消分享、被删除，或链接不完整。" />
          ) : (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="truncate text-lg font-semibold">{tpl.name}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{tpl.description || "没有备注"}</div>
                </div>
                <Button type="button" onClick={openTemplate}>
                  载入查询
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <SummaryItem label="事件" value={summary.events} />
                <SummaryItem label="维度" value={summary.dimensions} />
                <SummaryItem label="过滤条件" value={summary.filters} />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-medium" title={value}>{value}</div>
    </div>
  );
}

function summarizeTemplate(tpl?: QueryTemplate) {
  const cfg = (tpl?.config || {}) as Record<string, unknown>;
  const events = Array.isArray(cfg.events) && cfg.events.length ? `${cfg.events.length} 个事件` : "全部事件";
  const dimensions = Array.isArray(cfg.dimensions) && cfg.dimensions.length
    ? `${cfg.dimensions.length} 个维度`
    : "默认事件维度";
  const filters = Array.isArray(cfg.filters) && cfg.filters.length ? `${cfg.filters.length} 个条件` : "无过滤条件";
  return { events, dimensions, filters };
}
