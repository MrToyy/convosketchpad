import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

// `npm run dev` supplies these internal values. Users configure only HOST/PORT.
const port = parseInt(process.env.CONVOSKETCHPAD_DEV_ENTRY_PORT || process.env.PORT || '3080', 10)
const host = process.env.CONVOSKETCHPAD_DEV_ENTRY_HOST || process.env.HOST || '127.0.0.1'
const backendPort = process.env.CONVOSKETCHPAD_DEV_BACKEND_PORT || '3081'
const apiTarget = `http://127.0.0.1:${backendPort}`

export default defineConfig({
  clearScreen: false,
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_TAGLINE__: JSON.stringify(pkg.description),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port,
    strictPort: true,
    host,
    proxy: {
      '/api': apiTarget,
      '/health': apiTarget,
    },
  },
  build: {
    sourcemap: false, // No sourcemaps in production
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React libraries (most stable, cache-friendly)
          'react-vendor': ['react', 'react-dom'],
          
          // Markdown rendering
          'markdown': ['react-markdown', 'remark-gfm'],
          
          // UI components (radix + lucide icons)
          'ui-vendor': ['lucide-react'],
          
          // Utility libraries
          'utils': ['clsx', 'tailwind-merge', 'class-variance-authority'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
})
