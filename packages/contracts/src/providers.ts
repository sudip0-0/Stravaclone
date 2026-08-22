import { z } from 'zod';

export const providerStatusSchema = z.enum([
  'available',
  'degraded',
  'unavailable',
  'not_configured',
]);
export type ProviderStatus = z.infer<typeof providerStatusSchema>;

export const providerKindSchema = z.enum([
  'database',
  'object_storage',
  'email',
  'maps',
  'elevation',
  'identity_apple',
  'identity_google',
]);

export const healthResponseSchema = z.strictObject({ status: z.literal('ok') });
export const readinessResponseSchema = z.strictObject({
  status: z.enum(['ready', 'not_ready']),
  providers: z
    .array(
      z.strictObject({
        kind: providerKindSchema,
        status: providerStatusSchema,
      }),
    )
    .optional(),
});
