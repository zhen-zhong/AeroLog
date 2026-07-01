# vidsrc-parser

一个基于 React + Vite + TypeScript 的视频源解析与播放前端应用，集成 HLS.js 播放支持，提供多语言（i18n）界面与路由化页面。

## ✨ 功能特性

- 🎬 视频源（vidsrc）解析与播放
- 📺 基于 [hls.js](https://github.com/video-dev/hls.js) 的 HLS 流媒体播放
- ⚛️ 基于 React 19 + React Router 7 的现代单页应用
- 🌍 内置 i18n 多语言支持
- ⚡ 使用 Vite 构建，开发体验快速流畅
- 🧩 使用 TypeScript 编写，类型安全

## 🛠️ 技术栈

- **框架**：React 19、React Router DOM 7
- **构建工具**：Vite 8
- **语言**：TypeScript 6
- **播放器**：hls.js
- **图标**：lucide-react

## 📦 安装

```bash
# 克隆仓库
git clone https://github.com/zhen-zhong/vidsrc-parser.git
cd vidsrc-parser

# 安装依赖
npm install
```

## 🚀 运行

```bash
# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 本地预览生产构建
npm run preview
```

## 生产部署路径

在 AeroLog 生产环境中，本项目目录仍为 `tools/moive`，但公网访问路径统一为：

```text
https://liyang.live/tools/movie/
```

构建时需要使用 `VITE_BASE_PATH=/tools/movie/`，资源站代理路径为 `/tools/movie/cms-api/api.php/provide/vod/`。历史 `/tools/moive/` 由外层 Nginx 301 跳转到新路径。

## 📁 项目结构

```
vidsrc-parser/
├── index.html              # 应用入口 HTML
├── vite.config.js          # Vite 配置
├── tsconfig.json           # TypeScript 配置
├── package.json
└── src/
    ├── main.tsx            # 应用入口
    ├── App.tsx             # 根组件 / 路由定义
    ├── api.ts              # 接口请求封装
    ├── components.tsx      # 公共组件
    ├── i18n.ts             # 国际化配置
    ├── styles.css          # 全局样式
    ├── types.ts            # 类型定义
    └── pages/              # 页面组件
```

## 📜 License

ISC
