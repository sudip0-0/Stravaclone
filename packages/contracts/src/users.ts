import { z } from 'zod';
import { linkedIdentitySchema } from './auth.js';
import {
  sportSchema,
  unitSystemSchema,
  utcDateTimeSchema,
  uuidSchema,
} from './common.js';

export const userSchema = z.strictObject({
  id: uuidSchema,
  email: z.email().max(320).nullable(),
  display_name: z.string().min(1).max(100),
  avatar_url: z.url().max(2048).nullable(),
  units: unitSystemSchema,
  default_sport: sportSchema,
  identities: z.array(linkedIdentitySchema),
  created_at: utcDateTimeSchema,
  updated_at: utcDateTimeSchema,
});
export type User = z.infer<typeof userSchema>;

export const updateUserRequestSchema = z
  .strictObject({
    display_name: z.string().trim().min(1).max(100).optional(),
    avatar_url: z.url().max(2048).nullable().optional(),
    units: unitSystemSchema.optional(),
    default_sport: sportSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });
export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;

export const deleteUserRequestSchema = z.strictObject({
  confirmation: z.literal('DELETE'),
  password: z.string().min(1).max(256),
});
export type DeleteUserRequest = z.infer<typeof deleteUserRequestSchema>;
