import type { AuthResponse, ErrorEnvelope, User } from '@trail/contracts';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { signAccessToken } from '../src/auth/crypto.js';
import { cleanupAuthArtifacts, drainEmailOutbox } from '../src/auth/service.js';
import type { DependencyStatus, Providers } from '../src/providers/ports.js';
import { testConfig } from './fixtures.js';

const baseDatabaseUrl = process.env.TEST_DATABASE_URL;
if (process.env.CI === 'true' && !baseDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL is required for database tests in CI');
}
const describeWithPostgres = baseDatabaseUrl ? describe : describe.skip;
const migrationsFolder = fileURLToPath(
  new URL('../src/db/migrations', import.meta.url),
);

describeWithPostgres('Phase 2 authentication and profile API', () => {
  const databaseName = `trail_auth_test_${process.pid}_${Date.now()}`;
  let admin: ReturnType<typeof postgres>;
  let sql: ReturnType<typeof postgres>;
  let app: ReturnType<typeof buildApp>;
  let providers: Providers;
  let failEmail = false;
  const messages: { to: string; text: string }[] = [];

  beforeAll(async () => {
    const adminUrl = new URL(baseDatabaseUrl!);
    admin = postgres(adminUrl.toString(), {
      max: 1,
      onnotice: () => undefined,
    });
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    adminUrl.pathname = `/${databaseName}`;
    sql = postgres(adminUrl.toString(), { max: 8, onnotice: () => undefined });
    await migrate(drizzle(sql), { migrationsFolder });
    const checkHealth = async (): Promise<DependencyStatus> => 'up';
    const disabledVerifier = {
      enabled: false,
      verify: async () => Promise.reject(new Error('disabled')),
    };
    providers = {
      database: { sql, checkHealth },
      identity: { apple: disabledVerifier, google: disabledVerifier },
      objectStorage: {
        bucket: 'test',
        checkHealth,
        presignPost: async () => ({
          url: 'https://example.test/upload',
          fields: {},
        }),
        presignGet: async () => 'https://example.test/download',
        head: async () => null,
        get: async () => Readable.from([]),
        put: async () => undefined,
        delete: async () => undefined,
      },
      email: {
        enabled: true,
        checkHealth,
        send: async (message) => {
          if (failEmail) throw new Error('SMTP unavailable');
          messages.push({ to: message.to, text: message.text });
        },
      },
      mapStyle: { styleUrl: 'https://example.test/style.json' },
      elevation: {
        getElevations: async ({ points }) => ({
          elevationsM: points.map(() => null),
        }),
      },
      routing: { route: async () => Promise.reject(new Error('disabled')) },
      telemetry: { captureException: () => undefined },
      close: async () => undefined,
    };
    app = buildApp({ config: testConfig, providers, logger: false });
    await app.ready();
  });

  beforeEach(async () => {
    messages.length = 0;
    failEmail = false;
    await app.close();
    app = buildApp({ config: testConfig, providers, logger: false });
    await app.ready();
    await sql`truncate trail.users, trail.object_deletion_outbox, trail.email_outbox cascade`;
  });

  afterAll(async () => {
    if (!baseDatabaseUrl) return;
    await app.close();
    await sql.end();
    await admin.unsafe(`DROP DATABASE "${databaseName}"`);
    await admin.end();
  });

  function emailTokenFromMessage(): string {
    const match = messages.at(-1)?.text.match(/[A-Za-z0-9_-]{43}/);
    if (!match) throw new Error('Verification token missing from email');
    return match[0];
  }

  async function register(email = 'athlete@example.com') {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { email, password: 'correct-horse', display_name: 'Athlete' },
    });
    expect(response.statusCode, response.body).toBe(202);
    await drainEmailOutbox(providers, testConfig);
    const token = emailTokenFromMessage();
    const confirmed = await app.inject({
      method: 'POST',
      url: '/v1/auth/register/confirm',
      payload: { token },
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    messages.length = 0;
    return confirmed.json<AuthResponse>();
  }

  it('uses identical accepted registration responses and creates only verified accounts', async () => {
    const request = {
      method: 'POST' as const,
      url: '/v1/auth/register',
      payload: {
        email: 'ATHLETE@EXAMPLE.COM',
        password: 'correct-horse',
        display_name: 'Athlete',
      },
    };
    const first = await app.inject(request);
    expect(first.statusCode).toBe(202);
    expect(first.json()).toEqual({ accepted: true });
    expect((await sql`select 1 from trail.users`).count).toBe(0);
    const pending = await sql<
      { email: string; password_hash: string; token_hash: string }[]
    >`select email, password_hash, token_hash from trail.registration_verifications`;
    expect(pending[0]!.email).toBe('athlete@example.com');
    expect(pending[0]!.password_hash).toMatch(/^\$argon2id\$/);
    expect(pending[0]!.password_hash).not.toContain('correct-horse');
    expect(pending[0]!.token_hash).toHaveLength(64);

    await drainEmailOutbox(providers, testConfig);
    const token = emailTokenFromMessage();
    expect(JSON.stringify(pending)).not.toContain(token);
    const confirmed = await app.inject({
      method: 'POST',
      url: '/v1/auth/register/confirm',
      payload: { token },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/auth/register/confirm',
          payload: { token },
        })
      ).statusCode,
    ).toBe(401);

    messages.length = 0;
    const existing = await app.inject(request);
    expect(existing.statusCode).toBe(202);
    expect(existing.json()).toEqual(first.json());
    await drainEmailOutbox(providers, testConfig);
    expect(messages).toHaveLength(0);
    const user = await sql<{ email: string; display_name: string }[]>`
      select email, display_name from trail.users
    `;
    expect(user).toEqual([
      { email: 'athlete@example.com', display_name: 'Athlete' },
    ]);
  });

  it('rejects expired registration verification without creating an account', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        email: 'expired@example.com',
        password: 'correct-horse',
        display_name: 'Expired',
      },
    });
    await drainEmailOutbox(providers, testConfig);
    const token = emailTokenFromMessage();
    await sql`
      update trail.registration_verifications
      set created_at = now() - interval '2 hours',
          expires_at = now() - interval '1 hour'
    `;
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/register/confirm',
      payload: { token },
    });
    expect(response.statusCode).toBe(401);
    expect((await sql`select 1 from trail.users`).count).toBe(0);
  });

  it('uses privacy-safe login failures and validates access expiry', async () => {
    const created = await register();
    for (const email of ['missing@example.com', 'athlete@example.com']) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email, password: 'wrong-password' },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json<ErrorEnvelope>().error.code).toBe(
        'invalid_credentials',
      );
    }
    const own = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${created.session.access_token}` },
    });
    expect(own.json<User>().id).toBe(created.user_id);
    const expired = await signAccessToken(
      created.user_id,
      0,
      testConfig,
      new Date(Date.now() - 20 * 60 * 1000),
    );
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/v1/me',
          headers: { authorization: `Bearer ${expired.token}` },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('recovers the same successor after days until that successor is consumed', async () => {
    const created = await register();
    const requestId = randomUUID();
    const first = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: {
        refresh_token: created.session.refresh_token,
        rotation_request_id: requestId,
      },
    });
    const successor = first.json<AuthResponse>().session.refresh_token;
    await sql`
      update trail.refresh_tokens set created_at = now() - interval '6 days'
    `;
    await sql`
      update trail.refresh_tokens set consumed_at = now() - interval '5 days'
      where sequence = 0
    `;
    const delayedRetry = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: {
        refresh_token: created.session.refresh_token,
        rotation_request_id: requestId,
      },
    });
    expect(delayedRetry.statusCode).toBe(200);
    expect(delayedRetry.json<AuthResponse>().session.refresh_token).toBe(
      successor,
    );
    const successorUse = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: {
        refresh_token: successor,
        rotation_request_id: randomUUID(),
      },
    });
    expect(successorUse.statusCode).toBe(200);
    const predecessor = await sql<
      {
        successor_ciphertext: string | null;
        successor_token_id: string | null;
      }[]
    >`
      select successor_ciphertext, successor_token_id
      from trail.refresh_tokens where sequence = 0
    `;
    expect(predecessor[0]).toEqual({
      successor_ciphertext: null,
      successor_token_id: null,
    });
    const oldReuse = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: {
        refresh_token: created.session.refresh_token,
        rotation_request_id: requestId,
      },
    });
    expect(oldReuse.statusCode).toBe(401);
    const family = await sql<{ revoked_at: string | null }[]>`
      select revoked_at from trail.refresh_token_families
    `;
    expect(family[0]!.revoked_at).not.toBeNull();
    const stored = await sql<
      { token_hash: string; successor_ciphertext: string | null }[]
    >`select token_hash, successor_ciphertext from trail.refresh_tokens`;
    expect(stored.every((row) => row.token_hash.length === 64)).toBe(true);
    expect(JSON.stringify(stored)).not.toContain(successor);
  });

  it('revokes the family for attacker reuse with a different request ID', async () => {
    const created = await register();
    const first = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: {
        refresh_token: created.session.refresh_token,
        rotation_request_id: randomUUID(),
      },
    });
    const successor = first.json<AuthResponse>().session.refresh_token;
    const attacker = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: {
        refresh_token: created.session.refresh_token,
        rotation_request_id: randomUUID(),
      },
    });
    expect(attacker.statusCode).toBe(401);
    const revoked = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refresh_token: successor, rotation_request_id: randomUUID() },
    });
    expect(revoked.statusCode).toBe(401);
  });

  it('handles concurrent different-ID rotation as reuse and revokes the family', async () => {
    const created = await register();
    const responses = await Promise.all(
      [randomUUID(), randomUUID()].map((rotation_request_id) =>
        app.inject({
          method: 'POST',
          url: '/v1/auth/refresh',
          payload: {
            refresh_token: created.session.refresh_token,
            rotation_request_id,
          },
        }),
      ),
    );
    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      200, 401,
    ]);
    const family = await sql<{ revoked_at: string | null }[]>`
      select revoked_at from trail.refresh_token_families where user_id = ${created.user_id}
    `;
    expect(family[0]!.revoked_at).not.toBeNull();
  });

  it('logout of a consumed token revokes and increments auth version only once', async () => {
    const created = await register();
    await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: {
        refresh_token: created.session.refresh_token,
        rotation_request_id: randomUUID(),
      },
    });
    const logoutRequest = {
      method: 'POST' as const,
      url: '/v1/auth/logout',
      payload: { refresh_token: created.session.refresh_token },
    };
    expect((await app.inject(logoutRequest)).statusCode).toBe(204);
    const firstVersion = await sql<{ auth_version: number }[]>`
      select auth_version from trail.users where id = ${created.user_id}
    `;
    expect(firstVersion[0]!.auth_version).toBe(1);
    expect((await app.inject(logoutRequest)).statusCode).toBe(204);
    const replayVersion = await sql<{ auth_version: number }[]>`
      select auth_version from trail.users where id = ${created.user_id}
    `;
    expect(replayVersion[0]!.auth_version).toBe(1);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/v1/me',
          headers: { authorization: `Bearer ${created.session.access_token}` },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('queues indistinguishable encrypted reset work and retries SMTP without blocking requests', async () => {
    await register();
    const known = await app.inject({
      method: 'POST',
      url: '/v1/auth/password-reset/request',
      payload: { email: 'athlete@example.com' },
    });
    const unknown = await app.inject({
      method: 'POST',
      url: '/v1/auth/password-reset/request',
      payload: { email: 'missing@example.com' },
    });
    expect(known.statusCode).toBe(202);
    expect(known.json()).toEqual(unknown.json());
    expect(messages).toHaveLength(0);
    const queued = await sql<
      { should_deliver: boolean; payload_ciphertext: string }[]
    >`
      select should_deliver, payload_ciphertext from trail.email_outbox
      where purpose <> 'registration' order by created_at
    `;
    expect(queued).toHaveLength(2);
    expect(queued.map((row) => row.should_deliver).sort()).toEqual([
      false,
      true,
    ]);
    expect(JSON.stringify(queued)).not.toContain('athlete@example.com');

    failEmail = true;
    await drainEmailOutbox(providers, testConfig);
    expect(messages).toHaveLength(0);
    await sql`update trail.email_outbox set next_attempt_at = now() where status = 'pending'`;
    failEmail = false;
    await drainEmailOutbox(providers, testConfig);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.text).not.toContain('http');
    const deliveredToken = emailTokenFromMessage();
    expect(messages[0]!.text).toContain(deliveredToken);
    const persisted = await sql<
      { token_hash: string; payload_ciphertext: string }[]
    >`
      select r.token_hash, o.payload_ciphertext
      from trail.password_reset_tokens r
      join trail.email_outbox o on o.reset_token_id = r.id
    `;
    expect(persisted[0]!.token_hash).toHaveLength(64);
    expect(JSON.stringify(persisted)).not.toContain(deliveredToken);
    expect(
      (await sql`select 1 from trail.email_outbox where purpose = 'tombstone'`)
        .count,
    ).toBe(0);
    await sql`
      update trail.email_outbox
      set status = case when purpose = 'registration' then 'dead' else 'delivered' end,
        updated_at = now() - interval '25 hours'
    `;
    await cleanupAuthArtifacts(providers);
    expect((await sql`select 1 from trail.email_outbox`).count).toBe(0);
  });

  it('keeps the prior reset usable until replacement delivery and enforces one use, expiry, and access invalidation', async () => {
    const created = await register();
    await app.inject({
      method: 'POST',
      url: '/v1/auth/password-reset/request',
      payload: { email: 'athlete@example.com' },
    });
    await drainEmailOutbox(providers, testConfig);
    const firstToken = emailTokenFromMessage();
    await app.inject({
      method: 'POST',
      url: '/v1/auth/password-reset/request',
      payload: { email: 'athlete@example.com' },
    });
    const confirmed = await app.inject({
      method: 'POST',
      url: '/v1/auth/password-reset/confirm',
      payload: { token: firstToken, password: 'new-password' },
    });
    expect(confirmed.statusCode).toBe(204);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/v1/me',
          headers: { authorization: `Bearer ${created.session.access_token}` },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/auth/password-reset/confirm',
          payload: { token: firstToken, password: 'other-password' },
        })
      ).statusCode,
    ).toBe(401);

    await app.inject({
      method: 'POST',
      url: '/v1/auth/password-reset/request',
      payload: { email: 'athlete@example.com' },
    });
    await drainEmailOutbox(providers, testConfig);
    const expiredToken = emailTokenFromMessage();
    await sql`
      update trail.password_reset_tokens set created_at = now() - interval '2 hours',
        expires_at = now() - interval '1 hour'
      where consumed_at is null
    `;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/auth/password-reset/confirm',
          payload: { token: expiredToken, password: 'other-password' },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('validates profile ownership and requires current password for deletion', async () => {
    const created = await register();
    const updated = await app.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: { authorization: `Bearer ${created.session.access_token}` },
      payload: { units: 'imperial', default_sport: 'hike' },
    });
    expect(updated.json<User>()).toMatchObject({
      id: created.user_id,
      units: 'imperial',
      default_sport: 'hike',
    });
    const wrong = await app.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: { authorization: `Bearer ${created.session.access_token}` },
      payload: { confirmation: 'DELETE', password: 'wrong-password' },
    });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json<ErrorEnvelope>().error.code).toBe('step_up_failed');
    const deleted = await app.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: { authorization: `Bearer ${created.session.access_token}` },
      payload: { confirmation: 'DELETE', password: 'correct-horse' },
    });
    expect(deleted.statusCode).toBe(204);

    const ssoUsers = await sql<{ id: string }[]>`
      insert into trail.users (email, display_name)
      values ('relay@privaterelay.appleid.com', 'Relay') returning id
    `;
    await sql`
      insert into trail.auth_identities (user_id, provider, provider_subject)
      values (${ssoUsers[0]!.id}, 'apple', 'blocked-subject')
    `;
    const ssoAccess = await signAccessToken(ssoUsers[0]!.id, 0, testConfig);
    const blocked = await app.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: { authorization: `Bearer ${ssoAccess.token}` },
      payload: { confirmation: 'DELETE', password: 'irrelevant' },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json<ErrorEnvelope>().error.code).toBe('step_up_required');
  });

  it('layers per-IP and per-user deletion attempt limits', async () => {
    const created = await register();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      statuses.push(
        (
          await app.inject({
            method: 'DELETE',
            url: '/v1/me',
            headers: {
              authorization: `Bearer ${created.session.access_token}`,
            },
            payload: {
              confirmation: 'DELETE',
              password: `wrong-password-${attempt}`,
            },
          })
        ).statusCode,
      );
    }
    expect(statuses).toEqual([403, 403, 403, 403, 403, 429]);
  });

  it('keeps all SSO sign-in and linking routes disabled', async () => {
    await register();
    for (const path of [
      '/v1/auth/apple',
      '/v1/auth/google',
      '/v1/auth/apple/link',
      '/v1/auth/google/link',
    ]) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: path,
            payload: { identity_token: 'token', nonce: '0123456789abcdef' },
          })
        ).statusCode,
      ).toBe(404);
    }
    expect(
      (
        await sql`select 1 from trail.auth_identities where provider <> 'password'`
      ).count,
    ).toBe(0);
  });
});
