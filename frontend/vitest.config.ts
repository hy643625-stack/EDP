import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['../packages/**/*.test.ts', 'src/**/*.test.ts'],
    globals: true
  },
  server: {
    fs: {
      allow: [fileURLToPath(new URL('..', import.meta.url))]
    }
  }
})
