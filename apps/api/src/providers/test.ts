import { Readable } from 'node:stream';
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

  const unavailableIdentity = {
    enabled: false,
    verify: async () => Promise.reject(new Error('Identity provider disabled')),
  };

  return {
    database: { checkHealth },
    identity: { apple: unavailableIdentity, google: unavailableIdentity },
    objectStorage: {
      bucket: 'test-private',
      checkHealth,
      presignPost: async () => ({
        url: 'https://example.test/upload',
        fields: {},
      }),
      presignGet: async () => 'https://example.test/download',
      head: async () => null,
      get: async () => Readable.from([]),
      put: async () => undefined,
      delete: async () => undefined,
    },
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
