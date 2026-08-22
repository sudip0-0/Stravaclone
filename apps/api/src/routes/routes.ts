import {
  createRouteRequestSchema,
  cursorPaginationQuerySchema,
  updateRouteRequestSchema,
  uuidSchema,
} from '@trail/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, ownerId } from '../auth/middleware.js';
import type { ApiConfig } from '../config.js';
import { ApplicationError } from '../http/application-error.js';
import type { Providers } from '../providers/ports.js';
import {
  createRoute,
  deleteRoute,
  getRoute,
  listRoutes,
  updateRoute,
} from './service.js';

const paramsSchema = z.strictObject({ id: uuidSchema });
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ApplicationError({
      statusCode: 400,
      code: 'invalid_request',
      publicMessage: 'Request validation failed',
    });
  return result.data;
}

export function registerRouteRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  providers: Providers,
): void {
  const database = providers.database.sql;
  if (!database) return;
  const auth = authenticate(config, providers);
  app.post('/v1/routes', { onRequest: auth }, async (request, reply) => {
    const result = await createRoute(
      database,
      ownerId(request),
      parse(createRouteRequestSchema, request.body),
    );
    void reply.code(result.created ? 201 : 200);
    return result.route;
  });
  app.get('/v1/routes', { onRequest: auth }, async (request) => {
    const query = parse(cursorPaginationQuerySchema, request.query);
    return listRoutes(database, ownerId(request), query.limit, query.cursor);
  });
  app.get('/v1/routes/:id', { onRequest: auth }, async (request) =>
    getRoute(
      database,
      ownerId(request),
      parse(paramsSchema, request.params).id,
    ),
  );
  app.patch('/v1/routes/:id', { onRequest: auth }, async (request) =>
    updateRoute(
      database,
      ownerId(request),
      parse(paramsSchema, request.params).id,
      parse(updateRouteRequestSchema, request.body),
    ),
  );
  app.delete('/v1/routes/:id', { onRequest: auth }, async (request, reply) => {
    await deleteRoute(
      database,
      ownerId(request),
      parse(paramsSchema, request.params).id,
    );
    void reply.code(204).send();
  });
}
