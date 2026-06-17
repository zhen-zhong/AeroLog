import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import "antd/dist/reset.css";

export const metadata: Metadata = {
  title: "AeroLog 控制台",
  description: "AeroLog 埋点分析平台",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0 }}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
