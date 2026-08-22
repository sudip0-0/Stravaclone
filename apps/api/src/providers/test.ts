import type { DependencyStatus, Providers } from './ports.js';

export function createTestProviders(
  status: DependencyStatus = 'up',
  options: { readonly delayMs?: number; readonly emailEnabled?: boolean } = {},
): Providers {
  const checkHealth = async (): Promise<DependencyStatus> => {
    if (options.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }
    return status;
  };

  return {
    database: { checkHealth },
    objectStorage: { bucket: 'test-private', checkHealth },
    email: {
      enabled: options.emailEnabled ?? false,
      checkHealth,
      send: async () => undefined,
    },
    mapStyle: { styleUrl: 'https://example.test/style.json' },
    elevation: {
      getElevations: async ({ points }) => ({
        elevationsM: points.map(() => null),
      }),
    },
    routing: {
      route: async () => Promise.reject(new Error('Routing disabled')),
    },
    telemetry: { captureException: () => undefined },
    close: async () => undefined,
  };
}
