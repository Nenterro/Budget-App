import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Not autoUpdate: that activated a new build's worker straight away and
      // deleted the old build's files while the open page still needed them.
      // The new worker now waits, and src/utils/appUpdate.js switches over
      // when the app is backgrounded or freshly opened with no form open.
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'pwa-192x192.png', 'pwa-512x512.png'],
      // The generated worker only caches. Push handling (public/push-sw.js)
      // is loaded into it, so notifications don't need a hand-written worker.
      workbox: { importScripts: ['push-sw.js'] },
      manifest: {
        name: 'Budget',
        short_name: 'Budget',
        description: 'Personal finance manager',
        theme_color: '#1a1a1e',
        background_color: '#1a1a1e',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ],
  build: {
    rollupOptions: {
      output: {
        // Everything shipped as one ~1.1 MB chunk, so the first paint waited on
        // the charting library even on pages that draw no charts. Splitting the
        // three heavyweight vendors out lets them cache independently of app
        // code, which also means a normal app update no longer re-downloads
        // them.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          motion: ['framer-motion'],
        }
      }
    },
    chunkSizeWarningLimit: 700
  },
})
