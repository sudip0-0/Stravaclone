import { describe, expect, it, vi } from 'vitest';
import {
  AsyncWatcherController,
  MAX_TASK_PAYLOAD_LOCATIONS,
  OrderedRetryQueue,
  TaskPayloadOverflowError,
  chunkLocations,
  normalizeLocationPayload,
  selectCollectionMode,
  shouldRunForegroundWatcher,
} from './location-adapter-policy';
import { MAX_LOCATION_BATCH_SIZE } from './recording-types';
const location = (timestamp: number) => ({
  coords: { latitude: 1, longitude: 2, altitude: null, accuracy: 8 },
  timestamp,
});

describe('location adapter and payload policy', () => {
  it('selects background tasks only with background permission and foreground only while visible', () => {
    expect(selectCollectionMode(true)).toBe('background-task');
    expect(selectCollectionMode(false)).toBe('foreground-watch');
    expect(shouldRunForegroundWatcher('foreground-watch', 'active')).toBe(true);
    expect(shouldRunForegroundWatcher('foreground-watch', 'background')).toBe(
      false,
    );
    expect(shouldRunForegroundWatcher('background-task', 'active')).toBe(false);
  });
  it('validates every location, sorts, deduplicates timestamps, and reports rejections', () => {
    const now = 100_000;
    const result = normalizeLocationPayload(
      {
        locations: [
          location(now + 2),
          {
            ...location(now),
            coords: { ...location(now).coords, latitude: 91 },
          },
          location(now + 1),
          location(now + 2),
          location(now),
        ],
      },
      now,
    );
    expect(result.points.map((point) => point.timestampMs)).toEqual([
      now,
      now + 1,
      now + 2,
    ]);
    expect(result.rejectedCount).toBe(2);
  });
  it('never slices payloads over 120 and processes them as bounded sequential chunks', () => {
    const now = 100_000;
    const count = MAX_LOCATION_BATCH_SIZE * 2 + 17;
    const result = normalizeLocationPayload(
      {
        locations: Array.from({ length: count }, (_, index) =>
          location(now + index),
        ),
      },
      now,
    );
    expect(result.points).toHaveLength(count);
    const chunks = chunkLocations(result.points);
    expect(chunks.map((chunk) => chunk.length)).toEqual([120, 120, 17]);
    expect(chunks.flat()).toHaveLength(count);
  });
  it('rejects an oversized task before sorting or materializing points', () => {
    const now = 100_000;
    const locations = new Array(MAX_TASK_PAYLOAD_LOCATIONS + 1);
    expect(() => normalizeLocationPayload({ locations }, now)).toThrow(
      TaskPayloadOverflowError,
    );
  });
  it('retries a failed batch before later batches and loses nothing on recovery', async () => {
    const order: number[] = [];
    let firstFailures = 1;
    const queue = new OrderedRetryQueue<number>({
      maximumQueued: 5,
      maximumAttempts: 3,
      delay: async () => {},
      onFatal: async () => {},
      process: async (value) => {
        order.push(value);
        if (value === 1 && firstFailures-- > 0) throw new Error('sql');
      },
    });
    queue.enqueue(1);
    queue.enqueue(2);
    await vi.waitFor(() => expect(queue.queuedCount).toBe(0));
    expect(order).toEqual([1, 1, 2]);
    expect(queue.terminal).toBe(false);
  });
  it('retains failed and later batches and signals explicit fatal exhaustion', async () => {
    const fatal = vi.fn(async () => {});
    const queue = new OrderedRetryQueue<number>({
      maximumQueued: 5,
      maximumAttempts: 2,
      delay: async () => {},
      onFatal: fatal,
      process: async () => {
        throw new Error('permanent');
      },
    });
    queue.enqueue(1);
    queue.enqueue(2);
    await vi.waitFor(() => expect(queue.terminal).toBe(true));
    expect(queue.queuedCount).toBe(2);
    expect(fatal).toHaveBeenCalledWith('exhausted', expect.any(Error));
  });
  it('signals explicit overflow instead of silently dropping continuation batches', async () => {
    let release!: () => void;
    const fatal = vi.fn(async () => {});
    const queue = new OrderedRetryQueue<number>({
      maximumQueued: 1,
      maximumAttempts: 2,
      delay: async () => {},
      onFatal: fatal,
      process: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    });
    queue.enqueue(1);
    queue.enqueue(2);
    await vi.waitFor(() => expect(queue.terminal).toBe(true));
    expect(queue.queuedCount).toBe(1);
    expect(fatal).toHaveBeenCalledWith('overflow', expect.any(Error));
    release();
  });
  it('generation-safely removes a watcher that resolves after stop/background', async () => {
    const controller = new AsyncWatcherController();
    const remove = vi.fn();
    let resolve!: (value: { remove(): void }) => void;
    const starting = controller.start(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    controller.stop();
    resolve({ remove });
    await starting;
    expect(remove).toHaveBeenCalledOnce();
    expect(controller.running).toBe(false);
  });
  it('does not retain a watcher when native registration rejects', async () => {
    const controller = new AsyncWatcherController();
    await expect(
      controller.start(async () => {
        throw new Error('registration');
      }),
    ).rejects.toThrow('registration');
    expect(controller.running).toBe(false);
  });
  it('serializes installed watcher identity and removes it once', async () => {
    const controller = new AsyncWatcherController();
    const remove = vi.fn();
    await controller.start(async () => ({ remove }));
    await controller.start(async () => ({ remove: vi.fn() }));
    expect(controller.running).toBe(true);
    controller.stop();
    expect(remove).toHaveBeenCalledOnce();
  });
});
