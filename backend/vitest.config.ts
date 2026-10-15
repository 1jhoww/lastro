import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] } },
      {
        test: {
          name: 'emulator',
          include: [
            'tests/integration/**/*.test.ts',
            'tests/security/**/*.test.ts',
            'tests/concurrency/**/*.test.ts',
          ],
          fileParallelism: false,
          maxWorkers: 1,
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
