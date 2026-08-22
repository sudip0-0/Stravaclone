import { z } from 'zod';
import {
  latitudeSchema,
  longitudeSchema,
  utcDateTimeSchema,
  uuidSchema,
} from './common.js';
import {
  MAX_ACTIVITY_PHOTOS,
  MAX_PHOTO_INPUT_BYTES,
  MAX_PHOTO_OUTPUT_BYTES,
} from './limits.js';

export const photoInputMimeSchema = z.enum([
  'image/jpeg',
  'image/heic',
  'image/webp',
]);
export const photoOutputMimeSchema = z.enum(['image/jpeg', 'image/webp']);
export const photoStatusSchema = z.enum([
  'pending',
  'processing',
  'ready',
  'failed',
]);

function hasCoordinatePair(value: {
  readonly latitude?: number | null | undefined;
  readonly longitude?: number | null | undefined;
}): boolean {
  return (value.latitude == null) === (value.longitude == null);
}

export const initiatePhotoUploadRequestSchema = z
  .strictObject({
    input_mime: photoInputMimeSchema,
    input_size_bytes: z.number().int().positive().max(MAX_PHOTO_INPUT_BYTES),
    user_approved_captured_at: utcDateTimeSchema.nullable().optional(),
    user_approved_latitude: latitudeSchema.nullable().optional(),
    user_approved_longitude: longitudeSchema.nullable().optional(),
  })
  .refine(
    (value) =>
      hasCoordinatePair({
        latitude: value.user_approved_latitude,
        longitude: value.user_approved_longitude,
      }),
    {
      path: ['user_approved_longitude'],
      message: 'approved latitude and longitude must both be present or absent',
    },
  );
export type InitiatePhotoUploadRequest = z.infer<
  typeof initiatePhotoUploadRequestSchema
>;

export const signedPhotoUploadSchema = z.strictObject({
  photo_id: uuidSchema,
  status: z.literal('pending'),
  upload_url: z.url(),
  expires_at: utcDateTimeSchema,
  form_fields: z.record(z.string(), z.string()),
});
export type SignedPhotoUpload = z.infer<typeof signedPhotoUploadSchema>;

export const photoCompleteResponseSchema = z.strictObject({
  photo_id: uuidSchema,
  status: photoStatusSchema,
});
export type PhotoCompleteResponse = z.infer<typeof photoCompleteResponseSchema>;

export const activityPhotoSchema = z
  .strictObject({
    id: uuidSchema,
    activity_id: uuidSchema,
    status: photoStatusSchema,
    mime: photoOutputMimeSchema.nullable(),
    size_bytes: z
      .number()
      .int()
      .positive()
      .max(MAX_PHOTO_OUTPUT_BYTES)
      .nullable(),
    width: z.number().int().positive().max(4096).nullable(),
    height: z.number().int().positive().max(4096).nullable(),
    user_approved_latitude: latitudeSchema.nullable(),
    user_approved_longitude: longitudeSchema.nullable(),
    user_approved_captured_at: utcDateTimeSchema.nullable(),
    sort_order: z
      .number()
      .int()
      .min(0)
      .max(MAX_ACTIVITY_PHOTOS - 1),
    error_code: z.string().min(1).max(64).nullable(),
    download_url: z.url().nullable(),
    download_expires_at: utcDateTimeSchema.nullable(),
  })
  .refine(
    (value) =>
      hasCoordinatePair({
        latitude: value.user_approved_latitude,
        longitude: value.user_approved_longitude,
      }),
    {
      path: ['user_approved_longitude'],
      message: 'approved latitude and longitude must both be present or absent',
    },
  );
export type ActivityPhoto = z.infer<typeof activityPhotoSchema>;

export const activityPhotosSchema = z
  .array(activityPhotoSchema)
  .max(MAX_ACTIVITY_PHOTOS);

export const signedPhotoDownloadSchema = z.strictObject({
  download_url: z.url(),
  expires_at: utcDateTimeSchema,
});
export type SignedPhotoDownload = z.infer<typeof signedPhotoDownloadSchema>;
