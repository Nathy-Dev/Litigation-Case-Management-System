import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig(({ command, mode }) => {
  const environment = loadEnv(mode, process.cwd(), 'VITE_')
  if (command === 'build') {
    const missing = ['VITE_CONVEX_URL', 'VITE_CONVEX_SITE_URL'].filter(
      (name) => !environment[name]?.trim(),
    )
    if (missing.length > 0) {
      throw new Error(`Missing build environment variables: ${missing.join(', ')}`)
    }
  }

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@shared': path.resolve(__dirname, './convex/shared'),
      },
    },
    server: {
      port: 5173,
      open: true,
    },
    build: {
      outDir: 'dist',
      // Enable hidden source maps in production so Sentry can symbolicate
      // stack traces without exposing the source to the browser.
      sourcemap: environment.VITE_SENTRY_DSN ? 'hidden' : false,
      chunkSizeWarningLimit: 1200,
    },
  }
})
