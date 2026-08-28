import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Heavy libraries get their own long-cached chunks so a deploy that
        // only touches app code never re-downloads them.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          markdown: ['react-markdown', 'remark-math', 'rehype-katex'],
          katex: ['katex'],
          recharts: ['recharts'],
        },
      },
    },
  },
  server: {
    port: 3000,
    // /api/* → livingston's own deployment, so every page works locally
    // against real data (Vercel functions don't run under vite). It used to
    // fall back to cshl's deployment from before livingston had one — that
    // would now write chat sessions into another app's database. Override
    // with LIVINGSTON_API_ORIGIN (a preview URL, say).
    proxy: {
      "/api": {
        target: process.env.LIVINGSTON_API_ORIGIN ?? "https://livingston-nysgpt.vercel.app",
        changeOrigin: true,
      },
    },
  },
})
