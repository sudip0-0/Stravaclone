import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/auth/crypto.js';

describe('Argon2 work bounds', () => {
  it('bounds both endpoint and global queued password work', async () => {
    const passwordHash = await hashPassword(
      'correct-horse',
      'account_deletion',
    );
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () =>
        verifyPassword(passwordHash, 'wrong-password', 'account_deletion'),
      ),
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected.length).toBeGreaterThanOrEqual(2);
    expect(
      rejected.every(
        (result) =>
          (result.reason as { code?: unknown }).code === 'service_unavailable',
      ),
    ).toBe(true);
  });
});
