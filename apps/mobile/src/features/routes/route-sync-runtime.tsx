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
import { getRouteHandoff } from './route-handoff';
import { LocalRouteService, RouteSyncEngine } from './route-sync';

let queuedListener: (() => void) | null = null;
export function notifyRouteMutationQueued(): void {
  queuedListener?.();
}
const Context = createContext<{
  service: LocalRouteService;
  retry(): Promise<void>;
} | null>(null);
export function RouteSyncRuntime({ children }: { children: ReactNode }) {
  const { api, phase, profile } = useAppState();
  const owner = phase === 'signed-in' ? (profile?.id ?? null) : null;
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const engine = useMemo(
    () =>
      new RouteSyncEngine(
        recordingRepository,
        api,
        Date.now,
        Math.random,
        (id) => ownerRef.current === id,
      ),
    [api],
  );
  const [nextAttemptAt, setNextAttemptAt] = useState<number | null>(null);
  const trigger = useCallback(async () => {
    if (!owner) {
      setNextAttemptAt(null);
      return;
    }
    await engine.trigger(owner);
    await recordingRepository.purgeExpiredRouteTombstones(owner, Date.now());
    setNextAttemptAt(await recordingRepository.nextRouteAttemptAt(owner));
  }, [engine, owner]);
  const service = useMemo(
    () =>
      new LocalRouteService(
        recordingRepository,
        api,
        notifyRouteMutationQueued,
      ),
    [api],
  );
  const retry = useCallback(async () => {
    if (!owner) return;
    await engine.manualRetry(owner);
    setNextAttemptAt(await recordingRepository.nextRouteAttemptAt(owner));
  }, [engine, owner]);
  useEffect(() => {
    getRouteHandoff(owner);
    void trigger();
  }, [owner, trigger]);
  useEffect(() => {
    if (nextAttemptAt === null) return;
    const timer = setTimeout(
      () => void trigger(),
      Math.max(0, nextAttemptAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [nextAttemptAt, trigger]);
  useEffect(() => {
    queuedListener = () => void trigger();
    const foreground = AppState.addEventListener('change', (state) => {
      if (state === 'active') void trigger();
    });
    const network = NetInfo.addEventListener((state) => {
      if (state.isConnected) void trigger();
    });
    return () => {
      queuedListener = null;
      foreground.remove();
      network();
    };
  }, [trigger]);
  return (
    <Context.Provider value={{ service, retry }}>{children}</Context.Provider>
  );
}
export function useRouteSync() {
  const value = useContext(Context);
  if (!value) throw new Error('RouteSyncRuntime is missing');
  return value;
}
