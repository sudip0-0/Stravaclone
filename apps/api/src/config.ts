import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv({ quiet: true });

const booleanString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');
const optionalString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);
const optionalEmail = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.email().optional(),
);
const placeholderPattern =
  /(change[-_ ]?me|placeholder|example|trail-local|not-a-real|password|secret)/i;
const localHosts = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  'postgres',
  'minio',
  'mailpit',
]);

function isLocalHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '');
  return localHosts.has(normalized) || normalized.endsWith('.local');
}

function decodeCredential(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}

function addIssue(
  context: z.RefinementCtx,
  path: string,
  message: string,
): void {
  context.addIssue({ code: 'custom', message, path: [path] });
}

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    HOST: z.string().min(1).default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z
      .url()
      .refine(
        (value) =>
          value.startsWith('postgres://') || value.startsWith('postgresql://'),
      ),
    OBJECT_STORAGE_ENDPOINT: z.string().min(1),
    OBJECT_STORAGE_PORT: z.coerce.number().int().min(1).max(65535),
    OBJECT_STORAGE_USE_SSL: booleanString,
    OBJECT_STORAGE_ACCESS_KEY: z.string().min(1),
    OBJECT_STORAGE_SECRET_KEY: z.string().min(1),
    OBJECT_STORAGE_BUCKET: z.string().min(3),
    EMAIL_MODE: z.enum(['disabled', 'smtp']),
    EMAIL_PROVIDER: z.enum(['none', 'mailpit', 'resend', 'smtp']),
    SMTP_HOST: optionalString,
    SMTP_PORT: z.preprocess(
      (value) => (value === '' || value === undefined ? undefined : value),
      z.coerce.number().int().min(1).max(65535).optional(),
    ),
    SMTP_SECURE: booleanString.default(false),
    SMTP_REQUIRE_TLS: booleanString.default(false),
    SMTP_USER: optionalString,
    SMTP_PASSWORD: optionalString,
    SMTP_FROM: optionalEmail,
    MAP_STYLE_URL: z.url(),
    READINESS_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(25)
      .max(10_000)
      .default(1_000),
    READINESS_CACHE_MS: z.coerce
      .number()
      .int()
      .min(0)
      .max(30_000)
      .default(1_000),
    OTEL_ENABLED: booleanString.default(false),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
  })
  .superRefine((env, context) => {
    if (env.EMAIL_MODE === 'disabled' && env.EMAIL_PROVIDER !== 'none') {
      addIssue(
        context,
        'EMAIL_PROVIDER',
        'EMAIL_PROVIDER must be none when email is disabled',
      );
    }
    if (env.EMAIL_MODE === 'smtp') {
      if (env.EMAIL_PROVIDER === 'none')
        addIssue(context, 'EMAIL_PROVIDER', 'An SMTP provider is required');
      for (const field of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_FROM'] as const) {
        if (env[field] === undefined)
          addIssue(context, field, `${field} is required in SMTP mode`);
      }
    }
    if (env.OTEL_ENABLED && !env.OTEL_EXPORTER_OTLP_ENDPOINT) {
      addIssue(
        context,
        'OTEL_EXPORTER_OTLP_ENDPOINT',
        'An OTLP endpoint is required when telemetry is enabled',
      );
    }

    if (env.NODE_ENV !== 'production') return;

    const databaseUrl = new URL(env.DATABASE_URL);
    if (isLocalHost(databaseUrl.hostname))
      addIssue(context, 'DATABASE_URL', 'Production database must be nonlocal');
    if (databaseUrl.searchParams.get('sslmode') !== 'require') {
      addIssue(context, 'DATABASE_URL', 'Production database must require TLS');
    }
    const databasePassword = decodeCredential(databaseUrl.password);
    if (
      databasePassword.length < 16 ||
      placeholderPattern.test(databasePassword)
    ) {
      addIssue(
        context,
        'DATABASE_URL',
        'Production database credentials must not be placeholders',
      );
    }
    if (isLocalHost(env.OBJECT_STORAGE_ENDPOINT)) {
      addIssue(
        context,
        'OBJECT_STORAGE_ENDPOINT',
        'Production object storage must be nonlocal',
      );
    }
    if (!env.OBJECT_STORAGE_USE_SSL)
      addIssue(
        context,
        'OBJECT_STORAGE_USE_SSL',
        'Production object storage must use TLS',
      );
    if (
      env.OBJECT_STORAGE_ACCESS_KEY.length < 12 ||
      placeholderPattern.test(env.OBJECT_STORAGE_ACCESS_KEY)
    ) {
      addIssue(
        context,
        'OBJECT_STORAGE_ACCESS_KEY',
        'Production access key must not be a placeholder',
      );
    }
    if (
      env.OBJECT_STORAGE_SECRET_KEY.length < 24 ||
      placeholderPattern.test(env.OBJECT_STORAGE_SECRET_KEY)
    ) {
      addIssue(
        context,
        'OBJECT_STORAGE_SECRET_KEY',
        'Production secret key must not be a placeholder',
      );
    }
    if (!env.MAP_STYLE_URL.startsWith('https://'))
      addIssue(context, 'MAP_STYLE_URL', 'Production map URL must use HTTPS');

    if (env.EMAIL_MODE === 'smtp') {
      if (env.EMAIL_PROVIDER === 'mailpit')
        addIssue(context, 'EMAIL_PROVIDER', 'Mailpit is local-only');
      if (!env.SMTP_HOST || isLocalHost(env.SMTP_HOST))
        addIssue(context, 'SMTP_HOST', 'Production SMTP must be nonlocal');
      if (!env.SMTP_REQUIRE_TLS)
        addIssue(
          context,
          'SMTP_REQUIRE_TLS',
          'Production SMTP must require TLS',
        );
      if (
        !env.SMTP_USER ||
        env.SMTP_USER.length < 3 ||
        placeholderPattern.test(env.SMTP_USER)
      )
        addIssue(context, 'SMTP_USER', 'Production SMTP user is required');
      if (
        !env.SMTP_PASSWORD ||
        env.SMTP_PASSWORD.length < 20 ||
        placeholderPattern.test(env.SMTP_PASSWORD)
      ) {
        addIssue(
          context,
          'SMTP_PASSWORD',
          'Production SMTP password is required and must not be a placeholder',
        );
      }
    }
    if (env.OTEL_ENABLED) {
      const endpoint = new URL(env.OTEL_EXPORTER_OTLP_ENDPOINT!);
      if (endpoint.protocol !== 'https:' || isLocalHost(endpoint.hostname)) {
        addIssue(
          context,
          'OTEL_EXPORTER_OTLP_ENDPOINT',
          'Production OTLP endpoint must be nonlocal HTTPS',
        );
      }
    }
  });

export type ApiConfig = z.infer<typeof envSchema>;

export function parseConfig(
  source: NodeJS.ProcessEnv = process.env,
): ApiConfig {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const fields = [
      ...new Set(
        result.error.issues.map(
          (issue) => issue.path.join('.') || 'environment',
        ),
      ),
    ].join(', ');
    throw new Error(`Invalid API environment configuration: ${fields}`);
  }
  return result.data;
}
