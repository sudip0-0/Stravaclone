import nodemailer from 'nodemailer';
import postgres from 'postgres';
import type { ApiConfig } from '../config.js';
import { ApplicationError } from '../http/application-error.js';
import { createIdentityProviders } from './identity.js';
import type { DependencyStatus, EmailMessage, Providers } from './ports.js';
import { createS3CompatibleObjectStorage } from './s3-compatible.js';

export function createLocalProviders(config: ApiConfig): Providers {
  const sql = postgres(config.DATABASE_URL, {
    connect_timeout: Math.max(
      1,
      Math.ceil(config.READINESS_TIMEOUT_MS / 1_000),
    ),
    max: 4,
  });
  const objectStorage = createS3CompatibleObjectStorage({
    endpoint: config.OBJECT_STORAGE_ENDPOINT,
    port: config.OBJECT_STORAGE_PORT,
    useSsl: config.OBJECT_STORAGE_USE_SSL,
    accessKey: config.OBJECT_STORAGE_ACCESS_KEY,
    secretKey: config.OBJECT_STORAGE_SECRET_KEY,
    bucket: config.OBJECT_STORAGE_BUCKET,
  });
  const mailer =
    config.EMAIL_MODE === 'smtp'
      ? nodemailer.createTransport({
          host: config.SMTP_HOST!,
          port: config.SMTP_PORT!,
          secure: config.SMTP_SECURE,
          requireTLS: config.SMTP_REQUIRE_TLS,
          connectionTimeout: config.READINESS_TIMEOUT_MS,
          greetingTimeout: config.READINESS_TIMEOUT_MS,
          socketTimeout: config.READINESS_TIMEOUT_MS,
          ...(config.SMTP_USER && config.SMTP_PASSWORD
            ? {
                auth: {
                  user: config.SMTP_USER,
                  pass: config.SMTP_PASSWORD,
                },
              }
            : {}),
        })
      : undefined;

  return {
    database: {
      sql,
      async checkHealth(): Promise<DependencyStatus> {
        try {
          await sql`select 1`;
          return 'up';
        } catch {
          return 'down';
        }
      },
    },
    identity: createIdentityProviders(config),
    objectStorage,
    email: {
      enabled: mailer !== undefined,
      async checkHealth(): Promise<DependencyStatus> {
        if (!mailer) return 'disabled';
        try {
          await mailer.verify();
          return 'up';
        } catch {
          return 'down';
        }
      },
      async send(message: EmailMessage): Promise<void> {
        if (!mailer || !config.SMTP_FROM) {
          throw new ApplicationError({
            code: 'service_unavailable',
            statusCode: 503,
            publicMessage: 'Email is unavailable',
          });
        }
        await mailer.sendMail({ ...message, from: config.SMTP_FROM });
      },
    },
    mapStyle: { styleUrl: config.MAP_STYLE_URL },
    elevation: {
      async getElevations({ points }) {
        return { elevationsM: points.map(() => null) };
      },
    },
    routing: {
      async route(): Promise<never> {
        throw new ApplicationError({
          code: 'service_unavailable',
          statusCode: 503,
          publicMessage: 'Routing is unavailable',
        });
      },
    },
    telemetry: {
      captureException(): void {
        // External error reporting remains disabled until scrub rules are provider-tested.
      },
    },
    async close(): Promise<void> {
      mailer?.close();
      await sql.end({ timeout: 5 });
    },
  };
}
