import { parseConfig, type ApiConfig } from '../src/config.js';

export const validEnvironment = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: '3000',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgres://trail:test@localhost:5432/trail',
  OBJECT_STORAGE_ENDPOINT: 'localhost',
  OBJECT_STORAGE_PORT: '9000',
  OBJECT_STORAGE_USE_SSL: 'false',
  OBJECT_STORAGE_ACCESS_KEY: 'local-app',
  OBJECT_STORAGE_SECRET_KEY: 'local-app-value',
  OBJECT_STORAGE_BUCKET: 'trail-private',
  EMAIL_MODE: 'disabled',
  EMAIL_PROVIDER: 'none',
  SMTP_SECURE: 'false',
  SMTP_REQUIRE_TLS: 'false',
  MAP_STYLE_URL: 'https://example.test/style.json',
  READINESS_TIMEOUT_MS: '50',
  READINESS_CACHE_MS: '1000',
  OTEL_ENABLED: 'false',
} as const;

export const testConfig: ApiConfig = parseConfig(validEnvironment);
