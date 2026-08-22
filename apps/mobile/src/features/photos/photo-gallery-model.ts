import { MAX_ACTIVITY_PHOTOS, type ActivityPhoto } from '@trail/contracts';
import type { PendingPhoto, PendingPhotoStatus } from './photo-types';

export function remainingPhotoSlots(
  remotePhotoIds: readonly string[],
  localPhotos: readonly Pick<PendingPhoto, 'serverPhotoId'>[],
): number {
  const remote = new Set(remotePhotoIds);
  const unboundLocal = localPhotos.filter(
    (photo) => !photo.serverPhotoId || !remote.has(photo.serverPhotoId),
  ).length;
  return Math.max(0, MAX_ACTIVITY_PHOTOS - remote.size - unboundLocal);
}

export function galleryStatus(
  localStatus: PendingPhotoStatus,
  remoteStatus?: ActivityPhoto['status'],
): { readonly label: string; readonly failed: boolean } {
  if (localStatus === 'needs_attention' || remoteStatus === 'failed')
    return { label: 'Needs attention', failed: true };
  if (localStatus === 'processing' || remoteStatus === 'processing')
    return { label: 'Processing privately', failed: false };
  if (localStatus === 'completing')
    return { label: 'Confirming upload', failed: false };
  if (localStatus === 'uploading') return { label: 'Uploading', failed: false };
  return { label: 'Waiting to upload', failed: false };
}

export function deleteFailureMessage(): string {
  return 'Photo could not be deleted. Try again.';
}
