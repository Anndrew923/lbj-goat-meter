import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './', // 供 Capacitor Android 正确加载资源
  plugins: [react()],
  server: {
    port: 2323,
    // 使用 2323 供本地測試；強制解除 COOP/COEP 攔截
    headers: {
      'Cross-Origin-Opener-Policy': 'unsafe-none',
      'Cross-Origin-Embedder-Policy': 'unsafe-none',
    },
  },
})
