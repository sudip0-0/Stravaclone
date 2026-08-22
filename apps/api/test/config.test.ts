import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';
import { validEnvironment } from './fixtures.js';

const productionEnvironment = {
  ...validEnvironment,
  NODE_ENV: 'production',
  DATABASE_URL:
    'postgres://trail:strong-database-value-123@db.provider.invalid:5432/trail?sslmode=require',
  OBJECT_STORAGE_ENDPOINT: 'objects.provider.invalid',
  OBJECT_STORAGE_USE_SSL: 'true',
  OBJECT_STORAGE_ACCESS_KEY: 'AKIA123456789',
  OBJECT_STORAGE_SECRET_KEY: 'strong-production-value-123',
  MAP_STYLE_URL: 'https://tiles.provider.invalid/style.json',
  TRUST_PROXY_HOPS: '1',
};

describe('API environment', () => {
  it('parses credential-free local disabled-email values', () => {
    const config = parseConfig(validEnvironment);
    expect(config.EMAIL_MODE).toBe('disabled');
    expect(config.SMTP_PASSWORD).toBeUndefined();
    expect(config.PORT).toBe(3000);
  });

  it('allows unauthenticated non-TLS Mailpit only outside production', () => {
    const config = parseConfig({
      ...validEnvironment,
      EMAIL_MODE: 'smtp',
      EMAIL_PROVIDER: 'mailpit',
      SMTP_HOST: 'localhost',
      SMTP_PORT: '1025',
      SMTP_FROM: 'test@example.test',
    });
    expect(config.EMAIL_PROVIDER).toBe('mailpit');
    expect(config.SMTP_USER).toBeUndefined();
  });

  it('fails clearly without including invalid or secret values', () => {
    const secret = 'contains-sensitive-value';
    expect(() =>
      parseConfig({ ...validEnvironment, DATABASE_URL: secret }),
    ).toThrow('Invalid API environment configuration: DATABASE_URL');
    try {
      parseConfig({ ...validEnvironment, DATABASE_URL: secret });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it('requires distinct canonical 32-byte base64url security keys', () => {
    expect(() =>
      parseConfig({ ...validEnvironment, JWT_SIGNING_KEY: 'not-base64url' }),
    ).toThrow('JWT_SIGNING_KEY');
    expect(() =>
      parseConfig({
        ...validEnvironment,
        EMAIL_OUTBOX_KEY: validEnvironment.JWT_SIGNING_KEY,
      }),
    ).toThrow(/JWT_SIGNING_KEY.*EMAIL_OUTBOX_KEY.*REFRESH_RECOVERY_KEY/);
  });

  it('requires matching explicit email mode and provider', () => {
    expect(() =>
      parseConfig({ ...validEnvironment, EMAIL_PROVIDER: 'mailpit' }),
    ).toThrow('EMAIL_PROVIDER');
    expect(() =>
      parseConfig({
        ...validEnvironment,
        EMAIL_MODE: 'smtp',
        EMAIL_PROVIDER: 'smtp',
      }),
    ).toThrow('SMTP_HOST');
  });

  it('requires authenticated TLS SMTP in production', () => {
    expect(() =>
      parseConfig({
        ...productionEnvironment,
        EMAIL_MODE: 'smtp',
        EMAIL_PROVIDER: 'mailpit',
        SMTP_HOST: 'localhost',
        SMTP_PORT: '1025',
        SMTP_FROM: 'sender@provider.invalid',
      }),
    ).toThrow(
      /EMAIL_PROVIDER.*SMTP_HOST.*SMTP_REQUIRE_TLS.*SMTP_USER.*SMTP_PASSWORD/,
    );

    const config = parseConfig({
      ...productionEnvironment,
      EMAIL_MODE: 'smtp',
      EMAIL_PROVIDER: 'resend',
      SMTP_HOST: 'smtp.resend.invalid',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_REQUIRE_TLS: 'true',
      SMTP_USER: 'resend-user-123',
      SMTP_PASSWORD: 'production-api-key-123',
      SMTP_FROM: 'sender@provider.invalid',
    });
    expect(config.SMTP_REQUIRE_TLS).toBe(true);
  });

  it.each([
    ['DATABASE_URL', { DATABASE_URL: validEnvironment.DATABASE_URL }],
    ['OBJECT_STORAGE_ENDPOINT', { OBJECT_STORAGE_ENDPOINT: 'localhost' }],
    ['OBJECT_STORAGE_USE_SSL', { OBJECT_STORAGE_USE_SSL: 'false' }],
    ['OBJECT_STORAGE_SECRET_KEY', { OBJECT_STORAGE_SECRET_KEY: 'change-me' }],
    [
      'MAP_STYLE_URL',
      { MAP_STYLE_URL: 'http://tiles.provider.invalid/style.json' },
    ],
  ])('rejects insecure production %s configuration', (field, override) => {
    expect(() =>
      parseConfig({ ...productionEnvironment, ...override }),
    ).toThrow(field);
  });

  it('rejects short and URL-encoded placeholder production credentials without printing values', () => {
    const encodedPlaceholder = 'change-me-database-value';
    const encodedUrl = `postgres://trail:${encodeURIComponent(encodedPlaceholder)}@db.provider.invalid:5432/trail?sslmode=require`;
    expect(() =>
      parseConfig({ ...productionEnvironment, DATABASE_URL: encodedUrl }),
    ).toThrow('DATABASE_URL');
    expect(() =>
      parseConfig({
        ...productionEnvironment,
        OBJECT_STORAGE_ACCESS_KEY: 'short',
        OBJECT_STORAGE_SECRET_KEY: 'also-short',
      }),
    ).toThrow(/OBJECT_STORAGE_ACCESS_KEY.*OBJECT_STORAGE_SECRET_KEY/);
    try {
      parseConfig({ ...productionEnvironment, DATABASE_URL: encodedUrl });
    } catch (error) {
      expect(String(error)).not.toContain(encodedPlaceholder);
    }
  });

  it('requires a nonlocal HTTPS exporter in production', () => {
    expect(() =>
      parseConfig({
        ...productionEnvironment,
        OTEL_ENABLED: 'true',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
      }),
    ).toThrow('OTEL_EXPORTER_OTLP_ENDPOINT');
    expect(
      parseConfig({
        ...productionEnvironment,
        OTEL_ENABLED: 'true',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otel.provider.invalid',
      }).OTEL_ENABLED,
    ).toBe(true);
  });
});
