import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAppState } from '../../state/app-state';
import { recordingRepository } from '../../storage/recording-database';
import { removeManagedPhotoFile } from './photo-file-store';
import { PhotoSyncEngine } from './photo-sync-engine';

interface PhotoSyncContextValue {
  readonly revision: number;
  readonly syncing: boolean;
  trigger(): Promise<void>;
  retry(localPhotoId: string): Promise<void>;
}

const PhotoSyncContext = createContext<PhotoSyncContextValue>({
  revision: 0,
  syncing: false,
  async trigger() {},
  async retry() {},
});
let queuedListener: (() => void) | null = null;

export function notifyPhotoQueued(): void {
  queuedListener?.();
}

export function PhotoSyncRuntime({ children }: { children: ReactNode }) {
  const { api, phase, profile } = useAppState();
  const activeOwner = useRef<string | null>(null);
  activeOwner.current = phase === 'signed-in' ? (profile?.id ?? null) : null;
  const engine = useMemo(
    () =>
      new PhotoSyncEngine(
        recordingRepository,
        api,
        Date.now,
        (owner) => activeOwner.current === owner,
      ),
    [api],
  );
  const [revision, setRevision] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const reconcileProcessing = useCallback(
    async (ownerUserId: string) => {
      const pending =
        await recordingRepository.listProcessingPendingPhotos(ownerUserId);
      const byActivity = new Map<string, typeof pending>();
      for (const photo of pending) {
        const group = byActivity.get(photo.activityId) ?? [];
        group.push(photo);
        byActivity.set(photo.activityId, group);
      }
      for (const [activityId, localPhotos] of byActivity) {
        if (activeOwner.current !== ownerUserId) return;
        const remote = await api.listPhotos(activityId);
        if (activeOwner.current !== ownerUserId) return;
        const remoteById = new Map(remote.map((photo) => [photo.id, photo]));
        for (const localPhoto of localPhotos) {
          if (!localPhoto.serverPhotoId) continue;
          const serverPhoto = remoteById.get(localPhoto.serverPhotoId);
          if (serverPhoto?.status === 'ready') {
            removeManagedPhotoFile(localPhoto.localUri);
            await recordingRepository.removePendingPhoto(
              ownerUserId,
              localPhoto.id,
            );
          } else if (serverPhoto?.status === 'failed') {
            await recordingRepository.setPendingPhotoStatus(
              ownerUserId,
              localPhoto.id,
              'needs_attention',
              100,
              Date.now(),
            );
          }
        }
      }
    },
    [api],
  );
  const trigger = useCallback(async () => {
    if (!profile || phase !== 'signed-in') return;
    setSyncing(true);
    try {
      await recordingRepository.recoverPendingPhotoLeases(
        profile.id,
        Date.now(),
      );
      await engine.trigger(profile.id);
      if (activeOwner.current === profile.id)
        await reconcileProcessing(profile.id);
    } finally {
      setSyncing(false);
      setRevision((value) => value + 1);
    }
  }, [engine, phase, profile, reconcileProcessing]);
  const retry = useCallback(
    async (localPhotoId: string) => {
      if (!profile) return;
      await recordingRepository.retryPendingPhoto(
        profile.id,
        localPhotoId,
        Date.now(),
      );
      await trigger();
    },
    [profile, trigger],
  );

  useEffect(() => {
    void trigger();
  }, [trigger]);
  useEffect(() => {
    if (phase !== 'signed-in' || !profile) return;
    const timer = setInterval(() => void trigger(), 5_000);
    return () => clearInterval(timer);
  }, [phase, profile, trigger]);
  useEffect(() => {
    queuedListener = () => void trigger();
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void trigger();
    });
    const network = NetInfo.addEventListener((state) => {
      if (state.isConnected) void trigger();
    });
    return () => {
      queuedListener = null;
      appState.remove();
      network();
    };
  }, [trigger]);

  return (
    <PhotoSyncContext.Provider value={{ revision, syncing, trigger, retry }}>
      {children}
    </PhotoSyncContext.Provider>
  );
}

export function usePhotoSync(): PhotoSyncContextValue {
  return useContext(PhotoSyncContext);
}
