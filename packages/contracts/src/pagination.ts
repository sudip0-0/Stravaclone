import { z } from 'zod';

export const cursorPaginationQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type CursorPaginationQuery = z.infer<typeof cursorPaginationQuerySchema>;

export const pageInfoSchema = z.strictObject({
  next_cursor: z.string().min(1).max(2048).nullable(),
  has_more: z.boolean(),
});
export type PageInfo = z.infer<typeof pageInfoSchema>;

export const cursorPageSchema = <T extends z.ZodType>(itemSchema: T) =>
  z.strictObject({ items: z.array(itemSchema), page: pageInfoSchema });
