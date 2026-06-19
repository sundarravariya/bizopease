import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/kiosk/',
  build: {
    outDir: 'dist-kiosk',
    sourcemap: false,
    rollupOptions: {
      input: 'index-kiosk.html',
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          icons: ['lucide-react'],
        },
      },
    },
  },
});
