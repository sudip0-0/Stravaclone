import { describe, expect, it } from 'vitest';
import { applySafeHttpSpanAttributes } from '../src/telemetry/privacy.js';

describe('telemetry privacy', () => {
  it('removes query secrets and sensitive request IDs from span attributes', () => {
    const attributes: Record<string, string> = {};
    applySafeHttpSpanAttributes(
      {
        setAttribute(name, value) {
          attributes[name] = value;
        },
      },
      {
        method: 'GET',
        url: '/oauth/callback?token=query-token&code=query-code&state=query-state&signed_url=query-signature&x-request-id=malicious-id',
      },
    );

    expect(attributes).toEqual({
      'http.request.method': 'GET',
      'http.route': '/oauth/callback',
      'http.target': '/oauth/callback',
      'http.url': '/oauth/callback',
      'url.full': '/oauth/callback',
      'url.path': '/oauth/callback',
      'url.query': '',
    });
    expect(JSON.stringify(attributes)).not.toMatch(
      /query-token|query-code|query-state|query-signature|malicious-id/,
    );
  });
});
