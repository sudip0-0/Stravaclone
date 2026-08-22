import { z } from 'zod';
import {
  coordinateSchema,
  nonNegativeFiniteSchema,
  sportSchema,
  utcDateTimeSchema,
  uuidSchema,
} from './common.js';

export const routeSchema = z.strictObject({
  id: uuidSchema,
  name: z.string().min(1).max(200),
  sport_hint: sportSchema.nullable(),
  waypoints: z.array(coordinateSchema).min(2).max(1000),
  polyline: z.string().min(1),
  distance_m: nonNegativeFiniteSchema,
  elevation_gain_m: nonNegativeFiniteSchema.nullable(),
  created_at: utcDateTimeSchema,
  updated_at: utcDateTimeSchema,
});
export type Route = z.infer<typeof routeSchema>;

export const createRouteRequestSchema = z.strictObject({
  id: uuidSchema,
  name: z.string().trim().min(1).max(200),
  sport_hint: sportSchema.nullable().optional(),
  waypoints: z.array(coordinateSchema).min(2).max(1000),
});
export type CreateRouteRequest = z.infer<typeof createRouteRequestSchema>;

export const updateRouteRequestSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(200).optional(),
    sport_hint: sportSchema.nullable().optional(),
    waypoints: z.array(coordinateSchema).min(2).max(1000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });
