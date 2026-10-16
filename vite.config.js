import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 纯前端演示：base 用相对路径，构建产物可直接丢到任意静态目录 / CDN 子路径。
export default defineConfig({
  base: './',
  plugins: [vue()],
  server: {
    host: true, // 手机连同一 Wi-Fi 即可用局域网 IP 打开调试
    port: 5180,
    open: false,
  },
  preview: {
    host: true,
    port: 4180,
  },
  build: {
    target: 'es2019',
    cssTarget: 'chrome87',
    chunkSizeWarningLimit: 900,
  },
})
