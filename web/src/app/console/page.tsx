"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, Col, Row, Select, Space, Table, Typography, Empty } from "antd";
import dynamic from "next/dynamic";
import { api } from "@/lib/api";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

const RANGE_HOURS = 24 * 7; // 默认 7 天

export default function ConsolePage() {
  const [projectId, setProjectId] = useState<number | undefined>();
  const [event, setEvent] = useState<string | undefined>();

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects(),
  });

  useEffect(() => {
    if (!projectId && projects?.data?.length) {
      setProjectId(projects.data[0].id);
    }
  }, [projects, projectId]);

  const range = useMemo(() => {
    const to = Date.now();
    const from = to - RANGE_HOURS * 3600 * 1000;
    return { from, to };
  }, []);

  const { data: top } = useQuery({
    queryKey: ["top_events", projectId, range],
    queryFn: () => api.topEvents(projectId!, { ...range, limit: 10 }),
    enabled: !!projectId,
  });

  useEffect(() => {
    if (!event && top?.data?.length) {
      setEvent(top.data[0].event);
    }
  }, [top, event]);

  const { data: trend } = useQuery({
    queryKey: ["trend", projectId, event, range],
    queryFn: () => api.trend(projectId!, event!, { ...range, interval: "day" }),
    enabled: !!projectId && !!event,
  });

  const chartOption = useMemo(() => {
    const points = trend?.data || [];
    return {
      tooltip: { trigger: "axis" },
      grid: { left: 40, right: 20, top: 30, bottom: 40 },
      xAxis: { type: "category", data: points.map((p) => p.bucket) },
      yAxis: { type: "value" },
      series: [
        {
          type: "line",
          smooth: true,
          name: event,
          data: points.map((p) => p.count),
          areaStyle: {},
        },
      ],
    };
  }, [trend, event]);

  return (
    <div>
      <Space style={{ marginBottom: 16 }} size="large">
        <Typography.Title level={4} style={{ margin: 0 }}>
          数据看板
        </Typography.Title>
        <Select
          style={{ width: 240 }}
          placeholder="选择项目"
          value={projectId}
          onChange={(v) => {
            setProjectId(v);
            setEvent(undefined);
          }}
          options={(projects?.data || []).map((p) => ({ value: p.id, label: p.name }))}
        />
      </Space>

      {!projectId ? (
        <Empty description="暂无项目，请先在项目管理页面创建" />
      ) : (
        <Row gutter={16}>
          <Col span={10}>
            <Card title="Top 事件（近 7 天）" size="small">
              <Table
                size="small"
                rowKey="event"
                pagination={false}
                dataSource={top?.data || []}
                onRow={(record) => ({ onClick: () => setEvent(record.event) })}
                rowClassName={(r) => (r.event === event ? "ant-table-row-selected" : "")}
                columns={[
                  { title: "事件", dataIndex: "event" },
                  { title: "次数", dataIndex: "count", width: 100 },
                  { title: "用户数", dataIndex: "users", width: 100 },
                ]}
              />
            </Card>
          </Col>
          <Col span={14}>
            <Card title={`趋势：${event || "(选择左侧事件)"}`} size="small">
              {event ? (
                <ReactECharts option={chartOption} style={{ height: 360 }} />
              ) : (
                <Empty description="暂无数据" />
              )}
            </Card>
          </Col>
        </Row>
      )}
    </div>
  );
}
