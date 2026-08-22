import { z } from 'zod';
import {
  MAX_ACTIVITY_DURATION_SECONDS,
  MAX_ACTIVITY_POINTS,
} from './limits.js';
import {
  latitudeSchema,
  longitudeSchema,
  nonNegativeFiniteSchema,
  sportSchema,
  unitSystemSchema,
  utcDateTimeSchema,
  uuidSchema,
} from './common.js';

export const activityPointSchema = z.strictObject({
  sequence: z.number().int().nonnegative(),
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  elevation_m: z.number().finite().nullable(),
  accuracy_m: nonNegativeFiniteSchema.nullable(),
  recorded_at: utcDateTimeSchema,
});
export type ActivityPoint = z.infer<typeof activityPointSchema>;

export const activitySplitSchema = z.strictObject({
  index: z.number().int().min(1),
  unit_system: unitSystemSchema,
  distance_m: z.number().finite().positive(),
  moving_time_s: nonNegativeFiniteSchema,
  pace_s_per_unit: nonNegativeFiniteSchema.nullable(),
  partial: z.boolean(),
});
export type ActivitySplit = z.infer<typeof activitySplitSchema>;

export const elevationSourceSchema = z.literal('gps_smoothed');
export type ElevationSource = z.infer<typeof elevationSourceSchema>;

export const elevationSampleSchema = z.strictObject({
  distance_m: nonNegativeFiniteSchema,
  elapsed_time_s: nonNegativeFiniteSchema,
  elevation_m: z.number().finite(),
});
export type ElevationSample = z.infer<typeof elevationSampleSchema>;

export const elevationProfileSchema = z.strictObject({
  source: elevationSourceSchema,
  samples: z.array(elevationSampleSchema),
  gain_m: nonNegativeFiniteSchema,
  loss_m: nonNegativeFiniteSchema,
});
export type ElevationProfile = z.infer<typeof elevationProfileSchema>;

export const activityStatsSchema = z.strictObject({
  distance_m: nonNegativeFiniteSchema,
  moving_time_s: nonNegativeFiniteSchema,
  elapsed_time_s: nonNegativeFiniteSchema,
  elevation_gain_m: nonNegativeFiniteSchema,
  elevation_loss_m: nonNegativeFiniteSchema,
  average_pace_s_per_km: nonNegativeFiniteSchema.nullable(),
  average_speed_mps: nonNegativeFiniteSchema.nullable(),
});
export type ActivityStats = z.infer<typeof activityStatsSchema>;

export const activityPointsSchema = z
  .array(activityPointSchema)
  .min(1)
  .max(MAX_ACTIVITY_POINTS);

export const activityPauseSchema = z.strictObject({
  started_at: utcDateTimeSchema,
  ended_at: utcDateTimeSchema,
});
export type ActivityPause = z.infer<typeof activityPauseSchema>;

const activityTitleSchema = z.string().trim().min(1).max(200);

export const createActivityRequestSchema = z
  .strictObject({
    payload_version: z.literal(1),
    id: uuidSchema,
    sport: sportSchema,
    title: activityTitleSchema.nullable().optional(),
    notes: z.string().max(10_000).nullable().optional(),
    started_at: utcDateTimeSchema,
    ended_at: utcDateTimeSchema,
    route_id: uuidSchema.nullable().optional(),
    pauses: z.array(activityPauseSchema).max(10_000).default([]),
    points: activityPointsSchema,
  })
  .superRefine((activity, context) => {
    const startedAt = Date.parse(activity.started_at);
    const endedAt = Date.parse(activity.ended_at);
    if (endedAt <= startedAt) {
      context.addIssue({
        code: 'custom',
        path: ['ended_at'],
        message: 'ended_at must be after started_at',
      });
    } else if (endedAt - startedAt > MAX_ACTIVITY_DURATION_SECONDS * 1000) {
      context.addIssue({
        code: 'custom',
        path: ['ended_at'],
        message: 'Activity exceeds the 12-hour limit',
      });
    }
    let lastPauseEnd = Number.NEGATIVE_INFINITY;
    activity.pauses.forEach((pause, index) => {
      const pauseStart = Date.parse(pause.started_at);
      const pauseEnd = Date.parse(pause.ended_at);
      if (
        pauseEnd <= pauseStart ||
        pauseStart < startedAt ||
        pauseEnd > endedAt ||
        pauseStart < lastPauseEnd
      ) {
        context.addIssue({
          code: 'custom',
          path: ['pauses', index],
          message:
            'Pause intervals must be ordered, non-overlapping, and within activity bounds',
        });
      }
      lastPauseEnd = pauseEnd;
    });
    let lastSequence = -1;
    let lastTimestamp = Number.NEGATIVE_INFINITY;
    activity.points.forEach((point, index) => {
      const timestamp = Date.parse(point.recorded_at);
      if (point.sequence <= lastSequence) {
        context.addIssue({
          code: 'custom',
          path: ['points', index, 'sequence'],
          message: 'Point sequences must be strictly increasing',
        });
      }
      if (timestamp <= lastTimestamp) {
        context.addIssue({
          code: 'custom',
          path: ['points', index, 'recorded_at'],
          message: 'Point timestamps must be strictly increasing',
        });
      }
      if (
        timestamp < Date.parse(activity.started_at) ||
        timestamp > Date.parse(activity.ended_at)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['points', index, 'recorded_at'],
          message: 'Point timestamp must be within activity bounds',
        });
      }
      lastSequence = point.sequence;
      lastTimestamp = timestamp;
    });
  });
export type CreateActivityRequest = z.infer<typeof createActivityRequestSchema>;

const activityObjectSchema = z.strictObject({
  id: uuidSchema,
  sport: sportSchema,
  title: activityTitleSchema.nullable(),
  notes: z.string().max(10_000).nullable(),
  started_at: utcDateTimeSchema,
  ended_at: utcDateTimeSchema,
  route_id: uuidSchema.nullable(),
  stats: activityStatsSchema,
  polylines: z.array(z.string().min(1)).min(1),
  splits: z.array(activitySplitSchema),
  elevation: elevationProfileSchema,
  created_at: utcDateTimeSchema,
  updated_at: utcDateTimeSchema,
});

export const activitySchema = activityObjectSchema.refine(
  ({ started_at, ended_at }) => Date.parse(ended_at) > Date.parse(started_at),
  { path: ['ended_at'], message: 'ended_at must be after started_at' },
);
export type Activity = z.infer<typeof activitySchema>;

export const activitySummarySchema = activityObjectSchema.pick({
  id: true,
  sport: true,
  title: true,
  started_at: true,
  stats: true,
});
export type ActivitySummary = z.infer<typeof activitySummarySchema>;

export const activityListResponseSchema = z.strictObject({
  items: z.array(activitySummarySchema).max(200),
  page: z.strictObject({
    next_cursor: z.string().min(1).max(2048).nullable(),
    has_more: z.boolean(),
  }),
});
export type ActivityListResponse = z.infer<typeof activityListResponseSchema>;

export const updateActivityRequestSchema = z
  .strictObject({
    title: activityTitleSchema.nullable().optional(),
    notes: z.string().max(10_000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });
export type UpdateActivityRequest = z.infer<typeof updateActivityRequestSchema>;

export const deleteActivityQuerySchema = z.strictObject({
  confirmation: z.literal('DELETE'),
});
