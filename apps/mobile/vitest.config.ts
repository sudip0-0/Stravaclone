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
        'src/features/activity-sync/sync-engine.ts',
        'src/features/activities/activity-model.ts',
        'src/features/photos/{photo-gallery-model,photo-sync-engine}.ts',
        'src/features/record/{location-adapter-policy,location-pipeline,permission-policy,recording-format,recording-service,recording-state-machine}.ts',
        'src/state/{recording-account-lifecycle,recording-draft-reporter}.ts',
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
