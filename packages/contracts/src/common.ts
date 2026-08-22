import { z } from 'zod';

export const sportSchema = z.enum(['run', 'ride', 'walk', 'hike']);
export type Sport = z.infer<typeof sportSchema>;

export const unitSystemSchema = z.enum(['metric', 'imperial']);
export type UnitSystem = z.infer<typeof unitSystemSchema>;

export const syncStatusSchema = z.enum([
  'saving_locally',
  'waiting_to_upload',
  'uploading',
  'synced',
  'needs_attention',
]);
export type SyncStatus = z.infer<typeof syncStatusSchema>;

export const uuidSchema = z.uuid();
export const utcDateTimeSchema = z.iso.datetime({ offset: true });
export const latitudeSchema = z.number().finite().min(-90).max(90);
export const longitudeSchema = z.number().finite().min(-180).max(180);
export const nonNegativeFiniteSchema = z.number().finite().nonnegative();
export const positiveIntegerSchema = z.number().int().positive();

export const coordinateSchema = z.strictObject({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
});
export type Coordinate = z.infer<typeof coordinateSchema>;
