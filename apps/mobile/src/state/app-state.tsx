import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { UpdateUserRequest, User } from '@trail/contracts';
import { environment } from '../config/environment';
import { ApiClient } from '../services/api-client';
import { createRotationRequestId } from '../services/rotation-id';
import { SecureSessionStore } from '../services/secure-session-store';
import { SessionCoordinator } from '../services/session-coordinator';
import type { SessionRetryReason } from '../services/session-types';
import { resolveDraftReporter, type DraftStateReporter } from './draft-guard';
import { AppProfileStore } from './profile-state';

export type SessionPhase =
  | 'restoring'
  | 'session-retry'
  | 'signed-out'
  | 'signed-in';
interface AppContextValue {
  api: ApiClient;
  phase: SessionPhase;
  profile: User | null;
  draftReporter: DraftStateReporter;
  sessionRetryReason: SessionRetryReason | null;
  terminalMessage: string | null;
  retrySession: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  confirmSignUp: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateProfile: (patch: UpdateUserRequest) => Promise<User>;
  deleteAccount: (password: string) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppStateProvider({
  children,
  draftReporter: providedDraftReporter,
}: {
  children: ReactNode;
  draftReporter?: DraftStateReporter;
}) {
  const [phase, setPhase] = useState<SessionPhase>('restoring');
  const [terminalMessage, setTerminalMessage] = useState<string | null>(null);
  const profileStore = useMemo(() => new AppProfileStore(), []);
  const profile = useSyncExternalStore(
    profileStore.subscribe,
    profileStore.get,
    profileStore.get,
  );
  const draftReporter = useMemo(
    () => resolveDraftReporter(providedDraftReporter),
    [providedDraftReporter],
  );
  const services = useMemo(() => {
    const api = new ApiClient(environment.apiUrl);
    const session = new SessionCoordinator(
      new SecureSessionStore(),
      api,
      () => {
        profileStore.set(null);
        setTerminalMessage('Your session ended. Please sign in again.');
        setPhase('signed-out');
      },
      createRotationRequestId,
    );
    api.session = session;
    return { api, session };
  }, [profileStore]);

  const refreshProfile = useCallback(async () => {
    profileStore.set(await services.api.getProfile());
  }, [profileStore, services]);
  const restoreSession = useCallback(async () => {
    const result = await services.session.restore();
    if (result === 'signed-out') {
      setPhase('signed-out');
      return;
    }
    if (result === 'retry') {
      setPhase('session-retry');
      return;
    }
    setPhase('signed-in');
    try {
      await refreshProfile();
    } catch {
      /* Shell keeps a visible profile retry state. */
    }
  }, [refreshProfile, services]);
  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  const establish = async (
    response: Awaited<ReturnType<ApiClient['login']>>,
  ) => {
    await services.session.establish(response.session);
    setTerminalMessage(null);
    setPhase('signed-in');
    try {
      await refreshProfile();
    } catch {
      profileStore.set(null);
    }
  };

  const value: AppContextValue = {
    api: services.api,
    phase,
    profile,
    draftReporter,
    sessionRetryReason: services.session.retryState,
    terminalMessage,
    retrySession: async () => {
      setPhase('restoring');
      await restoreSession();
    },
    signIn: async (email, password) =>
      establish(await services.api.login(email, password)),
    signUp: async (email, password) =>
      services.api.requestRegistration(email, password),
    confirmSignUp: async (token) =>
      establish(await services.api.confirmRegistration(token)),
    signOut: async () => {
      const current = services.session.current;
      if (!current) return;
      await services.api.logout(current.refresh_token);
      await services.session.clear();
      profileStore.set(null);
      setPhase('signed-out');
    },
    refreshProfile,
    updateProfile: async (patch) => {
      const updated = await services.api.updateProfile(patch);
      profileStore.set(updated);
      return updated;
    },
    deleteAccount: async (password) => {
      await services.api.deleteAccount(password);
      await services.session.clear();
      profileStore.set(null);
      setPhase('signed-out');
    },
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppState(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('AppStateProvider is missing.');
  return value;
}
