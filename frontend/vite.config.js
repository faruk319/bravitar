import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Bind IPv4: *.lvh.me and *.localhost resolve to 127.0.0.1, while Vite's
    // default 'localhost' binds ::1 only — subdomains get connection refused.
    host: '127.0.0.1',
    // Reachable as <org-slug>.lvh.me:5173 so the backend can resolve the
    // tenant from the Host header, the same way it will in production.
    allowedHosts: ['.lvh.me', '.localhost'],
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8001',
        // changeOrigin stays false so the original Host header
        // (<slug>.localhost) reaches Django's tenant middleware.
        changeOrigin: false,
      },
    },
  },
})
