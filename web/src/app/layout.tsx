import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "AeroLog 控制台",
  description: "AeroLog 埋点分析平台",
};

// 在 React hydrate 之前同步设置主题，避免明暗切换闪烁
const themeInitScript = `
(function(){try{var raw=localStorage.getItem('aerolog-ui');if(!raw)return;var data=JSON.parse(raw);var theme=data&&data.state&&data.state.theme;if(theme==='dark'){document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark';}}catch(e){}})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
