import { z } from 'zod';
import { utcDateTimeSchema, uuidSchema } from './common.js';

export const authProviderSchema = z.enum(['password', 'apple', 'google']);
export type AuthProvider = z.infer<typeof authProviderSchema>;

export const emailSchema = z
  .email()
  .max(320)
  .transform((email) => email.toLowerCase());
export const passwordSchema = z.string().min(8).max(256);

export const registerRequestSchema = z.strictObject({
  email: emailSchema,
  password: passwordSchema,
  display_name: z.string().trim().min(1).max(100),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const registerConfirmRequestSchema = z.strictObject({
  token: z.string().min(32).max(4096),
  device_hint: z.string().trim().min(1).max(200).optional(),
});
export type RegisterConfirmRequest = z.infer<
  typeof registerConfirmRequestSchema
>;

export const loginRequestSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1).max(256),
  device_hint: z.string().trim().min(1).max(200).optional(),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const identityLoginRequestSchema = z.strictObject({
  identity_token: z.string().min(1).max(16_384),
  nonce: z.string().min(16).max(512),
  device_hint: z.string().trim().min(1).max(200).optional(),
});
export type IdentityLoginRequest = z.infer<typeof identityLoginRequestSchema>;

export const sessionTokensSchema = z.strictObject({
  access_token: z.string().min(1),
  access_token_expires_at: utcDateTimeSchema,
  refresh_token: z.string().min(1),
  refresh_token_expires_at: utcDateTimeSchema,
  token_type: z.literal('Bearer'),
});
export type SessionTokens = z.infer<typeof sessionTokensSchema>;

export const authResponseSchema = z.strictObject({
  user_id: uuidSchema,
  session: sessionTokensSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

export const refreshSessionRequestSchema = z.strictObject({
  refresh_token: z.string().min(1).max(4096),
  rotation_request_id: uuidSchema,
});
export const logoutRequestSchema = z.strictObject({
  refresh_token: z.string().min(1).max(4096),
});

export const passwordResetRequestSchema = z.strictObject({
  email: emailSchema,
});
export type PasswordResetRequest = z.infer<typeof passwordResetRequestSchema>;

export const passwordResetConfirmSchema = z.strictObject({
  token: z.string().min(32).max(4096),
  password: passwordSchema,
});
export type PasswordResetConfirm = z.infer<typeof passwordResetConfirmSchema>;

export const identityLinkRequestSchema = identityLoginRequestSchema;
export type IdentityLinkRequest = z.infer<typeof identityLinkRequestSchema>;

export const acceptedResponseSchema = z.strictObject({
  accepted: z.literal(true),
});
export type AcceptedResponse = z.infer<typeof acceptedResponseSchema>;

export const linkedIdentitySchema = z.strictObject({
  id: uuidSchema,
  provider: authProviderSchema,
  created_at: utcDateTimeSchema,
});
export type LinkedIdentity = z.infer<typeof linkedIdentitySchema>;
