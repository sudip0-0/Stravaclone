import type { User } from '@trail/contracts';

export type ProfileListener = () => void;

/** Production profile store shared by the app context and all shell screens. */
export class AppProfileStore {
  private profile: User | null = null;
  private readonly listeners = new Set<ProfileListener>();

  get = (): User | null => this.profile;
  set = (profile: User | null): void => {
    this.profile = profile;
    this.listeners.forEach((listener) => listener());
  };
  subscribe = (listener: ProfileListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}
