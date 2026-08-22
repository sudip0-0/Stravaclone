import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'coverage',
      include: [
        'src/services/{api-client,errors,session-coordinator}.ts',
        'src/state/{draft-guard,profile-state}.ts',
        'src/features/auth/form-focus.ts',
      ],
      thresholds: {
        branches: 60,
        functions: 65,
        lines: 65,
        statements: 65,
      },
    },
  },
});
