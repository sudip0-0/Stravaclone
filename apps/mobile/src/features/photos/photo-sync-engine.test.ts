import { describe, expect, it, vi } from 'vitest';
import {
  PhotoSyncEngine,
  type PhotoUploadTransport,
} from './photo-sync-engine';
import type { PendingPhoto, PendingPhotoRepository } from './photo-types';

function pending(id: string, ownerUserId = 'owner'): PendingPhoto {
  return {
    id,
    ownerUserId,
    activityId: 'activity',
    serverPhotoId: null,
    localUri: `file://${id}`,
    status: 'pending',
    inputMime: 'image/jpeg',
    inputSizeBytes: 10,
    progress: 0,
    attemptCount: 0,
    nextAttemptAtMs: 0,
    lastSafeErrorCode: null,
    leaseExpiresAtMs: null,
  };
}

function harness(items: PendingPhoto[]) {
  const values = new Map(items.map((item) => [item.id, { ...item }]));
  const repository: PendingPhotoRepository = {
    addPendingPhoto: async () => undefined,
    listPendingPhotos: async (owner, activity) =>
      [...values.values()].filter(
        (value) => value.ownerUserId === owner && value.activityId === activity,
      ),
    listDuePendingPhotos: async (owner) =>
      [...values.values()].filter(
        (value) => value.ownerUserId === owner && value.status === 'pending',
      ),
    listProcessingPendingPhotos: async (owner) =>
      [...values.values()].filter(
        (value) => value.ownerUserId === owner && value.status === 'processing',
      ),
    setPendingPhotoUpload: async (_owner, id, serverPhotoId, progress) => {
      Object.assign(values.get(id)!, {
        serverPhotoId,
        progress,
        status: 'uploading',
      });
    },
    setPendingPhotoStatus: async (_owner, id, status, progress) => {
      Object.assign(values.get(id)!, { status, progress });
    },
    failPendingPhoto: async (_owner, id, code, next, clear) => {
      Object.assign(values.get(id)!, {
        status:
          values.get(id)!.attemptCount + 1 >= 5
            ? 'needs_attention'
            : clear
              ? 'pending'
              : 'completing',
        attemptCount: values.get(id)!.attemptCount + 1,
        lastSafeErrorCode: code,
        nextAttemptAtMs: next,
        serverPhotoId: clear ? null : values.get(id)!.serverPhotoId,
      });
    },
    retryPendingPhoto: async () => undefined,
    abandonPendingPhotoReservation: async (_owner, id) => {
      Object.assign(values.get(id)!, {
        serverPhotoId: null,
        status: 'pending',
        progress: 0,
        lastSafeErrorCode: 'staging_missing',
      });
    },
    removePendingPhoto: async () => undefined,
    removePendingPhotoByServerId: async () => undefined,
    recoverPendingPhotoLeases: async () => undefined,
  };
  let sequence = 0;
  const initiatePhotoUpload = vi.fn(async () => ({
    photo_id: `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
    status: 'pending' as const,
    upload_url: 'https://upload.example.test',
    expires_at: '2026-01-01T00:15:00.000Z',
    form_fields: { 'Content-Type': 'image/jpeg', key: 'staging' },
  }));
  const uploadPhoto = vi.fn(async () => undefined);
  const completePhotoUpload = vi.fn(
    async (_activity: string, photoId: string) => ({
      photo_id: photoId,
      status: 'processing' as const,
    }),
  );
  const reissuePhotoUpload = vi.fn(
    async (_activity: string, photoId: string) => ({
      photo_id: photoId,
      status: 'pending' as const,
      upload_url: 'https://upload.example.test/reissued',
      expires_at: '2026-01-01T00:15:00.000Z',
      form_fields: { 'Content-Type': 'image/jpeg', key: 'staging' },
    }),
  );
  const transport: PhotoUploadTransport = {
    initiatePhotoUpload,
    uploadPhoto,
    completePhotoUpload,
    reissuePhotoUpload,
  };
  return {
    values,
    repository,
    transport,
    initiatePhotoUpload,
    uploadPhoto,
    completePhotoUpload,
    reissuePhotoUpload,
  };
}

describe('photo sync engine', () => {
  it('reissues the same reservation after an uncommitted POST', async () => {
    const test = harness([pending('one'), pending('two')]);
    test.uploadPhoto
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined);
    test.completePhotoUpload
      .mockRejectedValueOnce({ code: 'staging_missing' })
      .mockResolvedValueOnce({
        photo_id: '00000000-0000-4000-8000-000000000002',
        status: 'processing',
      });
    const engine = new PhotoSyncEngine(
      test.repository,
      test.transport,
      () => 100,
    );

    await engine.trigger('owner');

    expect(test.values.get('one')).toMatchObject({
      status: 'processing',
      serverPhotoId: '00000000-0000-4000-8000-000000000001',
    });
    expect(test.reissuePhotoUpload).toHaveBeenCalledWith(
      'activity',
      '00000000-0000-4000-8000-000000000001',
    );
    expect(test.values.get('two')).toMatchObject({
      status: 'processing',
      progress: 100,
    });
  });

  it('recovers an expired upload lease when POST never committed', async () => {
    const item = {
      ...pending('one'),
      serverPhotoId: 'server',
      status: 'uploading' as const,
      leaseExpiresAtMs: 50,
    };
    const test = harness([item]);
    test.repository.listDuePendingPhotos = async () => [item];
    test.completePhotoUpload.mockRejectedValueOnce({ code: 'staging_missing' });
    const engine = new PhotoSyncEngine(
      test.repository,
      test.transport,
      () => 100,
    );

    await engine.trigger('owner');

    expect(test.completePhotoUpload).toHaveBeenCalledWith('activity', 'server');
    expect(test.reissuePhotoUpload).toHaveBeenCalledWith('activity', 'server');
    expect(test.values.get('one')).toMatchObject({
      status: 'processing',
      serverPhotoId: 'server',
    });
  });

  it('safely clears local reservation only when reissue confirms not found', async () => {
    const item = {
      ...pending('one'),
      serverPhotoId: 'deleted-server',
      status: 'completing' as const,
    };
    const test = harness([item]);
    test.repository.listDuePendingPhotos = async () => [item];
    test.completePhotoUpload.mockRejectedValueOnce({ code: 'not_found' });
    test.reissuePhotoUpload.mockRejectedValueOnce({ code: 'not_found' });
    const engine = new PhotoSyncEngine(
      test.repository,
      test.transport,
      () => 100,
    );

    await engine.trigger('owner');

    expect(test.values.get('one')).toMatchObject({
      status: 'pending',
      serverPhotoId: null,
    });
    expect(test.initiatePhotoUpload).not.toHaveBeenCalled();
  });

  it('keeps the same reservation when a crash occurs after reissue before POST', async () => {
    const item = {
      ...pending('one'),
      serverPhotoId: 'server',
      status: 'completing' as const,
    };
    const test = harness([item]);
    test.repository.listDuePendingPhotos = async () => [item];
    test.completePhotoUpload
      .mockRejectedValueOnce({ code: 'staging_missing' })
      .mockRejectedValueOnce({ code: 'staging_missing' });
    test.uploadPhoto.mockRejectedValueOnce(new Error('crash before post'));
    const engine = new PhotoSyncEngine(
      test.repository,
      test.transport,
      () => 100,
    );

    await engine.trigger('owner');

    expect(test.reissuePhotoUpload).toHaveBeenCalledWith('activity', 'server');
    expect(test.values.get('one')).toMatchObject({
      status: 'completing',
      serverPhotoId: 'server',
    });
  });

  it('completes after an upload timeout when POST actually committed', async () => {
    const test = harness([pending('one')]);
    test.uploadPhoto.mockRejectedValueOnce(new Error('timeout after commit'));
    const engine = new PhotoSyncEngine(
      test.repository,
      test.transport,
      () => 100,
    );

    await engine.trigger('owner');

    expect(test.completePhotoUpload).toHaveBeenCalledTimes(1);
    expect(test.values.get('one')).toMatchObject({
      status: 'processing',
      serverPhotoId: expect.any(String),
    });
  });

  it('uses needs attention only after the terminal attempt', async () => {
    const item = { ...pending('one'), attemptCount: 4 };
    const test = harness([item]);
    test.uploadPhoto.mockRejectedValueOnce(new Error('offline'));
    test.completePhotoUpload.mockRejectedValueOnce(new Error('offline'));
    const engine = new PhotoSyncEngine(
      test.repository,
      test.transport,
      () => 100,
    );

    await engine.trigger('owner');

    expect(test.values.get('one')).toMatchObject({
      status: 'needs_attention',
      attemptCount: 5,
    });
  });

  it('retries completion without re-uploading bytes', async () => {
    const item = {
      ...pending('one'),
      serverPhotoId: 'server',
      status: 'completing' as const,
    };
    const test = harness([item]);
    test.repository.listDuePendingPhotos = async () => [item];
    const engine = new PhotoSyncEngine(
      test.repository,
      test.transport,
      () => 100,
    );

    await engine.trigger('owner');

    expect(test.initiatePhotoUpload).not.toHaveBeenCalled();
    expect(test.uploadPhoto).not.toHaveBeenCalled();
    expect(test.completePhotoUpload).toHaveBeenCalledWith('activity', 'server');
  });

  it('ignores a reissue result after an account switch', async () => {
    const item = {
      ...pending('one'),
      serverPhotoId: 'server',
      status: 'completing' as const,
    };
    const test = harness([item]);
    test.repository.listDuePendingPhotos = async () => [item];
    let activeOwner = 'owner';
    test.completePhotoUpload.mockRejectedValueOnce({ code: 'staging_missing' });
    test.reissuePhotoUpload.mockImplementationOnce(
      async (_activity, photoId) => {
        activeOwner = 'other';
        return {
          photo_id: photoId,
          status: 'pending',
          upload_url: 'https://upload.example.test/reissued',
          expires_at: '2026-01-01T00:15:00.000Z',
          form_fields: { key: 'staging', 'Content-Type': 'image/jpeg' },
        };
      },
    );
    const engine = new PhotoSyncEngine(
      test.repository,
      test.transport,
      () => 100,
      (owner) => owner === activeOwner,
    );

    await engine.trigger('owner');

    expect(test.values.get('one')).toMatchObject({
      status: 'completing',
      serverPhotoId: 'server',
    });
    expect(test.uploadPhoto).not.toHaveBeenCalled();
  });

  it('stops before another account can continue the owner-scoped queue', async () => {
    const test = harness([pending('one'), pending('two')]);
    let activeOwner = 'owner';
    test.completePhotoUpload.mockImplementation(async (_activity, photoId) => {
      activeOwner = 'other';
      return { photo_id: photoId, status: 'processing' };
    });
    const engine = new PhotoSyncEngine(
      test.repository,
      test.transport,
      () => 100,
      (owner) => owner === activeOwner,
    );

    await engine.trigger('owner');

    expect(test.initiatePhotoUpload).toHaveBeenCalledTimes(1);
    expect(test.values.get('one')?.status).toBe('completing');
    expect(test.values.get('two')?.status).toBe('pending');
  });
});
