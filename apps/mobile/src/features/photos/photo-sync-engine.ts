import type {
  PhotoCompleteResponse,
  SignedPhotoUpload,
} from '@trail/contracts';
import type { PendingPhoto, PendingPhotoRepository } from './photo-types';

export interface PhotoUploadTransport {
  initiatePhotoUpload(
    activityId: string,
    input: {
      input_mime: PendingPhoto['inputMime'];
      input_size_bytes: number;
    },
  ): Promise<SignedPhotoUpload>;
  uploadPhoto(
    signed: SignedPhotoUpload,
    localUri: string,
    expectedBytes: number,
  ): Promise<void>;
  completePhotoUpload(
    activityId: string,
    photoId: string,
  ): Promise<PhotoCompleteResponse>;
  reissuePhotoUpload(
    activityId: string,
    photoId: string,
  ): Promise<SignedPhotoUpload>;
}

function errorCode(cause: unknown): string | null {
  if (!cause || typeof cause !== 'object' || !('code' in cause)) return null;
  return typeof cause.code === 'string' ? cause.code : null;
}

function retryAt(nowMs: number, attempt: number): number {
  return nowMs + Math.min(30 * 60_000, 2 ** Math.min(attempt, 8) * 5_000);
}

export class PhotoSyncEngine {
  private running = false;

  constructor(
    private readonly repository: PendingPhotoRepository,
    private readonly transport: PhotoUploadTransport,
    private readonly now: () => number = Date.now,
    private readonly ownerIsActive: (ownerUserId: string) => boolean = () =>
      true,
  ) {}

  async trigger(ownerUserId: string): Promise<void> {
    if (this.running || !this.ownerIsActive(ownerUserId)) return;
    this.running = true;
    try {
      const pending = await this.repository.listDuePendingPhotos(
        ownerUserId,
        this.now(),
      );
      for (const photo of pending) {
        if (!this.ownerIsActive(ownerUserId)) return;
        await this.uploadOne(photo);
      }
    } finally {
      this.running = false;
    }
  }

  private async uploadOne(photo: PendingPhoto): Promise<void> {
    let serverPhotoId = photo.serverPhotoId;
    try {
      if (!serverPhotoId) {
        const signed = await this.transport.initiatePhotoUpload(
          photo.activityId,
          {
            input_mime: photo.inputMime,
            input_size_bytes: photo.inputSizeBytes,
          },
        );
        serverPhotoId = signed.photo_id;
        if (!this.ownerIsActive(photo.ownerUserId)) return;
        await this.repository.setPendingPhotoUpload(
          photo.ownerUserId,
          photo.id,
          serverPhotoId,
          15,
          this.now(),
        );
        try {
          if (!this.ownerIsActive(photo.ownerUserId)) return;
          await this.transport.uploadPhoto(
            signed,
            photo.localUri,
            photo.inputSizeBytes,
          );
        } catch {
          if (!this.ownerIsActive(photo.ownerUserId)) return;
        }
        if (!this.ownerIsActive(photo.ownerUserId)) return;
        await this.repository.setPendingPhotoStatus(
          photo.ownerUserId,
          photo.id,
          'completing',
          90,
          this.now(),
        );
      }
      if (!this.ownerIsActive(photo.ownerUserId)) return;
      const completed = await this.transport.completePhotoUpload(
        photo.activityId,
        serverPhotoId,
      );
      if (!this.ownerIsActive(photo.ownerUserId)) return;
      await this.repository.setPendingPhotoStatus(
        photo.ownerUserId,
        photo.id,
        completed.status === 'failed' ? 'needs_attention' : 'processing',
        100,
        this.now(),
      );
    } catch (cause) {
      if (!this.ownerIsActive(photo.ownerUserId)) return;
      if (
        ['staging_missing', 'not_found'].includes(errorCode(cause) ?? '') &&
        serverPhotoId
      ) {
        let signed: SignedPhotoUpload;
        try {
          signed = await this.transport.reissuePhotoUpload(
            photo.activityId,
            serverPhotoId,
          );
        } catch (reissueCause) {
          if (!this.ownerIsActive(photo.ownerUserId)) return;
          if (errorCode(reissueCause) === 'not_found') {
            await this.repository.abandonPendingPhotoReservation(
              photo.ownerUserId,
              photo.id,
              this.now(),
            );
            return;
          }
          await this.repository.failPendingPhoto(
            photo.ownerUserId,
            photo.id,
            'photo_reissue_failed',
            retryAt(this.now(), photo.attemptCount + 1),
            false,
            this.now(),
          );
          return;
        }
        if (!this.ownerIsActive(photo.ownerUserId)) return;
        await this.repository.setPendingPhotoUpload(
          photo.ownerUserId,
          photo.id,
          serverPhotoId,
          15,
          this.now(),
        );
        try {
          await this.transport.uploadPhoto(
            signed,
            photo.localUri,
            photo.inputSizeBytes,
          );
        } catch {
          if (!this.ownerIsActive(photo.ownerUserId)) return;
        }
        if (!this.ownerIsActive(photo.ownerUserId)) return;
        await this.repository.setPendingPhotoStatus(
          photo.ownerUserId,
          photo.id,
          'completing',
          90,
          this.now(),
        );
        try {
          const completed = await this.transport.completePhotoUpload(
            photo.activityId,
            serverPhotoId,
          );
          if (!this.ownerIsActive(photo.ownerUserId)) return;
          await this.repository.setPendingPhotoStatus(
            photo.ownerUserId,
            photo.id,
            completed.status === 'failed' ? 'needs_attention' : 'processing',
            100,
            this.now(),
          );
        } catch {
          if (!this.ownerIsActive(photo.ownerUserId)) return;
          await this.repository.failPendingPhoto(
            photo.ownerUserId,
            photo.id,
            'photo_completion_failed',
            retryAt(this.now(), photo.attemptCount + 1),
            false,
            this.now(),
          );
        }
        return;
      }
      await this.repository.failPendingPhoto(
        photo.ownerUserId,
        photo.id,
        'photo_completion_failed',
        retryAt(this.now(), photo.attemptCount + 1),
        false,
        this.now(),
      );
    }
  }
}
