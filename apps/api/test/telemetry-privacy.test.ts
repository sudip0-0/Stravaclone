import { SpanKind, TraceFlags } from '@opentelemetry/api';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { describe, expect, it } from 'vitest';
import { SanitizingSpanExporter } from '../src/telemetry/privacy.js';

const enumerableSnapshot = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(enumerableSnapshot);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Reflect.ownKeys(value)
      .filter((key): key is string => typeof key === 'string')
      .map((key) => [key, enumerableSnapshot(Reflect.get(value, key))]),
  );
};

describe('telemetry privacy', () => {
  it('exports a detached, enumerable allowlist of safe span fields', async () => {
    let exported: ReadableSpan[] = [];
    const delegate: SpanExporter = {
      export(spans, callback) {
        exported = spans;
        callback({ code: 0 });
      },
      shutdown: async () => undefined,
    };
    const exporter = new SanitizingSpanExporter(delegate);
    const originalAttributes = {
      'trail.http.route_template': '/private/:id',
      'http.route': '/private/instrumentation-route-secret',
      'http.request.method': 'get',
      'http.response.status_code': 200,
      'url.path': '/private/instrumentation-path-secret',
      'url.full':
        'https://provider.invalid/private/private-id?token=query-token',
      'db.statement': 'select private-value',
    };
    const originalEvents = [{ name: 'private-event' }];
    const originalLinks = [{ attributes: { token: 'private-link' } }];
    const originalStatus = { code: 0, message: 'private-status' };
    const originalResource = {
      attributes: { 'cloud.provider': 'private-provider' },
    };
    const input = {
      name: 'GET /private/private-id?token=query-token',
      kind: SpanKind.SERVER,
      spanContext: () => ({
        traceId: '0123456789abcdef0123456789abcdef',
        spanId: '0123456789abcdef',
        traceFlags: TraceFlags.SAMPLED,
        traceState: { private: 'private-trace-state' },
      }),
      parentSpanContext: {
        traceId: 'abcdef0123456789abcdef0123456789',
        spanId: 'abcdef0123456789',
        traceFlags: TraceFlags.NONE,
        traceState: { private: 'private-parent-trace-state' },
      },
      startTime: [100, 200],
      endTime: [101, 300],
      duration: [1, 100],
      ended: true,
      attributes: originalAttributes,
      events: originalEvents,
      links: originalLinks,
      status: originalStatus,
      resource: originalResource,
      instrumentationScope: {
        name: 'private-instrumentation',
        version: 'private-version',
      },
      droppedAttributesCount: 7,
      droppedEventsCount: 8,
      droppedLinksCount: 9,
    } as unknown as ReadableSpan;

    await new Promise<void>((resolve) =>
      exporter.export([input], () => resolve()),
    );

    const span = exported[0]!;
    expect(span).not.toBe(input);
    expect(Object.getPrototypeOf(span)).toBe(Object.prototype);
    expect(span.attributes).toEqual({
      'http.request.method': 'GET',
      'http.response.status_code': 200,
      'http.route': '/private/:id',
    });
    expect(span.attributes).not.toBe(originalAttributes);
    expect(span.name).toBe('sanitized-span');
    expect(span.events).toEqual([]);
    expect(span.events).not.toBe(originalEvents);
    expect(span.links).toEqual([]);
    expect(span.links).not.toBe(originalLinks);
    expect(span.status).toEqual({ code: 0 });
    expect(span.status).not.toBe(originalStatus);
    expect(span.resource).toEqual({ attributes: {} });
    expect(span.resource).not.toBe(originalResource);
    expect(span.instrumentationScope).toEqual({
      name: 'trail-sanitized-export',
    });
    expect(span.spanContext()).toEqual({
      traceId: '0123456789abcdef0123456789abcdef',
      spanId: '0123456789abcdef',
      traceFlags: TraceFlags.SAMPLED,
    });
    expect(span.parentSpanContext).toEqual({
      traceId: 'abcdef0123456789abcdef0123456789',
      spanId: 'abcdef0123456789',
      traceFlags: TraceFlags.NONE,
    });
    expect(Reflect.ownKeys(span).sort()).toEqual(
      [
        'attributes',
        'droppedAttributesCount',
        'droppedEventsCount',
        'droppedLinksCount',
        'duration',
        'endTime',
        'ended',
        'events',
        'instrumentationScope',
        'kind',
        'links',
        'name',
        'parentSpanContext',
        'resource',
        'spanContext',
        'startTime',
        'status',
      ].sort(),
    );

    const enumerated = JSON.stringify(enumerableSnapshot(span));
    for (const sensitive of [
      'query-token',
      'private-id',
      'instrumentation-route-secret',
      'instrumentation-path-secret',
      'trail.http.route_template',
      'private-value',
      'private-provider',
      'private-status',
      'private-event',
      'private-link',
      'private-trace-state',
      'private-parent-trace-state',
      'private-instrumentation',
      'private-version',
    ]) {
      expect(enumerated).not.toContain(sensitive);
    }
  });
});
