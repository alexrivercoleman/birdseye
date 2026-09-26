import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  server: {
    // Phone testing: one HTTPS tunnel (cloudflared) to this dev server; /api is proxied to the local FastAPI.
    allowedHosts: ['.trycloudflare.com'],
    // API_PROXY_TARGET overrides the local API address (e.g. if something else already uses port 8000).
    proxy: { '/api': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:8000', changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') } },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: { maximumFileSizeToCacheInBytes: 4 * 1024 * 1024 }, // mapbox-gl chunk
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Birdseye',
        short_name: 'Birdseye',
        description: 'Strava for birding',
        display: 'standalone',
        start_url: '/',
        background_color: '#f7f3ea',
        theme_color: '#1f3d2b',
        // TODO(A): add 192/512 PNG icons + apple-touch-icon (iOS ignores SVG for home screen)
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
    }),
  ],
})
