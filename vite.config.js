import { defineConfig } from 'vite'

export default defineConfig({
  root: '.',
  publicDir: 'public',
  base: '/guided-tour/',
  build: {
    outDir: 'dist',
  },
})
