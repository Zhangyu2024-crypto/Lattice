// Vitest configuration — intentionally standalone rather than merging with
// vite.config.ts, because the main Vite config loads `vite-plugin-electron`
// which would try to spawn the Electron main process on every test run.
// We only need the React JSX transform and the `@` → `src` alias here; the
// electron main process is tested separately via `vi.mock('electron')`.

import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    // jsdom is the default — any node-only suite (pure algorithm, main-proc
    // IPC with `vi.mock('electron')`) opts out via `// @vitest-environment node`.
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'electron/**/*.{test,spec}.{ts,tsx}',
    ],
    // Skip anything the production build excludes (dist, dist-electron,
    // node_modules) plus the e2e folder which runs under Playwright.
    exclude: [
      'node_modules/**',
      'dist/**',
      'dist-electron/**',
      'release/**',
      'e2e/**',
    ],
    css: false,
    // 3Dmol + jsdom occasionally leave timers; give suites 10s rather than
    // the 5s default so a slow machine doesn't produce flaky failures.
    testTimeout: 10_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/**', 'src/stores/**', 'src/components/**'],
      exclude: [
        'src/test/**',
        'src/**/*.d.ts',
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
      ],
    },
  },
})
