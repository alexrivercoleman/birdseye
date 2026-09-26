import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
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
