import type { ApiConfig } from '../config.js';
import { applySafeHttpSpanAttributes } from './privacy.js';

export interface TelemetryLifecycle {
  shutdown(): Promise<void>;
}

const noOpLifecycle: TelemetryLifecycle = { shutdown: async () => undefined };

export async function startTelemetry(
  config: ApiConfig,
): Promise<TelemetryLifecycle> {
  if (!config.OTEL_ENABLED) return noOpLifecycle;

  const [{ NodeSDK }, { getNodeAutoInstrumentations }, { OTLPTraceExporter }] =
    await Promise.all([
      import('@opentelemetry/sdk-node'),
      import('@opentelemetry/auto-instrumentations-node'),
      import('@opentelemetry/exporter-trace-otlp-http'),
    ]);
  const sdk = new NodeSDK({
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-amqplib': { enabled: false },
        '@opentelemetry/instrumentation-aws-sdk': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-grpc': { enabled: false },
        '@opentelemetry/instrumentation-kafkajs': { enabled: false },
        '@opentelemetry/instrumentation-mongodb': { enabled: false },
        '@opentelemetry/instrumentation-mysql': { enabled: false },
        '@opentelemetry/instrumentation-mysql2': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
        '@opentelemetry/instrumentation-pg': { enabled: false },
        '@opentelemetry/instrumentation-redis': { enabled: false },
        '@opentelemetry/instrumentation-undici': { enabled: false },
        '@opentelemetry/instrumentation-http': {
          headersToSpanAttributes: {
            client: { requestHeaders: [], responseHeaders: [] },
            server: { requestHeaders: [], responseHeaders: [] },
          },
          ignoreOutgoingRequestHook: () => true,
          requestHook: (span, request) => {
            applySafeHttpSpanAttributes(span, {
              method: 'method' in request ? request.method : undefined,
              url: 'url' in request ? request.url : undefined,
            });
          },
        },
      }),
    ],
    traceExporter: new OTLPTraceExporter({
      url: `${config.OTEL_EXPORTER_OTLP_ENDPOINT!.replace(/\/$/, '')}/v1/traces`,
    }),
  });
  sdk.start();
  return { shutdown: async () => sdk.shutdown() };
}
