"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Modal, Space, Table, Tag, Typography, message } from "antd";
import { api, Project } from "@/lib/api";

export default function ProjectsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const { data, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects(),
  });

  const createMut = useMutation({
    mutationFn: (body: { name: string; description?: string }) => api.createProject(body),
    onSuccess: () => {
      message.success("项目创建成功");
      setOpen(false);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e: Error) => message.error(e.message),
  });

  const columns = [
    { title: "ID", dataIndex: "id", width: 80 },
    { title: "项目名", dataIndex: "name" },
    {
      title: "Token",
      dataIndex: "token",
      render: (v: string) => <Typography.Text copyable code>{v}</Typography.Text>,
    },
    { title: "描述", dataIndex: "description" },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (v: number) => (v === 1 ? <Tag color="green">启用</Tag> : <Tag>禁用</Tag>),
    },
    { title: "创建时间", dataIndex: "created_at", width: 200 },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          项目管理
        </Typography.Title>
        <Button type="primary" onClick={() => setOpen(true)}>
          新建项目
        </Button>
      </Space>

      <Table<Project>
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={data?.data || []}
        pagination={{ pageSize: 20 }}
      />

      <Modal
        title="新建项目"
        open={open}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending}
        onCancel={() => setOpen(false)}
      >
        <Form form={form} layout="vertical" onFinish={(v) => createMut.mutate(v)}>
          <Form.Item label="项目名" name="name" rules={[{ required: true }]}>
            <Input placeholder="如：mall-app" />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
