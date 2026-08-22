import { describe, expect, it } from 'vitest';
import {
  deleteFailureMessage,
  galleryStatus,
  remainingPhotoSlots,
} from './photo-gallery-model';

describe('photo gallery model', () => {
  it('enforces exact ten and eleven item boundaries with de-duplication', () => {
    const remote = Array.from({ length: 9 }, (_, index) => `remote-${index}`);
    expect(remainingPhotoSlots(remote, [{ serverPhotoId: null }])).toBe(0);
    expect(
      remainingPhotoSlots(remote, [
        { serverPhotoId: null },
        { serverPhotoId: null },
      ]),
    ).toBe(0);
    expect(remainingPhotoSlots(remote, [{ serverPhotoId: 'remote-0' }])).toBe(
      1,
    );
  });

  it('maps mixed success and retry states without hiding partial success', () => {
    expect(galleryStatus('processing', 'ready')).toEqual({
      label: 'Processing privately',
      failed: false,
    });
    expect(galleryStatus('pending')).toEqual({
      label: 'Waiting to upload',
      failed: false,
    });
    expect(galleryStatus('completing')).toEqual({
      label: 'Confirming upload',
      failed: false,
    });
    expect(galleryStatus('processing', 'failed')).toEqual({
      label: 'Needs attention',
      failed: true,
    });
  });

  it('keeps delete failures actionable', () => {
    expect(deleteFailureMessage()).toBe(
      'Photo could not be deleted. Try again.',
    );
  });
});
