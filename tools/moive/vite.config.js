import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const cmsTarget = process.env.VITE_CMS_API_BASE || 'https://cj.rycjapi.com';
const basePath = process.env.VITE_BASE_PATH || '/';

export default defineConfig({
  base: basePath,
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 3000,
    proxy: {
      '/cms-api': {
        target: cmsTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/cms-api/, ''),
      },
    },
  },
});
