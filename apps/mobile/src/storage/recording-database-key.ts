import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const DATABASE_KEY_NAME = 'trail.recording-database-key.v1';
const DATABASE_KEY_PATTERN = /^[0-9a-f]{64}$/;
const keyOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
} as const;

export async function getOrCreateRecordingDatabaseKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(
    DATABASE_KEY_NAME,
    keyOptions,
  );
  if (existing && DATABASE_KEY_PATTERN.test(existing)) return existing;
  const bytes = await Crypto.getRandomBytesAsync(32);
  const generated = Array.from(bytes, (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('');
  await SecureStore.setItemAsync(DATABASE_KEY_NAME, generated, keyOptions);
  return generated;
}
