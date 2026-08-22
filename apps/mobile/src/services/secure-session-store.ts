import * as SecureStore from 'expo-secure-store';
import { sessionTokensSchema } from '@trail/contracts';
import type {
  PendingRotation,
  SessionStore,
  StoredSession,
} from './session-types';

const SESSION_KEY = 'trail.session.v1';
const PENDING_ROTATION_KEY = 'trail.session.pending-rotation.v1';
const options = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
} as const;

export class SecureSessionStore implements SessionStore {
  async read(): Promise<StoredSession | null> {
    const serialized = await SecureStore.getItemAsync(SESSION_KEY);
    if (!serialized) return null;
    try {
      const result = sessionTokensSchema.safeParse(JSON.parse(serialized));
      if (result.success) return result.data;
    } catch {
      // Corrupt secure data is removed without exposing its contents.
    }
    await this.clear();
    return null;
  }

  async write(session: StoredSession): Promise<void> {
    const valid = sessionTokensSchema.parse(session);
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(valid), options);
  }

  async clear(): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync(SESSION_KEY),
      this.clearPendingRotation(),
    ]);
  }

  async readPendingRotation(): Promise<PendingRotation | null> {
    const serialized = await SecureStore.getItemAsync(PENDING_ROTATION_KEY);
    if (!serialized) return null;
    try {
      const value = JSON.parse(serialized) as Partial<PendingRotation>;
      if (
        typeof value.rotationRequestId === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          value.rotationRequestId,
        ) &&
        typeof value.refreshToken === 'string' &&
        value.refreshToken.length > 0
      )
        return {
          rotationRequestId: value.rotationRequestId,
          refreshToken: value.refreshToken,
        };
    } catch {
      // Invalid pending metadata is safe to discard.
    }
    await this.clearPendingRotation();
    return null;
  }

  async writePendingRotation(pending: PendingRotation): Promise<void> {
    await SecureStore.setItemAsync(
      PENDING_ROTATION_KEY,
      JSON.stringify(pending),
      options,
    );
  }

  async clearPendingRotation(): Promise<void> {
    await SecureStore.deleteItemAsync(PENDING_ROTATION_KEY);
  }
}
