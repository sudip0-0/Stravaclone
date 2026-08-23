import type { FastifyRequest } from 'fastify';
import type { ApiConfig } from '../config.js';
import { ApplicationError } from '../http/application-error.js';
import type { Providers } from '../providers/ports.js';
import { verifyAccessToken, type AccessPrincipal } from './crypto.js';

declare module 'fastify' {
  interface FastifyRequest {
    authPrincipal?: AccessPrincipal;
    ownerContext?: { readonly userId: string };
  }
}

function unauthorized(): ApplicationError {
  return new ApplicationError({
    code: 'unauthorized',
    statusCode: 401,
    publicMessage: 'Authentication required',
  });
}

export function authenticate(config: ApiConfig, providers: Providers) {
  return async function authenticateAccessToken(
    request: FastifyRequest,
  ): Promise<void> {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ') || authorization.length <= 7) {
      throw unauthorized();
    }
    const principal = await verifyAccessToken(authorization.slice(7), config);
    if (!providers.database.sql) throw unauthorized();
    const rows = await providers.database.sql<{ auth_version: number }[]>`
      select auth_version from trail.users where id = ${principal.userId}
    `;
    if (!rows[0] || rows[0].auth_version !== principal.authVersion) {
      throw unauthorized();
    }
    request.authPrincipal = principal;
    request.ownerContext = { userId: principal.userId };
  };
}

export function ownerId(request: FastifyRequest): string {
  if (!request.ownerContext) throw unauthorized();
  return request.ownerContext.userId;
}

export function principalAuthVersion(request: FastifyRequest): number {
  if (!request.authPrincipal) throw unauthorized();
  return request.authPrincipal.authVersion;
}
