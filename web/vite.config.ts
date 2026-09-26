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
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Birdseye',
        short_name: 'Birdseye',
        description: 'Strava for birding',
        display: 'standalone',
        start_url: '/',
        background_color: '#f7f3ea',
        theme_color: '#1f3d2b',
        // the bird logo on paper; apple-touch-icon.png (index.html) is the iOS home screen icon
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
