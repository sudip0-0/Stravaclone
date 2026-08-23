import { randomUUID } from 'node:crypto';
import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';
import type { ErrorCode, ErrorEnvelope } from '@trail/contracts';
import { registerActivityRoutes } from './activities/routes.js';
import { registerAuthRoutes } from './auth/routes.js';
import type { ApiConfig } from './config.js';
import { ApplicationError } from './http/application-error.js';
import { registerPhotoRoutes } from './photos/routes.js';
import type { DependencyStatus, Providers } from './providers/ports.js';
import { registerRouteRoutes } from './routes/routes.js';
import { registerStatsRoutes } from './stats/routes.js';
import {
  setActiveHttpRouteTemplate,
  unmatchedHttpRouteTemplate,
} from './telemetry/privacy.js';

export interface BuildAppOptions {
  readonly config: ApiConfig;
  readonly providers: Providers;
  readonly logger?: FastifyServerOptions['logger'];
  readonly onRouteRegistered?: (route: {
    readonly method: string | readonly string[];
    readonly url: string;
    readonly hasPrincipalGuard: boolean;
  }) => void;
}

const trustedRequestIdPattern = /^[A-Za-z0-9._-]{1,64}$/;

export function serializeRequest(request: {
  readonly id: string | undefined;
  readonly method: string | undefined;
  readonly routeOptions: { readonly url: string | undefined } | undefined;
  readonly url: string | undefined;
}): Record<string, string> {
  return {
    method: request.method ?? 'UNKNOWN',
    requestId:
      request.id && trustedRequestIdPattern.test(request.id)
        ? request.id
        : 'invalid-request-id',
    route: request.routeOptions?.url ?? 'unmatched-route',
  };
}

export function createLoggerOptions(
  config: ApiConfig,
): Exclude<FastifyServerOptions['logger'], boolean | undefined> {
  return {
    level: config.LOG_LEVEL,
    serializers: { req: serializeRequest },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.password',
        'req.body.token',
        'req.body.refresh_token',
        'req.body.rotation_request_id',
        'req.body.identity_token',
        'req.body.signed_url',
        'req.body.upload_url',
        'req.body.download_url',
        'req.body.form_fields',
        'req.body.points',
        'req.body.gps',
        'req.body.exif',
        'req.body.metadata',
        'res.headers["set-cookie"]',
        'authorization',
        'cookie',
        'password',
        'token',
        'refresh_token',
        'rotation_request_id',
        'identity_token',
        'token_hash',
        'ciphertext',
        'payload_ciphertext',
        'successor_ciphertext',
        'iv',
        'payload_iv',
        'successor_iv',
        'tag',
        'payload_tag',
        'successor_tag',
        'password_hash',
        'points',
        'gps',
        'gps_points',
        'track',
        'coordinates',
        'latitude',
        'longitude',
        'capture_latitude',
        'capture_longitude',
        'exif',
        'metadata',
        'signed_url',
        'upload_url',
        'download_url',
        'form_fields',
        'signed_post_fields',
        'provider_token',
        'access_token',
        'smtp_password',
        'jwt_signing_key',
        'email_outbox_key',
        'refresh_recovery_key',
        'object_storage_secret_key',
      ],
      censor: '[REDACTED]',
    },
  };
}

function errorEnvelope(code: ErrorCode, message: string): ErrorEnvelope {
  return { error: { code, message } };
}

function httpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) {
    return undefined;
  }
  return typeof error.statusCode === 'number' ? error.statusCode : undefined;
}

function isValidationError(error: unknown): error is { validation: unknown } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'validation' in error &&
    error.validation !== undefined
  );
}

function createDeduplicatedProbe(
  check: () => Promise<DependencyStatus>,
): () => Promise<DependencyStatus> {
  let operation: Promise<DependencyStatus> | undefined;
  return () => {
    if (!operation) {
      operation = check().finally(() => {
        operation = undefined;
      });
    }
    return operation;
  };
}

async function boundedHealthCheck(
  check: () => Promise<DependencyStatus>,
  timeoutMs: number,
): Promise<DependencyStatus> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      check().catch(() => 'down' as const),
      new Promise<'down'>((resolve) => {
        timer = setTimeout(() => resolve('down'), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const logger = options.logger ?? createLoggerOptions(options.config);
  const app = Fastify({
    disableRequestLogging: options.config.NODE_ENV === 'test',
    genReqId: (request) => {
      const supplied = request.headers['x-request-id'];
      return typeof supplied === 'string' &&
        trustedRequestIdPattern.test(supplied)
        ? supplied
        : randomUUID();
    },
    logger,
    bodyLimit: options.config.BODY_LIMIT_BYTES,
    trustProxy:
      options.config.TRUST_PROXY_HOPS === 0
        ? false
        : options.config.TRUST_PROXY_HOPS,
  });
  if (options.onRouteRegistered) {
    app.addHook('onRoute', (route) => {
      const hooks = [route.onRequest, route.preHandler].flatMap((hook) =>
        Array.isArray(hook) ? hook : hook ? [hook] : [],
      );
      options.onRouteRegistered?.({
        method: route.method,
        url: route.url,
        hasPrincipalGuard: hooks.some(
          (hook) => hook.name === 'authenticateAccessToken',
        ),
      });
    });
  }
  registerAuthRoutes(app, options.config, options.providers);
  registerActivityRoutes(app, options.config, options.providers);
  registerPhotoRoutes(app, options.config, options.providers);
  registerRouteRoutes(app, options.config, options.providers);
  registerStatsRoutes(app, options.config, options.providers);
  let readinessCache:
    | { readonly checkedAt: number; readonly ready: boolean }
    | undefined;
  let readinessInFlight: Promise<boolean> | undefined;
  const databaseProbe = createDeduplicatedProbe(() =>
    options.providers.database.checkHealth(),
  );
  const objectStorageProbe = createDeduplicatedProbe(() =>
    options.providers.objectStorage.checkHealth(),
  );
  const emailProbe = createDeduplicatedProbe(() =>
    options.providers.email.checkHealth(),
  );

  async function checkReadiness(): Promise<boolean> {
    const now = Date.now();
    if (
      readinessCache &&
      now - readinessCache.checkedAt <= options.config.READINESS_CACHE_MS
    ) {
      return readinessCache.ready;
    }
    if (readinessInFlight) return readinessInFlight;

    readinessInFlight = (async () => {
      const checks = [
        boundedHealthCheck(databaseProbe, options.config.READINESS_TIMEOUT_MS),
        boundedHealthCheck(
          objectStorageProbe,
          options.config.READINESS_TIMEOUT_MS,
        ),
      ];
      if (options.providers.email.enabled) {
        checks.push(
          boundedHealthCheck(emailProbe, options.config.READINESS_TIMEOUT_MS),
        );
      }
      const statuses = await Promise.all(checks);
      const ready = statuses.every(
        (status) => status === 'up' || status === 'disabled',
      );
      readinessCache = { checkedAt: Date.now(), ready };
      return ready;
    })();

    try {
      return await readinessInFlight;
    } finally {
      readinessInFlight = undefined;
    }
  }

  app.addHook('onRequest', async (request, reply) => {
    setActiveHttpRouteTemplate(
      request.routeOptions.url ?? unmatchedHttpRouteTemplate,
    );
    void reply.header('x-request-id', request.id);
  });

  app.get('/health', async () => ({ status: 'ok' as const }));

  app.get('/ready', async (_request, reply) => {
    const ready = await checkReadiness();
    if (!ready) void reply.code(503);
    return { status: ready ? ('ready' as const) : ('not_ready' as const) };
  });

  app.setNotFoundHandler(async (_request, reply) => {
    void reply.code(404);
    return errorEnvelope('not_found', 'Route not found');
  });

  app.setErrorHandler(async (error, request, reply) => {
    let statusCode = 500;
    let code: ErrorCode = 'internal_error';
    let message = 'An unexpected error occurred';

    if (error instanceof ApplicationError) {
      statusCode = error.statusCode;
      code = error.code;
      message = error.publicMessage;
    } else if (httpStatus(error) === 429) {
      statusCode = 429;
      code = 'rate_limited';
      message = 'Too many requests';
    } else if (httpStatus(error) === 413 || isValidationError(error)) {
      statusCode = httpStatus(error) === 413 ? 413 : 400;
      code = 'invalid_request';
      message = 'Request validation failed';
    }

    if (statusCode >= 500) {
      request.log.error(
        {
          code,
          internalCode:
            typeof error === 'object' && error !== null && 'code' in error
              ? error.code
              : undefined,
          constraint:
            typeof error === 'object' &&
            error !== null &&
            'constraint_name' in error
              ? error.constraint_name
              : undefined,
        },
        'Request failed',
      );
      options.providers.telemetry.captureException({
        code,
        requestId: request.id,
      });
    }
    void reply.code(statusCode);
    return errorEnvelope(code, message);
  });

  app.addHook('onClose', async () => options.providers.close());
  return app;
}
