import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,   // GitHub OAuth 回调端口必须与注册值精确匹配，禁止端口漂移
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
});
