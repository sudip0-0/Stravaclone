import * as Crypto from 'expo-crypto';

export function createRotationRequestId(): string {
  return Crypto.randomUUID();
}
