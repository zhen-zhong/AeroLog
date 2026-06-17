"use client";

import { ConfigProvider, Layout, Menu } from "antd";
import { usePathname, useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo } from "react";

const { Header, Sider, Content } = Layout;

export function AppShell({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const pathname = usePathname() || "/";
    const client = useMemo(() => new QueryClient(), []);

    const items = [
        { key: "/console", label: "概览看板", onClick: () => router.push("/console") },
        { key: "/console/event", label: "事件分析", onClick: () => router.push("/console/event") },
        { key: "/console/funnel", label: "漏斗分析", onClick: () => router.push("/console/funnel") },
        { key: "/console/retention", label: "留存分析", onClick: () => router.push("/console/retention") },
        { key: "/admin/projects", label: "项目管理", onClick: () => router.push("/admin/projects") },
        { key: "/admin/events", label: "埋点元数据", onClick: () => router.push("/admin/events") },
    ];

    return (
        <ConfigProvider>
            <QueryClientProvider client={client}>
                <Layout style={{ minHeight: "100vh" }}>
                    <Header style={{ color: "#fff", fontSize: 18, fontWeight: 600 }}>AeroLog</Header>
                    <Layout>
                        <Sider width={220} theme="light">
                            <Menu
                                mode="inline"
                                selectedKeys={[items.find((i) => pathname.startsWith(i.key))?.key || ""]}
                                items={items.map(({ onClick, ...rest }) => ({ ...rest, onClick: onClick }))}
                            />
                        </Sider>
                        <Content style={{ padding: 24 }}>{children}</Content>
                    </Layout>
                </Layout>
            </QueryClientProvider>
        </ConfigProvider>
    );
}
