export interface WritableSpan {
  setAttribute(name: string, value: string): unknown;
}

export function sanitizedTelemetryPath(rawTarget: string | undefined): string {
  if (!rawTarget) return '/';
  try {
    return new URL(rawTarget, 'http://internal.invalid').pathname;
  } catch {
    return '/';
  }
}

export function applySafeHttpSpanAttributes(
  span: WritableSpan,
  request: {
    readonly method: string | undefined;
    readonly url: string | undefined;
  },
): void {
  const path = sanitizedTelemetryPath(request.url);
  span.setAttribute('http.request.method', request.method ?? 'UNKNOWN');
  span.setAttribute('http.route', path);
  span.setAttribute('http.target', path);
  span.setAttribute('http.url', path);
  span.setAttribute('url.full', path);
  span.setAttribute('url.path', path);
  span.setAttribute('url.query', '');
}
