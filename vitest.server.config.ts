import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'server',
    environment: 'node',
    include: ['tests/server/**/*.test.ts', 'tests/shared/**/*.test.ts'],
    setupFiles: ['tests/setup.server.ts'],
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 30_000,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['server/**/*.ts', 'shared/**/*.ts'],
      exclude: ['server/index.ts'],
    },
  },
});
