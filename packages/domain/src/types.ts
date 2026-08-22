export interface Coordinate {
  readonly latitude: number;
  readonly longitude: number;
}

export interface TrackPoint extends Coordinate {
  readonly timestampMs: number;
  readonly accuracyM?: number | null;
  readonly elevationM?: number | null;
}

export type ActivitySport = 'run' | 'ride' | 'walk' | 'hike';
export type UnitSystem = 'metric' | 'imperial';

export interface PauseInterval {
  readonly startedAtMs: number;
  readonly endedAtMs: number;
}
