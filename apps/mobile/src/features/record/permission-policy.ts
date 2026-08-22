import type { RecordingPermissionResult } from '../../services/recording-location';

export function permissionWarnings(
  result: RecordingPermissionResult,
): readonly string[] {
  if (result.foreground === 'denied') {
    return [
      result.canAskForegroundAgain
        ? 'Location access is required to record. You can try Start again.'
        : 'Location access is denied. Open Settings to allow location for Trail.',
    ];
  }
  const warnings: string[] = [];
  if (result.background === 'denied')
    warnings.push(
      'Background location is off. Recording runs only while Trail is visible and cannot continue with the screen locked.',
    );
  if (result.notifications === 'denied')
    warnings.push(
      'Notifications are off; Android may limit background recording status.',
    );
  return warnings;
}
