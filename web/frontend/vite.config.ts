import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

// Vite config: dev server proxies /api and /api/events/stream to the Go
// daemon (:9101) so the frontend and backend share an origin in dev (cookies
// are same-origin, no CORS needed). In production the built dist/ is deployed
// to a static host and VITE_API_BASE points to the daemon.
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:9101',
        changeOrigin: false,
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
