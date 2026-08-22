import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { hash, verify, type Algorithm } from '@node-rs/argon2';
import { jwtVerify, SignJWT } from 'jose';
import type { ApiConfig } from '../config.js';
import { ApplicationError } from '../http/application-error.js';

const accessTokenLifetimeSeconds = 15 * 60;
const argonConcurrency = 4;
const argonQueueLimit = 32;
const argonEndpointConcurrency = 2;
const argonEndpointQueueLimit = 8;
export type ArgonPurpose =
  | 'registration'
  | 'login'
  | 'password_reset'
  | 'account_deletion'
  | 'general';
let activeArgonOperations = 0;
const activeArgonByPurpose = new Map<ArgonPurpose, number>();
const argonWaiters: {
  readonly purpose: ArgonPurpose;
  readonly resolve: () => void;
}[] = [];

export interface AccessPrincipal {
  readonly userId: string;
  readonly authVersion: number;
}

export interface EncryptedValue {
  readonly ciphertext: string;
  readonly iv: string;
  readonly tag: string;
}

function argonBusy(): ApplicationError {
  return new ApplicationError({
    code: 'service_unavailable',
    statusCode: 503,
    publicMessage: 'Authentication is temporarily busy',
  });
}

function dispatchArgonWaiter(): void {
  if (activeArgonOperations >= argonConcurrency) return;
  const index = argonWaiters.findIndex(
    ({ purpose }) =>
      (activeArgonByPurpose.get(purpose) ?? 0) < argonEndpointConcurrency,
  );
  if (index < 0) return;
  const [waiter] = argonWaiters.splice(index, 1);
  activeArgonOperations += 1;
  activeArgonByPurpose.set(
    waiter!.purpose,
    (activeArgonByPurpose.get(waiter!.purpose) ?? 0) + 1,
  );
  waiter!.resolve();
}

async function withArgonSlot<T>(
  purpose: ArgonPurpose,
  operation: () => Promise<T>,
): Promise<T> {
  const activeForPurpose = activeArgonByPurpose.get(purpose) ?? 0;
  if (
    activeArgonOperations >= argonConcurrency ||
    activeForPurpose >= argonEndpointConcurrency
  ) {
    const queuedForPurpose = argonWaiters.filter(
      (waiter) => waiter.purpose === purpose,
    ).length;
    if (
      argonWaiters.length >= argonQueueLimit ||
      queuedForPurpose >= argonEndpointQueueLimit
    ) {
      throw argonBusy();
    }
    await new Promise<void>((resolve) =>
      argonWaiters.push({ purpose, resolve }),
    );
  } else {
    activeArgonOperations += 1;
    activeArgonByPurpose.set(purpose, activeForPurpose + 1);
  }
  try {
    return await operation();
  } finally {
    activeArgonOperations -= 1;
    activeArgonByPurpose.set(
      purpose,
      (activeArgonByPurpose.get(purpose) ?? 1) - 1,
    );
    dispatchArgonWaiter();
  }
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function hashPassword(
  password: string,
  purpose: ArgonPurpose = 'general',
): Promise<string> {
  return withArgonSlot(purpose, () =>
    hash(password, {
      algorithm: 2 as Algorithm,
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 1,
      outputLen: 32,
    }),
  );
}

export async function verifyPassword(
  passwordHash: string,
  password: string,
  purpose: ArgonPurpose = 'general',
): Promise<boolean> {
  try {
    return await withArgonSlot(purpose, () => verify(passwordHash, password));
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    return false;
  }
}

function decodeKey(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

export function encryptValue(
  plaintext: string,
  key: string,
  context: string,
): EncryptedValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', decodeKey(key), iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString('base64url'),
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
  };
}

export function decryptValue(
  encrypted: EncryptedValue,
  key: string,
  context: string,
): string {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    decodeKey(key),
    Buffer.from(encrypted.iv, 'base64url'),
  );
  decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function jwtKey(config: ApiConfig): Uint8Array {
  return decodeKey(config.JWT_SIGNING_KEY);
}

export async function signAccessToken(
  userId: string,
  authVersion: number,
  config: ApiConfig,
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expiresAt = new Date((issuedAt + accessTokenLifetimeSeconds) * 1000);
  const token = await new SignJWT({ ver: authVersion })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuer(config.JWT_ISSUER)
    .setAudience(config.JWT_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .setJti(randomUUID())
    .sign(jwtKey(config));
  return { token, expiresAt };
}

export async function verifyAccessToken(
  token: string,
  config: ApiConfig,
): Promise<AccessPrincipal> {
  try {
    const { payload, protectedHeader } = await jwtVerify(
      token,
      jwtKey(config),
      {
        algorithms: ['HS256'],
        issuer: config.JWT_ISSUER,
        audience: config.JWT_AUDIENCE,
      },
    );
    if (
      protectedHeader.typ !== 'JWT' ||
      !payload.sub ||
      !Number.isSafeInteger(payload.ver) ||
      (payload.ver as number) < 0
    ) {
      throw new Error('Invalid JWT');
    }
    return { userId: payload.sub, authVersion: payload.ver as number };
  } catch {
    throw new ApplicationError({
      code: 'unauthorized',
      statusCode: 401,
      publicMessage: 'Authentication required',
    });
  }
}
