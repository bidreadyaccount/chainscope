import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'indexer',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: { NODE_ENV: 'test', DATA_MODE: 'demo' },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
