"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, DatePicker, Radio, Select, Space, Typography, Empty } from "antd";
import dynamic from "next/dynamic";
import { api } from "@/lib/api";
import dayjs, { Dayjs } from "dayjs";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });
const { RangePicker } = DatePicker;

export default function EventAnalysisPage() {
  const [projectId, setProjectId] = useState<number | undefined>();
  const [event, setEvent] = useState<string | undefined>();
  const [interval, setInterval] = useState<"hour" | "day">("day");
  const [range, setRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(7, "day").startOf("day"),
    dayjs().endOf("day"),
  ]);

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects(),
  });
  useEffect(() => {
    if (!projectId && projects?.data?.length) setProjectId(projects.data[0].id);
  }, [projects, projectId]);

  const tsRange = useMemo(
    () => ({ from: range[0].valueOf(), to: range[1].valueOf() }),
    [range],
  );

  const { data: top } = useQuery({
    queryKey: ["top_for_event", projectId, tsRange],
    queryFn: () => api.topEvents(projectId!, { ...tsRange, limit: 50 }),
    enabled: !!projectId,
  });
  useEffect(() => {
    if (!event && top?.data?.length) setEvent(top.data[0].event);
  }, [top, event]);

  const { data: trend } = useQuery({
    queryKey: ["event_trend", projectId, event, tsRange, interval],
    queryFn: () => api.trend(projectId!, event!, { ...tsRange, interval }),
    enabled: !!projectId && !!event,
  });

  const option = useMemo(() => {
    const points = trend?.data || [];
    return {
      tooltip: { trigger: "axis" },
      grid: { left: 50, right: 20, top: 30, bottom: 40 },
      xAxis: { type: "category", data: points.map((p) => p.bucket) },
      yAxis: { type: "value" },
      series: [{ type: "bar", name: event, data: points.map((p) => p.count) }],
    };
  }, [trend, event]);

  return (
    <div>
      <Typography.Title level={4}>事件分析</Typography.Title>
      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          style={{ width: 220 }}
          placeholder="项目"
          value={projectId}
          onChange={(v) => {
            setProjectId(v);
            setEvent(undefined);
          }}
          options={(projects?.data || []).map((p) => ({ value: p.id, label: p.name }))}
        />
        <Select
          style={{ width: 240 }}
          placeholder="事件"
          value={event}
          onChange={setEvent}
          options={(top?.data || []).map((e) => ({ value: e.event, label: e.event }))}
          showSearch
        />
        <RangePicker
          value={range}
          onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])}
          showTime
        />
        <Radio.Group value={interval} onChange={(e) => setInterval(e.target.value)}>
          <Radio.Button value="hour">按小时</Radio.Button>
          <Radio.Button value="day">按天</Radio.Button>
        </Radio.Group>
      </Space>

      <Card size="small" title={`事件趋势：${event || "(未选择)"}`}>
        {event ? (
          <ReactECharts option={option} style={{ height: 420 }} />
        ) : (
          <Empty description="请选择事件" />
        )}
      </Card>
    </div>
  );
}
