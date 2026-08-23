import type { User } from '@trail/contracts';

export type ProfileLifecyclePhase = 'loading' | 'ready' | 'error';
export interface ProfileState {
  readonly phase: ProfileLifecyclePhase;
  readonly profile: User | null;
}
export type ProfileListener = () => void;

/** Production profile store shared by the app context and all shell screens. */
export class AppProfileStore {
  private state: ProfileState = { phase: 'loading', profile: null };
  private requestGeneration = 0;
  private readonly listeners = new Set<ProfileListener>();

  get = (): ProfileState => this.state;
  set = (profile: User): void => {
    this.requestGeneration += 1;
    this.publish({ phase: 'ready', profile });
  };
  clear = (): void => {
    this.requestGeneration += 1;
    this.publish({ phase: 'loading', profile: null });
  };
  async refresh(
    load: () => Promise<User>,
    sessionGeneration: number,
    isCurrentSession: (generation: number) => boolean,
  ): Promise<void> {
    const requestGeneration = ++this.requestGeneration;
    const expectedOwnerId = this.state.profile?.id ?? null;
    this.publish({ phase: 'loading', profile: this.state.profile });
    try {
      const profile = await load();
      if (
        requestGeneration !== this.requestGeneration ||
        !isCurrentSession(sessionGeneration) ||
        (expectedOwnerId !== null && profile.id !== expectedOwnerId)
      )
        return;
      this.publish({ phase: 'ready', profile });
    } catch (error) {
      if (
        requestGeneration === this.requestGeneration &&
        isCurrentSession(sessionGeneration)
      )
        this.publish({ phase: 'error', profile: this.state.profile });
      throw error;
    }
  }
  subscribe = (listener: ProfileListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(state: ProfileState): void {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
}
