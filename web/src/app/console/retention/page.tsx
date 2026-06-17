"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, DatePicker, InputNumber, Select, Space, Table, Typography } from "antd";
import dayjs, { Dayjs } from "dayjs";
import { api } from "@/lib/api";

const { RangePicker } = DatePicker;

interface RetRow {
  cohort: string;
  size: number;
  values: number[];
}

export default function RetentionPage() {
  const [projectId, setProjectId] = useState<number | undefined>();
  const [initEvent, setInitEvent] = useState<string | undefined>();
  const [retEvent, setRetEvent] = useState<string | undefined>();
  const [days, setDays] = useState<number>(7);
  const [range, setRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(14, "day").startOf("day"),
    dayjs().endOf("day"),
  ]);

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects(),
  });
  useEffect(() => {
    if (!projectId && projects?.data?.length) setProjectId(projects.data[0].id);
  }, [projects, projectId]);

  const { data: top } = useQuery({
    queryKey: ["retention_top", projectId],
    queryFn: () =>
      api.topEvents(projectId!, {
        from: dayjs().subtract(30, "day").valueOf(),
        to: Date.now(),
        limit: 100,
      }),
    enabled: !!projectId,
  });

  const { data, isFetching } = useQuery({
    queryKey: ["retention", projectId, initEvent, retEvent, days, range],
    queryFn: () =>
      api.retention(projectId!, {
        initial_event: initEvent!,
        return_event: retEvent!,
        days,
        from: range[0].valueOf(),
        to: range[1].valueOf(),
      }),
    enabled: !!projectId && !!initEvent && !!retEvent,
  });

  const columns = useMemo(() => {
    const base: any[] = [
      { title: "同期日", dataIndex: "cohort", width: 140, fixed: "left" },
      { title: "用户数", dataIndex: "size", width: 100, fixed: "left" },
    ];
    for (let i = 0; i < days; i++) {
      base.push({
        title: i === 0 ? "Day0" : `Day${i}`,
        dataIndex: ["values", i],
        width: 90,
        render: (v: number, row: RetRow) => {
          if (!row.size) return "-";
          const rate = ((v || 0) / row.size) * 100;
          return `${rate.toFixed(1)}%`;
        },
      });
    }
    return base;
  }, [days]);

  return (
    <div>
      <Typography.Title level={4}>留存分析</Typography.Title>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Select
            style={{ width: 200 }}
            placeholder="项目"
            value={projectId}
            onChange={setProjectId}
            options={(projects?.data || []).map((p) => ({ value: p.id, label: p.name }))}
          />
          <Select
            style={{ width: 220 }}
            placeholder="初始事件"
            value={initEvent}
            onChange={setInitEvent}
            options={(top?.data || []).map((e) => ({ value: e.event, label: e.event }))}
            showSearch
          />
          <Select
            style={{ width: 220 }}
            placeholder="返回事件"
            value={retEvent}
            onChange={setRetEvent}
            options={(top?.data || []).map((e) => ({ value: e.event, label: e.event }))}
            showSearch
          />
          <span>天数：</span>
          <InputNumber min={2} max={30} value={days} onChange={(v) => v && setDays(v)} />
          <RangePicker
            value={range}
            onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])}
          />
        </Space>
      </Card>

      <Table<RetRow>
        loading={isFetching}
        rowKey="cohort"
        columns={columns}
        dataSource={data?.data || []}
        pagination={{ pageSize: 14 }}
        scroll={{ x: 1000 }}
        size="small"
      />
    </div>
  );
}
