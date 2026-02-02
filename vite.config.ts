import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api/browserless': {
        target: 'https://chrome.browserless.io',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/browserless/, ''),
      },
      '/api/urlbox': {
        target: 'https://api.urlbox.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/urlbox/, ''),
      },
      '/api/zenrows': {
        target: 'https://api.zenrows.com',
        changeOrigin: true,
        secure: true,
        timeout: 60000,
        rewrite: (path) => path.replace(/^\/api\/zenrows/, ''),
      },
    },
  },
})
