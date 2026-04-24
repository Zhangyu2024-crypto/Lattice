import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import electronRenderer from 'vite-plugin-electron-renderer'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            lib: {
              entry: 'electron/main.ts',
              formats: ['es'],
            },
            rollupOptions: {
              // dockerode (and its ssh2 dep) contain native `.node` binaries
              // that cannot be statically bundled — mark as external so they
              // are resolved from node_modules at runtime instead.
              external: [
                'electron',
                'dockerode',
                'ssh2',
                'cpu-features',
                'docker-modem',
                '@anthropic-ai/sdk',
              ],
              output: {
                entryFileNames: 'main.mjs',
              },
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(args) {
          args.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            lib: {
              entry: 'electron/preload.ts',
              // Use ESM — this matches vite-plugin-electron's default when
              // package.json has "type": "module". Vite's mergeConfig CONCATS
              // format arrays instead of replacing them, so specifying a
              // different format here produced ['es', 'cjs'], and both
              // builds wrote to the same preload.js and raced, corrupting
              // the file mid-write. Electron 28+ loads ESM preload scripts
              // only when the file has a `.mjs` extension — `sandbox: false`
              // alone is not enough; the internal preload loader uses
              // `require()` for `.js` and throws ERR_REQUIRE_ESM. The output
              // filename below MUST stay `.mjs` and `electron/main.ts` must
              // load the same extension.
              formats: ['es'],
            },
            rollupOptions: {
              external: ['electron'],
              output: {
                entryFileNames: 'preload.mjs',
              },
            },
          },
        },
      },
    ]),
    electronRenderer(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
