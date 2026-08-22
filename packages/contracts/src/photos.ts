import { z } from 'zod';
import {
  latitudeSchema,
  longitudeSchema,
  utcDateTimeSchema,
  uuidSchema,
} from './common.js';
import { MAX_ACTIVITY_PHOTOS, MAX_PHOTO_INPUT_BYTES } from './limits.js';

export const photoContentTypeSchema = z.enum([
  'image/jpeg',
  'image/heic',
  'image/webp',
]);
export const photoUploadStatusSchema = z.enum([
  'pending',
  'uploading',
  'ready',
  'failed',
]);

function hasCoordinatePair(value: {
  readonly latitude?: number | null | undefined;
  readonly longitude?: number | null | undefined;
}): boolean {
  return (value.latitude == null) === (value.longitude == null);
}

export const photoUploadRequestSchema = z
  .strictObject({
    content_type: photoContentTypeSchema,
    size_bytes: z.number().int().positive().max(MAX_PHOTO_INPUT_BYTES),
    captured_at: utcDateTimeSchema.nullable().optional(),
    latitude: latitudeSchema.nullable().optional(),
    longitude: longitudeSchema.nullable().optional(),
  })
  .refine(hasCoordinatePair, {
    path: ['longitude'],
    message: 'latitude and longitude must both be present or both be absent',
  });
export type PhotoUploadRequest = z.infer<typeof photoUploadRequestSchema>;

export const signedPhotoUploadSchema = z.strictObject({
  photo_id: uuidSchema,
  upload_url: z.url(),
  expires_at: utcDateTimeSchema,
  required_headers: z.record(z.string(), z.string()),
});

export const activityPhotoSchema = z
  .strictObject({
    id: uuidSchema,
    activity_id: uuidSchema,
    status: photoUploadStatusSchema,
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    latitude: latitudeSchema.nullable(),
    longitude: longitudeSchema.nullable(),
    captured_at: utcDateTimeSchema.nullable(),
    sort_order: z
      .number()
      .int()
      .min(0)
      .max(MAX_ACTIVITY_PHOTOS - 1),
    download_url: z.url().nullable(),
  })
  .refine(hasCoordinatePair, {
    path: ['longitude'],
    message: 'latitude and longitude must both be present or both be absent',
  });
export type ActivityPhoto = z.infer<typeof activityPhotoSchema>;

export const activityPhotosSchema = z
  .array(activityPhotoSchema)
  .max(MAX_ACTIVITY_PHOTOS);
