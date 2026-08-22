import { describe, expect, it } from 'vitest';
import {
  assertTransition,
  canSaveRecording,
  canTransition,
  elapsedRecordingMs,
} from './recording-state-machine';
import type { RecordingSession } from './recording-types';

function session(patch: Partial<RecordingSession> = {}): RecordingSession {
  return {
    id: 'session',
    ownerUserId: 'owner',
    state: 'recording',
    sport: 'run',
    backgroundEnabled: true,
    createdAtMs: 0,
    startedAtMs: 1_000,
    updatedAtMs: 1_000,
    stoppedAtMs: null,
    pausedAtMs: null,
    accumulatedPausedMs: 0,
    distanceM: 0,
    acceptedPointCount: 0,
    lastSequence: -1,
    latestRawAccuracyM: null,
    latestRawFixAtMs: null,
    stopReason: null,
    errorCode: null,
    ...patch,
  };
}

describe('recording state and clock rules', () => {
  it('allows only the explicit lifecycle edges', () => {
    expect(canTransition('starting', 'recording')).toBe(true);
    expect(canTransition('recording', 'paused')).toBe(true);
    expect(canTransition('paused', 'recording')).toBe(true);
    expect(canTransition('paused', 'stopping')).toBe(true);
    expect(() => assertTransition('starting', 'saving')).toThrow(
      'Invalid recording transition',
    );
    expect(() => assertTransition('local_saved', 'recording')).toThrow();
  });
  it('excludes current and accumulated pauses from elapsed time', () => {
    expect(
      elapsedRecordingMs(
        session({
          state: 'paused',
          pausedAtMs: 11_000,
          accumulatedPausedMs: 2_000,
        }),
        99_000,
      ),
    ).toBe(8_000);
    expect(
      elapsedRecordingMs(session({ accumulatedPausedMs: 4_000 }), 16_000),
    ).toBe(11_000);
  });
  it('documents the OR save policy', () => {
    expect(canSaveRecording(session(), 31_000)).toBe(true);
    expect(canSaveRecording(session({ distanceM: 50 }), 2_000)).toBe(true);
    expect(canSaveRecording(session({ distanceM: 49.9 }), 30_999)).toBe(false);
  });
});
