import { defineConfig } from 'vitest/config';

// Contract tests compile Solidity and spin an in-process EVM, so they need
// generous timeouts and must run serially (one ganache node at a time).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
