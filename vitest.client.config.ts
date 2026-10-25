import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'client',
    environment: 'jsdom',
    include: ['tests/client/**/*.test.tsx', 'tests/client/**/*.test.ts'],
    setupFiles: ['tests/setup.client.ts'],
    restoreMocks: true,
    testTimeout: 15_000,
  },
});
