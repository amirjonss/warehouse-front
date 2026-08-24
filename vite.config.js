import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    watch: {
      // dist-electron наполняет electron-builder (сотни МБ бинарников Electron).
      // Если dev-сервер за ним следит, открытые хендлы ломают сборку установщика
      // (EPERM при переименовании win-unpacked.tmp -> win-unpacked).
      ignored: ['**/dist-electron/**'],
    },
  },
})
