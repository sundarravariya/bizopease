import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Served at the root of its own subdomain (dashboard.robifel.in)
  base: '/',
  server: {
    port: 5173,
    proxy: {
      // Dev proxy — forward Odoo API calls to production
      '/web': {
        target: 'https://odoo.robifel.in',
        changeOrigin: true,
        secure: true,
      },
      '/api': {
        target: 'https://odoo.robifel.in',
        changeOrigin: true,
        secure: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          router: ['react-router-dom'],
          charts: ['recharts'],
          icons: ['lucide-react'],
        },
      },
    },
  },
})
