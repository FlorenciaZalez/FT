import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_API_URL?.trim()

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: apiTarget
        ? {
            '/api': {
              target: apiTarget,
              changeOrigin: true,
            },
          }
        : undefined,
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-pdf': ['jspdf', 'dompurify'],
            'vendor-misc': ['axios', 'jsbarcode', 'qrcode.react', 'lucide-react'],
          },
        },
      },
    },
  }
})
