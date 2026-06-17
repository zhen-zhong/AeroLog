"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Select, Space, Table, Typography, Empty } from "antd";
import { api } from "@/lib/api";

interface EventDef {
  id: number;
  project_id: number;
  event_name: string;
  display_name: string;
  category: string;
  description: string;
  is_active: boolean;
  first_seen_at: string;
  last_seen_at: string;
}

export default function EventsPage() {
  const [projectId, setProjectId] = useState<number | undefined>();

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects(),
  });

  useEffect(() => {
    if (!projectId && projects?.data?.length) {
      setProjectId(projects.data[0].id);
    }
  }, [projects, projectId]);

  const { data, isLoading } = useQuery({
    queryKey: ["events", projectId],
    queryFn: async () => {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8082"}/v1/projects/${projectId}/events`,
      );
      return (await res.json()) as { data: EventDef[] };
    },
    enabled: !!projectId,
  });

  const columns = [
    { title: "事件名", dataIndex: "event_name" },
    { title: "显示名", dataIndex: "display_name" },
    { title: "分类", dataIndex: "category", width: 120 },
    { title: "描述", dataIndex: "description" },
    {
      title: "状态",
      dataIndex: "is_active",
      width: 100,
      render: (v: boolean) => (v ? "启用" : "禁用"),
    },
    { title: "首次出现", dataIndex: "first_seen_at", width: 180 },
    { title: "最近出现", dataIndex: "last_seen_at", width: 180 },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }} size="large">
        <Typography.Title level={4} style={{ margin: 0 }}>
          埋点元数据
        </Typography.Title>
        <Select
          style={{ width: 240 }}
          placeholder="选择项目"
          value={projectId}
          onChange={setProjectId}
          options={(projects?.data || []).map((p) => ({ value: p.id, label: p.name }))}
        />
      </Space>

      {projectId ? (
        <Table
          rowKey="id"
          loading={isLoading}
          columns={columns}
          dataSource={data?.data || []}
          pagination={{ pageSize: 20 }}
        />
      ) : (
        <Empty description="暂无项目，请先在项目管理页面创建" />
      )}
    </div>
  );
}
