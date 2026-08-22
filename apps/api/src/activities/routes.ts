import {
  createActivityRequestSchema,
  cursorPaginationQuerySchema,
  deleteActivityQuerySchema,
  updateActivityRequestSchema,
  uuidSchema,
} from '@trail/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate, ownerId } from '../auth/middleware.js';
import type { ApiConfig } from '../config.js';
import { ApplicationError } from '../http/application-error.js';
import type { Providers } from '../providers/ports.js';
import {
  createActivity,
  deleteActivity,
  getActivity,
  listActivities,
  updateActivity,
} from './service.js';

function invalidRequest(message = 'Request validation failed') {
  return new ApplicationError({
    code: 'invalid_request',
    statusCode: 400,
    publicMessage: message,
  });
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw invalidRequest();
  return parsed.data;
}
const paramsSchema = z.strictObject({ id: uuidSchema });

export function registerActivityRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  providers: Providers,
): void {
  const auth = authenticate(config, providers);
  const requestsByIp = new Map<string, number[]>();
  const activeByOwner = new Map<string, number>();
  const guardCreate = async (request: FastifyRequest, reply: FastifyReply) => {
    const now = Date.now();
    if (requestsByIp.size >= 1_000) {
      for (const [ip, timestamps] of requestsByIp) {
        const live = timestamps.filter((timestamp) => timestamp > now - 60_000);
        if (live.length === 0) requestsByIp.delete(ip);
        else requestsByIp.set(ip, live);
      }
      if (requestsByIp.size >= 1_000) {
        const oldestKey = requestsByIp.keys().next().value;
        if (oldestKey) requestsByIp.delete(oldestKey);
      }
    }
    const recent = (requestsByIp.get(request.ip) ?? []).filter(
      (timestamp) => timestamp > now - 60_000,
    );
    if (recent.length >= 30)
      throw new ApplicationError({
        code: 'rate_limited',
        statusCode: 429,
        publicMessage: 'Too many activity uploads',
      });
    recent.push(now);
    requestsByIp.set(request.ip, recent);
    const ownerUserId = ownerId(request);
    const active = activeByOwner.get(ownerUserId) ?? 0;
    if (active >= 2)
      throw new ApplicationError({
        code: 'rate_limited',
        statusCode: 429,
        publicMessage: 'Too many concurrent activity uploads',
      });
    activeByOwner.set(ownerUserId, active + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const remaining = (activeByOwner.get(ownerUserId) ?? 1) - 1;
      if (remaining <= 0) activeByOwner.delete(ownerUserId);
      else activeByOwner.set(ownerUserId, remaining);
    };
    reply.raw.once('finish', release);
    reply.raw.once('close', release);
  };
  const database = providers.database.sql;
  if (!database) return;

  app.post(
    '/v1/activities',
    { onRequest: [auth, guardCreate], bodyLimit: 25_165_824 },
    async (request, reply) => {
      const raw = request.body as { points?: unknown } | null;
      if (raw && Array.isArray(raw.points) && raw.points.length > 100_000) {
        throw new ApplicationError({
          code: 'too_many_points',
          statusCode: 413,
          publicMessage: 'Activity exceeds the 100,000-point limit',
        });
      }
      const input = parse(createActivityRequestSchema, request.body);
      const result = await createActivity(database, ownerId(request), input);
      void reply.code(result.created ? 201 : 200);
      return result.activity;
    },
  );
  app.get('/v1/activities', { onRequest: auth }, async (request) => {
    const query = parse(cursorPaginationQuerySchema, request.query);
    return listActivities(
      database,
      ownerId(request),
      query.limit,
      query.cursor,
    );
  });
  app.get('/v1/activities/:id', { onRequest: auth }, async (request) => {
    const { id } = parse(paramsSchema, request.params);
    return getActivity(database, ownerId(request), id);
  });
  app.patch('/v1/activities/:id', { onRequest: auth }, async (request) => {
    const { id } = parse(paramsSchema, request.params);
    const patch = parse(updateActivityRequestSchema, request.body);
    return updateActivity(database, ownerId(request), id, patch);
  });
  app.delete(
    '/v1/activities/:id',
    { onRequest: auth },
    async (request, reply) => {
      const { id } = parse(paramsSchema, request.params);
      parse(deleteActivityQuerySchema, request.query);
      await deleteActivity(database, ownerId(request), id);
      void reply.code(204).send();
    },
  );
}
