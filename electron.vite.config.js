import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

// One alias for code shared by main, preload, and renderer. Dependencies listed in
// package.json "dependencies" stay external in main/preload (electron-vite 5 default).
const alias = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias }
  },
  preload: {
    resolve: { alias },
    build: {
      rollupOptions: {
        // Sandboxed preload scripts must be CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    resolve: { alias }
  }
})
