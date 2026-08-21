import { z } from 'zod';

export const errorCodeSchema = z.enum([
  'internal_error',
  'invalid_request',
  'not_found',
  'service_unavailable',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string().min(1),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
});

export const readinessResponseSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
});
