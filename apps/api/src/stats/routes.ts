import {
  calendarDayQuerySchema,
  calendarQuerySchema,
  statsQuerySchema,
} from '@trail/contracts';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { authenticate, ownerId } from '../auth/middleware.js';
import type { ApiConfig } from '../config.js';
import { ApplicationError } from '../http/application-error.js';
import type { Providers } from '../providers/ports.js';
import { getCalendar, getCalendarDay, getStats } from './service.js';

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new ApplicationError({
      statusCode: 400,
      code: 'invalid_request',
      publicMessage: 'Request validation failed',
    });
  return parsed.data;
}

export function registerStatsRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  providers: Providers,
): void {
  const database = providers.database.sql;
  if (!database) return;
  const auth = authenticate(config, providers);
  app.get('/v1/stats', { onRequest: auth }, async (request) =>
    getStats(
      database,
      ownerId(request),
      parse(statsQuerySchema, request.query),
    ),
  );
  app.get('/v1/calendar', { onRequest: auth }, async (request) =>
    getCalendar(
      database,
      ownerId(request),
      parse(calendarQuerySchema, request.query),
    ),
  );
  app.get('/v1/calendar/day', { onRequest: auth }, async (request) =>
    getCalendarDay(
      database,
      ownerId(request),
      parse(calendarDayQuerySchema, request.query),
    ),
  );
}
