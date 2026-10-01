import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: {
    include: ['test/**/*.test.js'],
    environment: 'node',
    setupFiles: ['test/setup.js'],
    restoreMocks: true
  }
})
