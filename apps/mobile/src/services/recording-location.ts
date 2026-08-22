import { AppState as NativeAppState, Linking, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import type { TrackPoint } from '@trail/domain';
import {
  AsyncWatcherController,
  OrderedRetryQueue,
  TaskPayloadOverflowError,
  chunkLocations,
  normalizeLocationPayload,
  selectCollectionMode,
  shouldRunForegroundWatcher,
} from '../features/record/location-adapter-policy';
import {
  persistLocationBatch,
  type LocationCollection,
} from '../features/record/recording-service';
import type { RecordingSession } from '../features/record/recording-types';
import { recordingRepository } from '../storage/recording-database';

export const RECORDING_LOCATION_TASK = 'trail-recording-location-v2';
async function persistValidatedLocations(
  session: RecordingSession,
  locations: readonly TrackPoint[],
  nowMs: number,
) {
  if (!locations.length) return null;
  const latest = locations.reduce((current, candidate) =>
    candidate.timestampMs > current.timestampMs ? candidate : current,
  );
  await recordingRepository.recordRawFix(
    session.ownerUserId,
    session.id,
    latest.accuracyM ?? null,
    latest.timestampMs,
  );
  return persistLocationBatch(recordingRepository, session, locations, nowMs);
}

TaskManager.defineTask(RECORDING_LOCATION_TASK, async ({ data, error }) => {
  if (error)
    throw error instanceof Error
      ? error
      : new Error('Background location task failed.');
  const nowMs = Date.now();
  let points: readonly TrackPoint[];
  try {
    points = normalizeLocationPayload(data, nowMs).points;
  } catch (cause) {
    if (cause instanceof TaskPayloadOverflowError) {
      try {
        await recordingRepository.migrate();
        const active =
          await recordingRepository.getActiveSessionForBackground();
        if (active)
          await recordingRepository.markRecordingError(
            active.ownerUserId,
            active.id,
            'task_payload_overflow',
            nowMs,
          );
      } finally {
        await stopNativeCollection();
      }
    }
    throw cause;
  }
  if (!points.length) return;
  let session: RecordingSession | null = null;
  try {
    await recordingRepository.migrate();
    // A collector is selected only when exactly one owner-bound background row is recording; identity is never emitted.
    session = await recordingRepository.getActiveSessionForBackground();
    if (!session) return;
    for (const chunk of chunkLocations(points)) {
      const updated = await persistValidatedLocations(session, chunk, nowMs);
      if (updated?.state === 'stopping') {
        await stopNativeCollection();
        return;
      }
    }
  } catch (cause) {
    try {
      if (session)
        await recordingRepository.markRecordingError(
          session.ownerUserId,
          session.id,
          'persistence_failed',
          nowMs,
        );
    } finally {
      await stopNativeCollection();
    }
    throw cause;
  }
});

const foregroundWatcher = new AsyncWatcherController();
let foregroundSession: RecordingSession | null = null;
let lifecycleSubscription: ReturnType<
  typeof NativeAppState.addEventListener
> | null = null;
interface ForegroundBatch {
  readonly session: RecordingSession;
  readonly points: readonly TrackPoint[];
  readonly nowMs: number;
}
let foregroundQueue: OrderedRetryQueue<ForegroundBatch> | null = null;
function createForegroundQueue(): OrderedRetryQueue<ForegroundBatch> {
  return new OrderedRetryQueue({
    maximumQueued: 24,
    maximumAttempts: 4,
    delay: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    process: async ({ session, points, nowMs }) => {
      const updated = await persistValidatedLocations(session, points, nowMs);
      if (updated?.state === 'stopping') await stopNativeCollection();
    },
    onFatal: async () => {
      const active = foregroundSession;
      try {
        if (active)
          await recordingRepository.markRecordingError(
            active.ownerUserId,
            active.id,
            'persistence_failed',
            Date.now(),
          );
      } finally {
        await stopNativeCollection();
      }
    },
  });
}

async function startForegroundWatcher(): Promise<void> {
  if (NativeAppState.currentState !== 'active') return;
  await foregroundWatcher.start(() =>
    Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 1_000,
        distanceInterval: 0,
      },
      (location) => {
        const nowMs = Date.now();
        const { points } = normalizeLocationPayload(
          { locations: [location] },
          nowMs,
        );
        const active = foregroundSession;
        if (active && points.length)
          foregroundQueue?.enqueue({ session: active, points, nowMs });
      },
    ),
  );
}
function stopForegroundWatcher(): void {
  foregroundWatcher.stop();
}
function clearForegroundContext(): void {
  stopForegroundWatcher();
  foregroundSession = null;
  foregroundQueue = null;
  lifecycleSubscription?.remove();
  lifecycleSubscription = null;
}
function ensureLifecycleListener(): void {
  lifecycleSubscription ??= NativeAppState.addEventListener(
    'change',
    (state) => {
      const session = foregroundSession;
      if (!session) return;
      if (shouldRunForegroundWatcher('foreground-watch', state))
        void startForegroundWatcher();
      else stopForegroundWatcher();
    },
  );
}

export async function stopNativeCollection(): Promise<void> {
  clearForegroundContext();
  if (await Location.hasStartedLocationUpdatesAsync(RECORDING_LOCATION_TASK))
    await Location.stopLocationUpdatesAsync(RECORDING_LOCATION_TASK);
}

export const expoLocationCollection: LocationCollection = {
  async start(session) {
    const mode = selectCollectionMode(session.backgroundEnabled);
    if (mode === 'foreground-watch') {
      foregroundSession = session;
      foregroundQueue = createForegroundQueue();
      ensureLifecycleListener();
      try {
        await startForegroundWatcher();
      } catch (error) {
        clearForegroundContext();
        throw error;
      }
      return;
    }
    if (await Location.hasStartedLocationUpdatesAsync(RECORDING_LOCATION_TASK))
      return;
    await Location.startLocationUpdatesAsync(RECORDING_LOCATION_TASK, {
      accuracy: Location.Accuracy.BestForNavigation,
      timeInterval: 1_000,
      distanceInterval: 0,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      activityType: Location.ActivityType.Fitness,
      foregroundService: {
        notificationTitle: 'Trail recording active',
        notificationBody: 'Open Trail to view recording details.',
        notificationColor: '#146C43',
        killServiceOnDestroy: false,
      },
    });
  },
  stop: stopNativeCollection,
};

export interface RecordingPermissionResult {
  readonly foreground: 'granted' | 'denied';
  readonly background: 'granted' | 'denied';
  readonly notifications: 'granted' | 'denied' | 'not-required';
  readonly canAskForegroundAgain: boolean;
}
export async function requestRecordingPermissions(): Promise<RecordingPermissionResult> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== Location.PermissionStatus.GRANTED)
    return {
      foreground: 'denied',
      background: 'denied',
      notifications:
        Platform.OS === 'android' && Platform.Version >= 33
          ? 'denied'
          : 'not-required',
      canAskForegroundAgain: foreground.canAskAgain,
    };
  const background = await Location.requestBackgroundPermissionsAsync();
  let notifications: RecordingPermissionResult['notifications'] =
    'not-required';
  if (Platform.OS === 'android' && Platform.Version >= 33)
    notifications = (await Notifications.requestPermissionsAsync()).granted
      ? 'granted'
      : 'denied';
  return {
    foreground: 'granted',
    background:
      background.status === Location.PermissionStatus.GRANTED
        ? 'granted'
        : 'denied',
    notifications,
    canAskForegroundAgain: foreground.canAskAgain,
  };
}
export async function openApplicationSettings(): Promise<void> {
  await Linking.openSettings();
}

export function disposeRecordingLocationLifecycleForTests(): void {
  clearForegroundContext();
}
