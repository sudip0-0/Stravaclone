import { z } from 'zod';

export const errorCodeSchema = z.enum([
  'internal_error',
  'invalid_request',
  'invalid_credentials',
  'step_up_required',
  'step_up_failed',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'idempotency_conflict',
  'activity_too_long',
  'too_many_points',
  'save_threshold_not_met',
  'too_many_photos',
  'photo_too_large',
  'unsupported_media_type',
  'rate_limited',
  'provider_unavailable',
  'account_link_required',
  'service_unavailable',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const fieldErrorSchema = z.strictObject({
  path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
  code: z.string().min(1).max(64),
  message: z.string().min(1).max(500),
});

export const errorEnvelopeSchema = z.strictObject({
  error: z.strictObject({
    code: errorCodeSchema,
    message: z.string().min(1).max(500),
    details: z.array(fieldErrorSchema).max(100).optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
