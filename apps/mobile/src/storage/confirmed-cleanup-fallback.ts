import * as SecureStore from 'expo-secure-store';

const CONFIRMED_CLEANUP_KEY = 'trail.confirmed-owner-cleanup.v1';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const options = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
} as const;

export interface ConfirmedCleanupFallbackStore {
  read(): Promise<string | null>;
  write(ownerUserId: string): Promise<void>;
  clear(ownerUserId: string): Promise<void>;
}

export class SecureConfirmedCleanupFallbackStore
  implements ConfirmedCleanupFallbackStore
{
  async read(): Promise<string | null> {
    const ownerUserId = await SecureStore.getItemAsync(
      CONFIRMED_CLEANUP_KEY,
      options,
    );
    return ownerUserId && UUID_PATTERN.test(ownerUserId) ? ownerUserId : null;
  }
  async write(ownerUserId: string): Promise<void> {
    if (!UUID_PATTERN.test(ownerUserId))
      throw new Error('Invalid cleanup owner identifier.');
    await SecureStore.setItemAsync(CONFIRMED_CLEANUP_KEY, ownerUserId, options);
  }
  async clear(ownerUserId: string): Promise<void> {
    if ((await this.read()) === ownerUserId)
      await SecureStore.deleteItemAsync(CONFIRMED_CLEANUP_KEY, options);
  }
}
