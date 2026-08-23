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
import { ActivitySyncEngine } from './sync-engine';

export function syncTimerDelayMs(nextAttemptAt: number, nowMs: number): number {
  return Math.max(0, Math.min(2_147_000_000, nextAttemptAt - nowMs));
}

let localSaveListener: (() => void) | null = null;
export function notifyActivitySavedLocally(): void {
  localSaveListener?.();
}
interface SyncContextValue {
  readonly pendingCount: number;
  readonly revision: number;
  readonly syncing: boolean;
  retry(): Promise<void>;
  refresh(): Promise<void>;
}
const SyncContext = createContext<SyncContextValue>({
  pendingCount: 0,
  revision: 0,
  syncing: false,
  async retry() {},
  async refresh() {},
});

export function ActivitySyncRuntime({ children }: { children: ReactNode }) {
  const { api, phase, profile } = useAppState();
  const ownerRef = useRef<string | null>(null);
  ownerRef.current = phase === 'signed-in' ? (profile?.id ?? null) : null;
  const engine = useMemo(
    () =>
      new ActivitySyncEngine(
        recordingRepository,
        api,
        Date.now,
        Math.random,
        (ownerUserId) => ownerRef.current === ownerUserId,
      ),
    [api],
  );
  const [pendingCount, setPendingCount] = useState(0);
  const [revision, setRevision] = useState(0);
  const [nextAttemptAt, setNextAttemptAt] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const refreshFlight = useRef<Promise<void> | null>(null);
  const refreshQueued = useRef(false);
  const refresh = useCallback((): Promise<void> => {
    refreshQueued.current = true;
    if (refreshFlight.current) return refreshFlight.current;
    const operation = (async () => {
      do {
        refreshQueued.current = false;
        if (!profile) {
          setPendingCount(0);
          setNextAttemptAt(null);
        } else {
          const [count, due] = await Promise.all([
            recordingRepository.pendingCount(profile.id),
            recordingRepository.earliestNextAttemptAt(profile.id),
          ]);
          if (ownerRef.current === profile.id) {
            setPendingCount(count);
            setNextAttemptAt(due);
          }
        }
      } while (refreshQueued.current);
    })().finally(() => {
      refreshFlight.current = null;
      if (refreshQueued.current) void refresh();
    });
    refreshFlight.current = operation;
    return operation;
  }, [profile]);
  const trigger = useCallback(async () => {
    if (phase !== 'signed-in' || !profile) return;
    setSyncing(true);
    try {
      await engine.trigger(profile.id);
    } finally {
      setSyncing(false);
      await refresh();
      setRevision((value) => value + 1);
    }
  }, [engine, phase, profile, refresh]);
  const retry = useCallback(async () => {
    if (!profile) return;
    setSyncing(true);
    try {
      await engine.manualRetry(profile.id);
    } finally {
      setSyncing(false);
      await refresh();
      setRevision((value) => value + 1);
    }
  }, [engine, profile, refresh]);

  useEffect(() => {
    void refresh().then(trigger);
  }, [refresh, trigger]);
  useEffect(() => {
    if (nextAttemptAt === null || phase !== 'signed-in') return;
    const delay = syncTimerDelayMs(nextAttemptAt, Date.now());
    const timer = setTimeout(() => void trigger(), delay);
    return () => clearTimeout(timer);
  }, [nextAttemptAt, phase, trigger]);
  useEffect(() => {
    localSaveListener = () => void trigger();
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void trigger();
    });
    const network = NetInfo.addEventListener((state) => {
      if (state.isConnected) void trigger();
    });
    return () => {
      localSaveListener = null;
      appState.remove();
      network();
    };
  }, [trigger]);
  return (
    <SyncContext.Provider
      value={{ pendingCount, revision, syncing, retry, refresh }}
    >
      {children}
    </SyncContext.Provider>
  );
}
export function useActivitySync(): SyncContextValue {
  return useContext(SyncContext);
}
