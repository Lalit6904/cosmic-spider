import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'client',
    environment: 'jsdom',
    include: ['tests/client/**/*.test.jsx', 'tests/client/**/*.test.js'],
    setupFiles: ['tests/setup.client.js'],
    restoreMocks: true,
    testTimeout: 15_000,
  },
});
