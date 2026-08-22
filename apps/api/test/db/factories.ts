import type { InferInsertModel } from 'drizzle-orm';
import type { activities, routes, users } from '../../src/db/schema.js';

type NewUser = InferInsertModel<typeof users>;
type NewRoute = InferInsertModel<typeof routes>;
type NewActivity = InferInsertModel<typeof activities>;

export const syntheticIds = {
  owner: '00000000-0000-4000-8000-000000000001',
  otherOwner: '00000000-0000-4000-8000-000000000002',
  route: '00000000-0000-4000-8000-000000000101',
  activity: '00000000-0000-4000-8000-000000000201',
  photo: '00000000-0000-4000-8000-000000000401',
} as const;

export function syntheticUser(overrides: Partial<NewUser> = {}): NewUser {
  return {
    id: syntheticIds.owner,
    email: 'synthetic.owner@example.test',
    passwordHash:
      '$argon2id$v=19$m=65536,t=3,p=1$c3ludGhldGljc2FsdA$c3ludGhldGljaGFzaA',
    displayName: 'Synthetic Owner',
    units: 'metric',
    defaultSport: 'run',
    ...overrides,
  };
}

export function syntheticRoute(overrides: Partial<NewRoute> = {}): NewRoute {
  return {
    id: syntheticIds.route,
    userId: syntheticIds.owner,
    name: 'Synthetic Loop',
    sportHint: 'run',
    waypoints: [
      { latitude: 0, longitude: 0 },
      { latitude: 0.001, longitude: 0.001 },
    ],
    polyline: '??gEgE',
    distanceM: 157,
    elevationGainM: 3,
    ...overrides,
  };
}

export function syntheticPhotoObjectKey(
  userId: string = syntheticIds.owner,
  activityId: string = syntheticIds.activity,
  photoId: string = syntheticIds.photo,
): string {
  return `users/${userId}/activities/${activityId}/photos/${photoId}`;
}

export function syntheticActivity(
  overrides: Partial<NewActivity> = {},
): NewActivity {
  return {
    id: syntheticIds.activity,
    userId: syntheticIds.owner,
    sport: 'run',
    startedAt: new Date('2026-01-01T08:00:00.000Z'),
    endedAt: new Date('2026-01-01T08:05:00.000Z'),
    distanceM: 1_000,
    movingTimeS: 280,
    elapsedTimeS: 300,
    elevationGainM: 8,
    elevationLossM: 6,
    polyline: '??gEgE',
    polylines: ['??gEgE'],
    ingestHash: 'a'.repeat(64),
    ...overrides,
  };
}
