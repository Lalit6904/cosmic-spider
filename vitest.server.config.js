import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'server',
    environment: 'node',
    include: ['tests/server/**/*.test.js', 'tests/shared/**/*.test.js'],
    setupFiles: ['tests/setup.server.js'],
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 30_000,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['server/**/*.js', 'shared/**/*.js'],
      exclude: ['server/index.js'],
    },
  },
});
