import { describe, expect, it } from 'vitest';
import { permissionWarnings } from './permission-policy';

describe('staged recording permission policy', () => {
  it('blocks foreground denial with settings guidance when it cannot ask again', () => {
    expect(
      permissionWarnings({
        foreground: 'denied',
        background: 'denied',
        notifications: 'denied',
        canAskForegroundAgain: false,
      }),
    ).toEqual([
      'Location access is denied. Open Settings to allow location for Trail.',
    ]);
  });
  it('allows foreground recording while clearly warning about degraded background capabilities', () => {
    const warnings = permissionWarnings({
      foreground: 'granted',
      background: 'denied',
      notifications: 'denied',
      canAskForegroundAgain: true,
    });
    expect(warnings).toHaveLength(2);
    expect(warnings.join(' ')).toContain(
      'cannot continue with the screen locked',
    );
    expect(warnings.join(' ')).toContain('Notifications are off');
  });
  it('has no warning when all requested capabilities are granted', () => {
    expect(
      permissionWarnings({
        foreground: 'granted',
        background: 'granted',
        notifications: 'granted',
        canAskForegroundAgain: true,
      }),
    ).toEqual([]);
  });
});
