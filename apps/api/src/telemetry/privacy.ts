import { trace, type Attributes } from '@opentelemetry/api';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';

const trustedRouteTemplateAttribute = 'trail.http.route_template';
export const unmatchedHttpRouteTemplate = 'unmatched-route';

const safeMethods = new Set([
  'DELETE',
  'GET',
  'HEAD',
  'OPTIONS',
  'PATCH',
  'POST',
  'PUT',
]);

function safeRouteTemplate(value: unknown): string | undefined {
  if (value === unmatchedHttpRouteTemplate) return value;
  if (typeof value !== 'string' || !value.startsWith('/')) return undefined;
  if (value.includes('?') || value.includes('#') || value.includes('://'))
    return undefined;
  // Route parameters must remain named templates. UUIDs indicate that an
  // unexpected raw request path reached the trusted route attribute.
  if (
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i.test(
      value,
    )
  )
    return undefined;
  return value;
}

export function setActiveHttpRouteTemplate(
  routeTemplate: string | undefined,
): void {
  const route = safeRouteTemplate(routeTemplate);
  if (route)
    trace.getActiveSpan()?.setAttribute(trustedRouteTemplateAttribute, route);
}

function sanitizedAttributes(attributes: Attributes): Attributes {
  const safe: Attributes = {};
  const route = safeRouteTemplate(attributes[trustedRouteTemplateAttribute]);
  const method = attributes['http.request.method'] ?? attributes['http.method'];
  const status =
    attributes['http.response.status_code'] ?? attributes['http.status_code'];

  if (route) safe['http.route'] = route;
  if (typeof method === 'string' && safeMethods.has(method.toUpperCase())) {
    safe['http.request.method'] = method.toUpperCase();
  }
  if (
    typeof status === 'number' &&
    Number.isInteger(status) &&
    status >= 100 &&
    status <= 599
  ) {
    safe['http.response.status_code'] = status;
  }
  return safe;
}

function copySpanContext(context: ReturnType<ReadableSpan['spanContext']>) {
  return {
    traceId: context.traceId,
    spanId: context.spanId,
    traceFlags: context.traceFlags,
    ...(context.isRemote === undefined ? {} : { isRemote: context.isRemote }),
  };
}

function copyTime(time: readonly [number, number]): [number, number] {
  return [time[0], time[1]];
}

function sanitizedSpan(span: ReadableSpan): ReadableSpan {
  const spanContext = copySpanContext(span.spanContext());
  const parentSpanContext = span.parentSpanContext
    ? copySpanContext(span.parentSpanContext)
    : undefined;

  // This is a detached value object, not a view over the SDK span. Keep the
  // complete property set needed by the supported OTLP/SDK exporters, but copy
  // only non-sensitive timing/context metadata and allowlisted HTTP dimensions.
  // In particular, no getter, proxy, method, or nested object can reach the
  // original resource, attributes, events, links, or status message.
  return {
    name: 'sanitized-span',
    kind: span.kind,
    spanContext: () => ({ ...spanContext }),
    ...(parentSpanContext
      ? { parentSpanContext: { ...parentSpanContext } }
      : {}),
    startTime: copyTime(span.startTime),
    endTime: copyTime(span.endTime),
    status: { code: span.status.code },
    attributes: sanitizedAttributes(span.attributes),
    links: [],
    events: [],
    duration: copyTime(span.duration),
    ended: span.ended,
    resource: { attributes: {} } as ReadableSpan['resource'],
    instrumentationScope: { name: 'trail-sanitized-export' },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

/**
 * Last-line privacy boundary for every trace exporter. Only the route template
 * set by Trail's Fastify hook, normalized methods, and numeric response status
 * codes can cross it. Instrumentation-provided routes and paths, raw URLs,
 * resource/provider attributes, query/header/body values, DB statements,
 * events, links, and status messages are discarded regardless of instrumentation.
 *
 * Delegates must consume the public `ReadableSpan` data contract, as the OTLP
 * HTTP exporter does. Exporters that depend on SDK-private concrete Span
 * instances, prototypes, non-enumerable properties, or object identity are not
 * supported; retaining those would defeat this detached privacy boundary.
 */
export class SanitizingSpanExporter implements SpanExporter {
  public constructor(private readonly delegate: SpanExporter) {}

  public export(
    spans: ReadableSpan[],
    resultCallback: Parameters<SpanExporter['export']>[1],
  ): void {
    this.delegate.export(spans.map(sanitizedSpan), resultCallback);
  }

  public forceFlush(): Promise<void> {
    return this.delegate.forceFlush?.() ?? Promise.resolve();
  }

  public shutdown(): Promise<void> {
    return this.delegate.shutdown();
  }
}
