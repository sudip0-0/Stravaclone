import type {
  PersistedRecordingState,
  RecordingSession,
} from './recording-types';

const transitions: Readonly<
  Record<PersistedRecordingState, readonly PersistedRecordingState[]>
> = {
  starting: ['recording'],
  recording: ['paused', 'stopping'],
  paused: ['recording', 'stopping'],
  stopping: ['saving'],
  saving: ['local_saved'],
  local_saved: [],
};

export function canTransition(
  from: PersistedRecordingState,
  to: PersistedRecordingState,
): boolean {
  return transitions[from].includes(to);
}

export function assertTransition(
  from: PersistedRecordingState,
  to: PersistedRecordingState,
): void {
  if (!canTransition(from, to))
    throw new Error(`Invalid recording transition: ${from} -> ${to}`);
}

export function elapsedRecordingMs(
  session: RecordingSession,
  nowMs: number,
): number {
  if (session.startedAtMs === null) return 0;
  const endMs =
    session.stoppedAtMs ??
    (session.state === 'paused' ? session.pausedAtMs : null) ??
    nowMs;
  return Math.max(0, endMs - session.startedAtMs - session.accumulatedPausedMs);
}

export function canSaveRecording(
  session: RecordingSession,
  nowMs: number,
): boolean {
  return (
    elapsedRecordingMs(session, nowMs) >= 30_000 || session.distanceM >= 50
  );
}
