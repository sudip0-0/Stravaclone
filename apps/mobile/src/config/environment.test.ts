import { describe, expect, it } from 'vitest';
import { validateApiUrl } from './environment';

describe('validateApiUrl', () => {
  it('accepts HTTPS and explicit development loopback URLs', () => {
    expect(validateApiUrl('https://api.example.com/')).toBe(
      'https://api.example.com',
    );
    expect(validateApiUrl('http://10.0.2.2:3000')).toBe('http://10.0.2.2:3000');
  });
  it('rejects insecure remote and malformed values', () => {
    expect(() => validateApiUrl('http://api.example.com')).toThrow(/HTTPS/);
    expect(() => validateApiUrl('not a url')).toThrow(/absolute/);
    expect(() => validateApiUrl(undefined)).toThrow(/required/);
  });
});
