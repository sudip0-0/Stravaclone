import {
  BatchSpanProcessor,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-base';
import type { ApiConfig } from '../config.js';
import { SanitizingSpanExporter } from './privacy.js';

export interface TelemetryLifecycle {
  shutdown(): Promise<void>;
}

const noOpLifecycle: TelemetryLifecycle = { shutdown: async () => undefined };

export interface TelemetryStartOptions {
  readonly traceExporter?: SpanExporter;
}

export async function startTelemetry(
  config: ApiConfig,
  options: TelemetryStartOptions = {},
): Promise<TelemetryLifecycle> {
  if (!config.OTEL_ENABLED) return noOpLifecycle;

  const [{ NodeSDK }, { getNodeAutoInstrumentations }] = await Promise.all([
    import('@opentelemetry/sdk-node'),
    import('@opentelemetry/auto-instrumentations-node'),
  ]);
  const traceExporter =
    options.traceExporter ??
    new (
      await import('@opentelemetry/exporter-trace-otlp-http')
    ).OTLPTraceExporter({
      url: `${config.OTEL_EXPORTER_OTLP_ENDPOINT!.replace(/\/$/, '')}/v1/traces`,
    });
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
        },
      }),
    ],
    // Keep production batching while enforcing sanitization immediately before
    // every export, after all instrumentations have had a chance to add data.
    spanProcessors: [
      new BatchSpanProcessor(new SanitizingSpanExporter(traceExporter)),
    ],
  });
  sdk.start();
  return { shutdown: async () => sdk.shutdown() };
}
