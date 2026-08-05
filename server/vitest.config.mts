import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup-env.ts'],
    // All test files share one Postgres schema — never run them in parallel.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000
  }
});
