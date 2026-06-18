/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8082",
  },
  async rewrites() {
    return [
      // 让前端在浏览器侧也能直接走相对路径调用 API（可选）
      { source: "/api/:path*", destination: `${process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8082"}/v1/:path*` },
    ];
  },
};

module.exports = nextConfig;
