import { describe, expect, it, vi } from 'vitest';
import { bootstrapApplication } from '../src/startup.js';
import { testConfig } from './fixtures.js';

describe('instrumentation startup ordering', () => {
  it('starts telemetry before importing or starting the Fastify runtime', async () => {
    const events: string[] = [];
    const shutdown = vi.fn(async () => undefined);

    await bootstrapApplication(testConfig, {
      startTelemetry: async () => {
        events.push('telemetry-started');
        return { shutdown };
      },
      loadRuntime: async () => {
        events.push('runtime-imported');
        return {
          startRuntime: async () => {
            events.push('runtime-started');
          },
        };
      },
    });

    expect(events).toEqual([
      'telemetry-started',
      'runtime-imported',
      'runtime-started',
    ]);
  });
});
