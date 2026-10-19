import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build works at games.soncrant.com/<slug>/
  // and on GitHub Pages staging (ADR-004).
  base: './',
  server: { port: 5175, strictPort: true },
  preview: { port: 6175, strictPort: true },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // The many-map tests take about a second each when the machine is quiet, but this
    // machine is shared with other games' test runs (load averages of 50-70), and one
    // passed Vitest's 5 s default at 5.35 s and stopped a release dry run (T1). The
    // tests and their checks are unchanged; each just gets 30 s before it counts as hung.
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/logic/**'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
