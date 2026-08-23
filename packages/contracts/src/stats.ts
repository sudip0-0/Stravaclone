import { z } from 'zod';
import { activitySummarySchema } from './activities.js';
import {
  nonNegativeFiniteSchema,
  sportSchema,
  utcDateTimeSchema,
} from './common.js';

export const statsPeriodSchema = z.enum(['week', 'year']);
export const statsSportFilterSchema = z.union([z.literal('all'), sportSchema]);
export type StatsSportFilter = z.infer<typeof statsSportFilterSchema>;

function isIanaTimeZone(value: string): boolean {
  if (value !== 'UTC' && !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+$/.test(value))
    return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export const ianaTimeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(isIanaTimeZone, {
    message: 'timezone must be a valid IANA time zone',
  });

function hasIncreasingRange(value: {
  readonly starts_at: string;
  readonly ends_at: string;
}): boolean {
  return Date.parse(value.ends_at) > Date.parse(value.starts_at);
}

export const statsQuerySchema = z
  .strictObject({
    period: statsPeriodSchema,
    sport: statsSportFilterSchema.default('all'),
    starts_at: utcDateTimeSchema,
    ends_at: utcDateTimeSchema,
    timezone: ianaTimeZoneSchema,
  })
  .refine(hasIncreasingRange, {
    path: ['ends_at'],
    message: 'ends_at must be after starts_at',
  });
export type StatsQuery = z.infer<typeof statsQuerySchema>;

export const statsTotalsSchema = z.strictObject({
  distance_m: nonNegativeFiniteSchema,
  moving_time_s: nonNegativeFiniteSchema,
  activity_count: z.number().int().nonnegative(),
  elevation_gain_m: nonNegativeFiniteSchema,
});
export type StatsTotals = z.infer<typeof statsTotalsSchema>;

export const statsResponseSchema = z
  .strictObject({
    period: statsPeriodSchema,
    sport: statsSportFilterSchema,
    starts_at: utcDateTimeSchema,
    ends_at: utcDateTimeSchema,
    totals: statsTotalsSchema,
  })
  .refine(hasIncreasingRange, {
    path: ['ends_at'],
    message: 'ends_at must be after starts_at',
  });

export const calendarQuerySchema = z.strictObject({
  year: z.coerce.number().int().min(1970).max(9999),
  month: z.coerce.number().int().min(1).max(12),
  timezone: ianaTimeZoneSchema,
  sport: statsSportFilterSchema.default('all'),
});

export const calendarDaySchema = z.strictObject({
  date: z.iso.date(),
  activity_count: z.number().int().positive(),
});
export const calendarResponseSchema = z.strictObject({
  days: z.array(calendarDaySchema).max(31),
});
export type CalendarResponse = z.infer<typeof calendarResponseSchema>;

export const calendarDayQuerySchema = z.strictObject({
  date: z.iso.date(),
  timezone: ianaTimeZoneSchema,
  sport: statsSportFilterSchema.default('all'),
});
export type CalendarDayQuery = z.infer<typeof calendarDayQuerySchema>;

export const calendarDayResponseSchema = z.strictObject({
  date: z.iso.date(),
  items: z.array(activitySummarySchema).max(200),
});
export type CalendarDayResponse = z.infer<typeof calendarDayResponseSchema>;
export type StatsResponse = z.infer<typeof statsResponseSchema>;
