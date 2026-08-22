import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

describe('native recording configuration', () => {
  it('declares exact iOS purpose strings and background location mode', () => {
    const config = JSON.parse(read('apps/mobile/app.json')) as {
      expo: { ios: { infoPlist: Record<string, unknown> }; plugins: unknown[] };
    };
    expect(config.expo.ios.infoPlist.NSLocationWhenInUseUsageDescription).toBe(
      'Trail uses your location to record the path of your run, ride, walk, or hike.',
    );
    expect(
      config.expo.ios.infoPlist.NSLocationAlwaysAndWhenInUseUsageDescription,
    ).toBe(
      'Trail needs background location so your activity continues with the screen locked.',
    );
    expect(config.expo.ios.infoPlist.UIBackgroundModes).toContain('location');
    expect(JSON.stringify(config.expo.plugins)).toContain(
      'isIosBackgroundLocationEnabled',
    );
  });
  it('declares Android API 26+, background/foreground location service and Android 13 notifications', () => {
    const config = read('apps/mobile/app.json');
    for (const declaration of [
      'minSdkVersion',
      'ACCESS_BACKGROUND_LOCATION',
      'FOREGROUND_SERVICE_LOCATION',
      'POST_NOTIFICATIONS',
    ]) {
      expect(config).toContain(declaration);
    }
  });
  it('registers the background task at module top level and uses the shared persistence pipeline', () => {
    const service = read('apps/mobile/src/services/recording-location.ts');
    expect(service).toContain('TaskManager.defineTask');
    expect(service).toContain('persistLocationBatch');
    expect(service).toContain('for (const chunk of chunkLocations(points))');
    expect(service).toContain('timeInterval: 1_000');
    expect(service).not.toContain('scheduleNotificationAsync');
    expect(service).not.toContain('AndroidNotificationVisibility.PUBLIC');
    expect(service).toContain('Open Trail to view recording details.');
    expect(service).toContain('catch (error)');
    expect(service).toContain('clearForegroundContext()');
  });
  it('configures SQLCipher, non-backup Android storage, and after-first-unlock device-only key protection', () => {
    const config = read('apps/mobile/app.json');
    const keyStore = read('apps/mobile/src/storage/recording-database-key.ts');
    const cleanupFallback = read(
      'apps/mobile/src/storage/confirmed-cleanup-fallback.ts',
    );
    const database = read('apps/mobile/src/storage/recording-database.ts');
    expect(config).toContain('"useSQLCipher": true');
    expect(config).toContain('"allowBackup": false');
    expect(config).toContain(
      'NSFileProtectionCompleteUntilFirstUserAuthentication',
    );
    expect(keyStore).toContain('AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY');
    expect(cleanupFallback).toContain('AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY');
    expect(cleanupFallback).toContain('UUID_PATTERN');
    expect(database).toContain('PRAGMA key');
    expect(database).toContain(
      'SQLCipher requires keying before every other statement',
    );
  });
  it('uses a stable owner/session key for the five-second map refresh', () => {
    const screen = read('apps/mobile/src/features/record/record-screen.tsx');
    expect(screen).toContain('const mapSessionId = session?.id ?? null');
    expect(screen).toContain('[mapSessionId, ownerUserId, refreshMap]');
    expect(screen).toContain('5_000');
    expect(screen.indexOf('const hud =')).toBeLessThan(
      screen.indexOf('if (visibleOwner.current !== owner) return'),
    );
  });
  it('schedules persisted sync retry deadlines without an unrelated event', () => {
    const runtime = read(
      'apps/mobile/src/features/activity-sync/sync-runtime.tsx',
    );
    expect(runtime).toContain('earliestNextAttemptAt');
    expect(runtime).toContain('setTimeout(() => void trigger(), delay)');
    expect(runtime).toContain("phase !== 'signed-in'");
    expect(runtime).toContain('refreshQueued.current = true');
    expect(runtime).toContain('while (refreshQueued.current)');
  });
  it('includes owner-scoped durable tables and migration versioning', () => {
    const database = read('apps/mobile/src/storage/recording-database.ts');
    for (const table of [
      'recording_sessions',
      'recording_points',
      'recording_pauses',
      'sync_jobs',
      'pending_photos',
    ])
      expect(database).toContain(`TABLE IF NOT EXISTS ${table}`);
    expect(database).toContain('PRAGMA user_version = 1');
    expect(database).toContain('withExclusiveTransactionAsync');
    expect(database).toContain('transaction.execAsync(sql)');
    expect(database).toContain('this.migrationPromise = null');
    expect(database).toContain('this.databasePromise = null');
    expect(database).toContain('one_active_recording_per_owner');
    expect(database).toContain('owner_cleanup_markers');
    expect(database).toContain("'prepared','confirmed','unresolved'");
    expect(database).toContain("WHERE state='confirmed'");
    expect(database).toContain('result.changes !== 1');
    expect(database).toContain('task_payload_overflow');
    expect(database).toContain('one_open_pause_per_session');
    expect(database).toContain(
      'DELETE FROM recording_sessions WHERE id=? AND owner_user_id=?',
    );
    expect(database).toContain("state='uploading'");
  });
});
