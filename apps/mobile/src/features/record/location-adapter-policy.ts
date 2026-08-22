import type { AppStateStatus } from 'react-native';
import type { TrackPoint } from '@trail/domain';
import { MAX_LOCATION_BATCH_SIZE } from './recording-types';

export type CollectionMode = 'background-task' | 'foreground-watch';
export const selectCollectionMode = (
  backgroundGranted: boolean,
): CollectionMode =>
  backgroundGranted ? 'background-task' : 'foreground-watch';
export const shouldRunForegroundWatcher = (
  mode: CollectionMode,
  state: AppStateStatus,
): boolean => mode === 'foreground-watch' && state === 'active';
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
export const MAX_TASK_PAYLOAD_LOCATIONS = 5_000;
export class TaskPayloadOverflowError extends Error {
  constructor(readonly receivedCount: number) {
    super(
      `Location task payload exceeds ${MAX_TASK_PAYLOAD_LOCATIONS} entries.`,
    );
  }
}
export interface ValidatedLocationPayload {
  readonly points: readonly TrackPoint[];
  readonly rejectedCount: number;
}
export function normalizeLocationPayload(
  data: unknown,
  nowMs: number,
): ValidatedLocationPayload {
  if (!isRecord(data) || !Array.isArray(data.locations))
    return { points: [], rejectedCount: 0 };
  if (data.locations.length > MAX_TASK_PAYLOAD_LOCATIONS)
    throw new TaskPayloadOverflowError(data.locations.length);
  const valid: TrackPoint[] = [];
  let rejectedCount = 0;
  for (const candidate of data.locations) {
    if (!isRecord(candidate) || !isRecord(candidate.coords)) {
      rejectedCount += 1;
      continue;
    }
    const { latitude, longitude, altitude, accuracy } = candidate.coords;
    const timestamp = candidate.timestamp;
    if (
      typeof latitude !== 'number' ||
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      typeof longitude !== 'number' ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180 ||
      typeof timestamp !== 'number' ||
      !Number.isFinite(timestamp) ||
      timestamp < nowMs - 86_400_000 ||
      timestamp > nowMs + 300_000 ||
      (accuracy != null &&
        (typeof accuracy !== 'number' ||
          !Number.isFinite(accuracy) ||
          accuracy < 0)) ||
      (altitude != null &&
        (typeof altitude !== 'number' || !Number.isFinite(altitude)))
    ) {
      rejectedCount += 1;
      continue;
    }
    valid.push({
      latitude,
      longitude,
      elevationM: altitude as number | null,
      accuracyM: accuracy as number | null,
      timestampMs: timestamp,
    });
  }
  valid.sort((left, right) => left.timestampMs - right.timestampMs);
  const points = valid.filter(
    (point, index) =>
      index === 0 || point.timestampMs !== valid[index - 1]?.timestampMs,
  );
  return {
    points,
    rejectedCount: rejectedCount + valid.length - points.length,
  };
}
export function chunkLocations(
  points: readonly TrackPoint[],
  size = MAX_LOCATION_BATCH_SIZE,
): readonly (readonly TrackPoint[])[] {
  if (!Number.isInteger(size) || size < 1 || size > MAX_LOCATION_BATCH_SIZE)
    throw new Error('Invalid location chunk size.');
  const chunks: TrackPoint[][] = [];
  for (let index = 0; index < points.length; index += size)
    chunks.push(points.slice(index, index + size));
  return chunks;
}

export interface OrderedRetryQueueOptions<T> {
  readonly maximumQueued: number;
  readonly maximumAttempts: number;
  readonly process: (item: T) => Promise<void>;
  readonly delay: (milliseconds: number) => Promise<void>;
  readonly onFatal: (
    reason: 'exhausted' | 'overflow',
    error: unknown,
  ) => Promise<void>;
}
export class OrderedRetryQueue<T> {
  private readonly pending: { item: T; attempts: number }[] = [];
  private draining = false;
  private failed = false;
  constructor(private readonly options: OrderedRetryQueueOptions<T>) {}
  enqueue(item: T): void {
    if (this.failed || this.pending.length >= this.options.maximumQueued) {
      if (!this.failed) {
        this.failed = true;
        void this.options.onFatal(
          'overflow',
          new Error('Persistence retry queue overflow.'),
        );
      }
      return;
    }
    this.pending.push({ item, attempts: 0 });
    void this.drain();
  }
  private async drain(): Promise<void> {
    if (this.draining || this.failed) return;
    this.draining = true;
    try {
      while (!this.failed && this.pending[0]) {
        const head = this.pending[0];
        try {
          await this.options.process(head.item);
          this.pending.shift();
        } catch (error) {
          head.attempts += 1;
          if (head.attempts >= this.options.maximumAttempts) {
            this.failed = true;
            await this.options.onFatal('exhausted', error);
            return;
          }
          await this.options.delay(250 * 2 ** (head.attempts - 1));
        }
      }
    } finally {
      this.draining = false;
    }
  }
  get queuedCount(): number {
    return this.pending.length;
  }
  get terminal(): boolean {
    return this.failed;
  }
}

export interface RemovableWatcher {
  remove(): void;
}
export class AsyncWatcherController {
  private generation = 0;
  private watcher: RemovableWatcher | null = null;
  async start(factory: () => Promise<RemovableWatcher>): Promise<void> {
    if (this.watcher) return;
    const generation = ++this.generation;
    const created = await factory();
    if (generation !== this.generation) {
      created.remove();
      return;
    }
    this.watcher = created;
  }
  stop(): void {
    this.generation += 1;
    this.watcher?.remove();
    this.watcher = null;
  }
  get running(): boolean {
    return this.watcher !== null;
  }
}
