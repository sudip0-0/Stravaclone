import {
  deleteUserRequestSchema,
  loginRequestSchema,
  logoutRequestSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  refreshSessionRequestSchema,
  registerConfirmRequestSchema,
  registerRequestSchema,
  updateUserRequestSchema,
} from '@trail/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';
import type { ApiConfig } from '../config.js';
import { ApplicationError } from '../http/application-error.js';
import type { Providers } from '../providers/ports.js';
import { hashOpaqueToken } from './crypto.js';
import { authenticate, ownerId, principalAuthVersion } from './middleware.js';
import {
  confirmPasswordReset,
  confirmRegistration,
  deleteUser,
  getUser,
  login,
  logout,
  refreshSession,
  requestPasswordReset,
  requestRegistration,
  updateUser,
} from './service.js';

interface RateEntry {
  count: number;
  resetAt: number;
}

function body<T>(schema: ZodType<T>, request: FastifyRequest): T {
  const result = schema.safeParse(request.body);
  if (!result.success) {
    throw new ApplicationError({
      code: 'invalid_request',
      statusCode: 400,
      publicMessage: 'Request validation failed',
    });
  }
  return result.data;
}

function bodyField(request: FastifyRequest, field: string): string {
  if (typeof request.body !== 'object' || request.body === null) return '';
  const value = (request.body as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : '';
}

function rateLimited(): ApplicationError {
  return new ApplicationError({
    code: 'rate_limited',
    statusCode: 429,
    publicMessage: 'Too many requests',
  });
}

function boundedRateLimit(
  max: number,
  windowMs: number,
  key: (request: FastifyRequest) => string,
  maximumEntries = 10_000,
) {
  const entries = new Map<string, RateEntry>();
  return async (request: FastifyRequest): Promise<void> => {
    const now = Date.now();
    const rateKey = key(request);
    const existing = entries.get(rateKey);
    if (!existing || existing.resetAt <= now) {
      if (entries.size >= maximumEntries) {
        for (const [candidate, entry] of entries) {
          if (entry.resetAt <= now || entries.size >= maximumEntries) {
            entries.delete(candidate);
          }
          if (entries.size < maximumEntries) break;
        }
      }
      entries.set(rateKey, { count: 1, resetAt: now + windowMs });
      return;
    }
    existing.count += 1;
    if (existing.count > max) throw rateLimited();
  };
}

function emailKey(request: FastifyRequest): string {
  return hashOpaqueToken(bodyField(request, 'email').trim().toLowerCase());
}

function refreshTokenKey(request: FastifyRequest): string {
  return hashOpaqueToken(bodyField(request, 'refresh_token'));
}

function verificationTokenKey(request: FastifyRequest): string {
  return hashOpaqueToken(bodyField(request, 'token'));
}

export function registerAuthRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  providers: Providers,
): void {
  const authenticateRequest = authenticate(config, providers);
  const credentialWindow = 15 * 60 * 1000;
  const ipKey = (request: FastifyRequest) => request.ip;
  const userKey = (request: FastifyRequest) => ownerId(request);

  const registerIp = boundedRateLimit(20, credentialWindow, ipKey);
  const registerEmail = boundedRateLimit(5, credentialWindow, emailKey);
  const loginIp = boundedRateLimit(50, credentialWindow, ipKey);
  const loginEmail = boundedRateLimit(10, credentialWindow, emailKey);
  const registrationConfirmIp = boundedRateLimit(30, credentialWindow, ipKey);
  const registrationConfirmToken = boundedRateLimit(
    10,
    credentialWindow,
    verificationTokenKey,
  );
  const refreshIp = boundedRateLimit(300, 60_000, ipKey);
  const refreshToken = boundedRateLimit(120, 60_000, refreshTokenKey);
  const logoutIp = boundedRateLimit(60, 60_000, ipKey);
  const logoutToken = boundedRateLimit(30, 60_000, refreshTokenKey);
  const resetRequestIp = boundedRateLimit(20, credentialWindow, ipKey);
  const resetRequestEmail = boundedRateLimit(5, credentialWindow, emailKey);
  const resetConfirmIp = boundedRateLimit(30, credentialWindow, ipKey);
  const resetConfirmToken = boundedRateLimit(
    10,
    credentialWindow,
    verificationTokenKey,
  );
  const deletionIp = boundedRateLimit(10, credentialWindow, ipKey);
  const deletionUser = boundedRateLimit(5, credentialWindow, userKey);

  app.post(
    '/v1/auth/register',
    { preHandler: [registerIp, registerEmail] },
    async (request, reply) => {
      await requestRegistration(
        providers,
        config,
        body(registerRequestSchema, request),
      );
      void reply.code(202);
      return { accepted: true as const };
    },
  );
  app.post(
    '/v1/auth/register/confirm',
    { preHandler: [registrationConfirmIp, registrationConfirmToken] },
    async (request) =>
      confirmRegistration(
        providers,
        config,
        body(registerConfirmRequestSchema, request),
      ),
  );
  app.post(
    '/v1/auth/login',
    { preHandler: [loginIp, loginEmail] },
    async (request) =>
      login(providers, config, body(loginRequestSchema, request)),
  );
  app.post(
    '/v1/auth/refresh',
    { preHandler: [refreshIp, refreshToken] },
    async (request) => {
      const input = body(refreshSessionRequestSchema, request);
      return refreshSession(
        providers,
        config,
        input.refresh_token,
        input.rotation_request_id,
      );
    },
  );
  app.post(
    '/v1/auth/logout',
    { preHandler: [logoutIp, logoutToken] },
    async (request, reply) => {
      const input = body(logoutRequestSchema, request);
      await logout(providers, input.refresh_token);
      void reply.code(204);
    },
  );
  app.post(
    '/v1/auth/password-reset/request',
    { preHandler: [resetRequestIp, resetRequestEmail] },
    async (request, reply) => {
      const input = body(passwordResetRequestSchema, request);
      await requestPasswordReset(providers, config, input.email);
      void reply.code(202);
      return { accepted: true as const };
    },
  );
  app.post(
    '/v1/auth/password-reset/confirm',
    { preHandler: [resetConfirmIp, resetConfirmToken] },
    async (request, reply) => {
      const input = body(passwordResetConfirmSchema, request);
      await confirmPasswordReset(providers, input.token, input.password);
      void reply.code(204);
    },
  );

  app.get('/v1/me', { preHandler: authenticateRequest }, async (request) =>
    getUser(providers, ownerId(request)),
  );
  app.patch('/v1/me', { preHandler: authenticateRequest }, async (request) =>
    updateUser(
      providers,
      ownerId(request),
      body(updateUserRequestSchema, request),
    ),
  );
  app.delete(
    '/v1/me',
    {
      preHandler: [authenticateRequest, deletionIp, deletionUser],
    },
    async (request, reply) => {
      const input = body(deleteUserRequestSchema, request);
      await deleteUser(
        providers,
        ownerId(request),
        principalAuthVersion(request),
        input.password,
      );
      void reply.code(204);
    },
  );
}
