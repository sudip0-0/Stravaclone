export type PendingPhotoStatus =
  | 'pending'
  | 'uploading'
  | 'completing'
  | 'processing'
  | 'needs_attention';

export interface PendingPhoto {
  readonly id: string;
  readonly ownerUserId: string;
  readonly activityId: string;
  readonly serverPhotoId: string | null;
  readonly localUri: string;
  readonly status: PendingPhotoStatus;
  readonly inputMime: 'image/jpeg' | 'image/heic' | 'image/webp';
  readonly inputSizeBytes: number;
  readonly progress: number;
  readonly attemptCount: number;
  readonly nextAttemptAtMs: number;
  readonly lastSafeErrorCode: string | null;
  readonly leaseExpiresAtMs: number | null;
}

export interface NewPendingPhoto {
  readonly id: string;
  readonly ownerUserId: string;
  readonly activityId: string;
  readonly localUri: string;
  readonly inputMime: PendingPhoto['inputMime'];
  readonly inputSizeBytes: number;
  readonly nowMs: number;
}

export interface PendingPhotoRepository {
  addPendingPhoto(input: NewPendingPhoto): Promise<void>;
  listPendingPhotos(
    ownerUserId: string,
    activityId: string,
  ): Promise<PendingPhoto[]>;
  listDuePendingPhotos(
    ownerUserId: string,
    nowMs: number,
  ): Promise<PendingPhoto[]>;
  listProcessingPendingPhotos(ownerUserId: string): Promise<PendingPhoto[]>;
  setPendingPhotoUpload(
    ownerUserId: string,
    id: string,
    serverPhotoId: string,
    progress: number,
    nowMs: number,
  ): Promise<void>;
  setPendingPhotoStatus(
    ownerUserId: string,
    id: string,
    status: PendingPhotoStatus,
    progress: number,
    nowMs: number,
  ): Promise<void>;
  failPendingPhoto(
    ownerUserId: string,
    id: string,
    safeCode: string,
    nextAttemptAtMs: number,
    clearServerPhotoId: boolean,
    nowMs: number,
  ): Promise<void>;
  retryPendingPhoto(
    ownerUserId: string,
    id: string,
    nowMs: number,
  ): Promise<void>;
  abandonPendingPhotoReservation(
    ownerUserId: string,
    id: string,
    nowMs: number,
  ): Promise<void>;
  removePendingPhoto(ownerUserId: string, id: string): Promise<void>;
  removePendingPhotoByServerId(
    ownerUserId: string,
    serverPhotoId: string,
  ): Promise<void>;
  recoverPendingPhotoLeases(ownerUserId: string, nowMs: number): Promise<void>;
}
