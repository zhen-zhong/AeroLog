"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Button,
  Card,
  DatePicker,
  Empty,
  InputNumber,
  Select,
  Space,
  Table,
  Typography,
  message,
} from "antd";
import dynamic from "next/dynamic";
import dayjs, { Dayjs } from "dayjs";
import { api } from "@/lib/api";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });
const { RangePicker } = DatePicker;

interface Step {
  event: string;
  users: number;
  conversion: number;
}

export default function FunnelPage() {
  const [projectId, setProjectId] = useState<number | undefined>();
  const [events, setEvents] = useState<string[]>([]);
  const [windowSeconds, setWindowSeconds] = useState<number>(24 * 3600);
  const [range, setRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(7, "day").startOf("day"),
    dayjs().endOf("day"),
  ]);
  const [result, setResult] = useState<Step[]>([]);

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects(),
  });
  useEffect(() => {
    if (!projectId && projects?.data?.length) setProjectId(projects.data[0].id);
  }, [projects, projectId]);

  const { data: top } = useQuery({
    queryKey: ["funnel_top", projectId],
    queryFn: () =>
      api.topEvents(projectId!, {
        from: dayjs().subtract(30, "day").valueOf(),
        to: Date.now(),
        limit: 100,
      }),
    enabled: !!projectId,
  });

  const runMut = useMutation({
    mutationFn: () =>
      api.funnel(projectId!, {
        events,
        from: range[0].valueOf(),
        to: range[1].valueOf(),
        window_seconds: windowSeconds,
      }),
    onSuccess: (res) => setResult(res.data.steps),
    onError: (e: Error) => message.error(e.message),
  });

  const option = useMemo(
    () => ({
      tooltip: { trigger: "item", formatter: "{b}: {c} 人" },
      series: [
        {
          type: "funnel",
          left: "10%",
          right: "10%",
          top: 20,
          bottom: 20,
          minSize: "10%",
          label: { show: true, position: "inside" },
          data: result.map((s) => ({
            name: `${s.event} (${(s.conversion * 100).toFixed(1)}%)`,
            value: s.users,
          })),
        },
      ],
    }),
    [result],
  );

  return (
    <div>
      <Typography.Title level={4}>漏斗分析</Typography.Title>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: "100%" }}>
          <Space wrap>
            <Select
              style={{ width: 220 }}
              placeholder="项目"
              value={projectId}
              onChange={setProjectId}
              options={(projects?.data || []).map((p) => ({ value: p.id, label: p.name }))}
            />
            <RangePicker
              value={range}
              onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])}
              showTime
            />
            <span>窗口（秒）：</span>
            <InputNumber
              min={60}
              max={30 * 24 * 3600}
              step={3600}
              value={windowSeconds}
              onChange={(v) => v && setWindowSeconds(v)}
            />
          </Space>
          <Select
            mode="multiple"
            style={{ width: "100%" }}
            placeholder="按顺序选择 2-8 个事件作为漏斗步骤"
            value={events}
            onChange={setEvents}
            options={(top?.data || []).map((e) => ({ value: e.event, label: e.event }))}
          />
          <Button
            type="primary"
            disabled={!projectId || events.length < 2}
            loading={runMut.isPending}
            onClick={() => runMut.mutate()}
          >
            计算漏斗
          </Button>
        </Space>
      </Card>

      {result.length === 0 ? (
        <Empty description="选择步骤并点击计算" />
      ) : (
        <Card size="small">
          <ReactECharts option={option} style={{ height: 360 }} />
          <Table
            size="small"
            rowKey="event"
            pagination={false}
            dataSource={result}
            columns={[
              { title: "步骤", dataIndex: "event" },
              { title: "用户数", dataIndex: "users", width: 120 },
              {
                title: "整体转化率",
                dataIndex: "conversion",
                width: 140,
                render: (v: number) => `${(v * 100).toFixed(2)}%`,
              },
            ]}
          />
        </Card>
      )}
    </div>
  );
}
