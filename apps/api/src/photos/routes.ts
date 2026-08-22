import { initiatePhotoUploadRequestSchema, uuidSchema } from '@trail/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, ownerId } from '../auth/middleware.js';
import type { ApiConfig } from '../config.js';
import { ApplicationError } from '../http/application-error.js';
import type { Providers } from '../providers/ports.js';
import {
  completePhotoUpload,
  deletePhoto,
  initiatePhotoUpload,
  listPhotos,
  reissuePhotoUpload,
  signPhotoDownload,
} from './service.js';

const activityParamsSchema = z.strictObject({ activity_id: uuidSchema });
const photoParamsSchema = z.strictObject({
  activity_id: uuidSchema,
  photo_id: uuidSchema,
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new ApplicationError({
      code: 'invalid_request',
      statusCode: 400,
      publicMessage: 'Request validation failed',
    });
  return parsed.data;
}

export function registerPhotoRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  providers: Providers,
): void {
  const sql = providers.database.sql;
  if (!sql) return;
  const auth = authenticate(config, providers);

  app.post(
    '/v1/activities/:activity_id/photos/initiate',
    { onRequest: auth },
    async (request, reply) => {
      const { activity_id: activityId } = parse(
        activityParamsSchema,
        request.params,
      );
      const input = parse(initiatePhotoUploadRequestSchema, request.body);
      const result = await initiatePhotoUpload(
        sql,
        providers.objectStorage,
        ownerId(request),
        activityId,
        input,
      );
      void reply.code(201);
      return result;
    },
  );

  app.post(
    '/v1/activities/:activity_id/photos/:photo_id/reissue',
    { onRequest: auth },
    async (request) => {
      const { activity_id: activityId, photo_id: photoId } = parse(
        photoParamsSchema,
        request.params,
      );
      return reissuePhotoUpload(
        sql,
        providers.objectStorage,
        ownerId(request),
        activityId,
        photoId,
      );
    },
  );

  app.post(
    '/v1/activities/:activity_id/photos/:photo_id/complete',
    { onRequest: auth },
    async (request, reply) => {
      const { activity_id: activityId, photo_id: photoId } = parse(
        photoParamsSchema,
        request.params,
      );
      const result = await completePhotoUpload(
        sql,
        providers.objectStorage,
        ownerId(request),
        activityId,
        photoId,
      );
      void reply.code(result.status === 'ready' ? 200 : 202);
      return result;
    },
  );

  app.get(
    '/v1/activities/:activity_id/photos',
    { onRequest: auth },
    async (request) => {
      const { activity_id: activityId } = parse(
        activityParamsSchema,
        request.params,
      );
      return listPhotos(
        sql,
        providers.objectStorage,
        ownerId(request),
        activityId,
      );
    },
  );

  app.get(
    '/v1/activities/:activity_id/photos/:photo_id/download',
    { onRequest: auth },
    async (request) => {
      const { activity_id: activityId, photo_id: photoId } = parse(
        photoParamsSchema,
        request.params,
      );
      return signPhotoDownload(
        sql,
        providers.objectStorage,
        ownerId(request),
        activityId,
        photoId,
      );
    },
  );

  app.delete(
    '/v1/activities/:activity_id/photos/:photo_id',
    { onRequest: auth },
    async (request, reply) => {
      const { activity_id: activityId, photo_id: photoId } = parse(
        photoParamsSchema,
        request.params,
      );
      await deletePhoto(sql, ownerId(request), activityId, photoId);
      void reply.code(204).send();
    },
  );
}
