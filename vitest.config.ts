import { defineConfig } from 'vitest/config';

// vitest.workspace.ts は Vitest 3.2 で非推奨・4 で廃止されたため test.projects で構成する。
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'engine',
          root: './packages/engine',
          environment: 'node',
          include: ['test/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'web',
          root: './apps/web',
          environment: 'jsdom',
          include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
        },
      },
      {
        test: {
          name: 'tools-mysql',
          root: './tools/mysql',
          environment: 'node',
          include: ['test/**/*.test.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
