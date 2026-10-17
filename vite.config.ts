import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build works at games.soncrant.com/<slug>/
  // and on GitHub Pages staging (ADR-004).
  base: './',
  server: { port: 5190, strictPort: true },
  preview: { port: 6190, strictPort: true },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/logic/**'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
