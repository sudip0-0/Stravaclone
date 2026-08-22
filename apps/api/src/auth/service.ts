import { randomUUID } from 'node:crypto';
import type {
  AuthProvider,
  AuthResponse,
  LoginRequest,
  RegisterConfirmRequest,
  RegisterRequest,
  SessionTokens,
  UpdateUserRequest,
  User,
} from '@trail/contracts';
import type { Sql, TransactionSql } from 'postgres';
import type { ApiConfig } from '../config.js';
import { ApplicationError } from '../http/application-error.js';
import type { Providers } from '../providers/ports.js';
import {
  createOpaqueToken,
  decryptValue,
  encryptValue,
  hashOpaqueToken,
  hashPassword,
  signAccessToken,
  verifyPassword,
  type EncryptedValue,
} from './crypto.js';

const refreshLifetimeMs = 30 * 24 * 60 * 60 * 1000;
const registrationVerificationLifetimeMs = 60 * 60 * 1000;
const resetLifetimeMs = 60 * 60 * 1000;
const maximumEmailAttempts = 5;
const dummyPasswordHash = hashPassword('not-a-real-password-value');

type Queryable = Sql | TransactionSql;
type DatabaseTimestamp = Date | string;

function asDate(value: DatabaseTimestamp): Date {
  return value instanceof Date ? value : new Date(value);
}

interface UserRow {
  id: string;
  email: string | null;
  password_hash: string | null;
  display_name: string;
  avatar_url: string | null;
  units: 'metric' | 'imperial';
  default_sport: 'run' | 'ride' | 'walk' | 'hike';
  auth_version: number;
  created_at: DatabaseTimestamp;
  updated_at: DatabaseTimestamp;
}

interface EmailPayload {
  readonly to: string;
  readonly token: string;
  readonly purpose: 'registration' | 'password_reset';
}

function sqlProvider(providers: Providers): Sql {
  if (!providers.database.sql) {
    throw new ApplicationError({
      code: 'service_unavailable',
      statusCode: 503,
      publicMessage: 'Service unavailable',
    });
  }
  return providers.database.sql;
}

function authFailed(): ApplicationError {
  return new ApplicationError({
    code: 'invalid_credentials',
    statusCode: 401,
    publicMessage: 'Authentication failed',
  });
}

async function createSession(
  sql: Queryable,
  userId: string,
  authVersion: number,
  config: ApiConfig,
  deviceHint?: string,
): Promise<SessionTokens> {
  const now = new Date();
  const refreshExpiresAt = new Date(now.getTime() + refreshLifetimeMs);
  const refreshToken = createOpaqueToken();
  const families = await sql<{ id: string }[]>`
    insert into trail.refresh_token_families (user_id, device_hint, expires_at)
    values (${userId}, ${deviceHint ?? null}, ${refreshExpiresAt.toISOString()})
    returning id
  `;
  await sql`
    insert into trail.refresh_tokens (family_id, sequence, token_hash, expires_at)
    values (${families[0]!.id}, 0, ${hashOpaqueToken(refreshToken)}, ${refreshExpiresAt.toISOString()})
  `;
  const access = await signAccessToken(userId, authVersion, config, now);
  return {
    access_token: access.token,
    access_token_expires_at: access.expiresAt.toISOString(),
    refresh_token: refreshToken,
    refresh_token_expires_at: refreshExpiresAt.toISOString(),
    token_type: 'Bearer',
  };
}

export async function requestRegistration(
  providers: Providers,
  config: ApiConfig,
  request: RegisterRequest,
): Promise<void> {
  const sql = sqlProvider(providers);
  const passwordHash = await hashPassword(request.password, 'registration');
  const token = createOpaqueToken();
  const verificationId = randomUUID();
  const outboxId = randomUUID();
  const expiresAt = new Date(Date.now() + registrationVerificationLifetimeMs);
  const delivery = encryptValue(
    JSON.stringify({
      to: request.email,
      token,
      purpose: 'registration',
    } satisfies EmailPayload),
    config.EMAIL_OUTBOX_KEY,
    `email-outbox:${outboxId}`,
  );
  const tombstone = encryptValue(
    JSON.stringify({ tombstone: createOpaqueToken() }),
    config.EMAIL_OUTBOX_KEY,
    `email-outbox:${outboxId}`,
  );
  await sql`
    with existing as (
      select 1 from trail.users where lower(email) = ${request.email} limit 1
    ), verification as (
      insert into trail.registration_verifications (
        id, email, password_hash, display_name, token_hash, expires_at
      )
      select ${verificationId}::uuid, ${request.email}, ${passwordHash},
        ${request.display_name}, ${hashOpaqueToken(token)},
        ${expiresAt.toISOString()}::timestamptz
      where not exists (select 1 from existing)
      returning id
    )
    insert into trail.email_outbox (
      id, registration_verification_id, purpose, should_deliver,
      payload_ciphertext, payload_iv, payload_tag
    )
    select ${outboxId}::uuid, verification.id, 'registration', true,
      ${delivery.ciphertext}, ${delivery.iv}, ${delivery.tag}
    from verification
    union all
    select ${outboxId}::uuid, null::uuid, 'tombstone', false,
      ${tombstone.ciphertext}, ${tombstone.iv}, ${tombstone.tag}
    where not exists (select 1 from verification)
  `;
}

export async function confirmRegistration(
  providers: Providers,
  config: ApiConfig,
  request: RegisterConfirmRequest,
): Promise<AuthResponse> {
  const sql = sqlProvider(providers);
  const result = await sql.begin(async (transaction) => {
    const rows = await transaction<
      {
        id: string;
        email: string;
        password_hash: string;
        display_name: string;
        expires_at: DatabaseTimestamp;
        consumed_at: DatabaseTimestamp | null;
      }[]
    >`
      select id, email, password_hash, display_name, expires_at, consumed_at
      from trail.registration_verifications
      where token_hash = ${hashOpaqueToken(request.token)} for update
    `;
    const pending = rows[0];
    const now = new Date();
    if (!pending || pending.consumed_at || asDate(pending.expires_at) <= now)
      return null;
    await transaction`
      update trail.registration_verifications set consumed_at = ${now.toISOString()}
      where id = ${pending.id}
    `;
    const users = await transaction<{ id: string; auth_version: number }[]>`
      insert into trail.users (email, password_hash, display_name)
      values (${pending.email}, ${pending.password_hash}, ${pending.display_name})
      on conflict do nothing returning id, auth_version
    `;
    if (!users[0]) return null;
    await transaction`
      insert into trail.auth_identities (user_id, provider, provider_subject)
      values (${users[0].id}, 'password', ${pending.email})
    `;
    return {
      user_id: users[0].id,
      session: await createSession(
        transaction,
        users[0].id,
        users[0].auth_version,
        config,
        request.device_hint,
      ),
    };
  });
  if (!result) throw authFailed();
  return result;
}

export async function login(
  providers: Providers,
  config: ApiConfig,
  request: LoginRequest,
): Promise<AuthResponse> {
  const sql = sqlProvider(providers);
  const rows = await sql<
    Pick<UserRow, 'id' | 'password_hash' | 'auth_version'>[]
  >`
    select id, password_hash, auth_version from trail.users
    where lower(email) = ${request.email} limit 1
  `;
  const row = rows[0];
  const valid = await verifyPassword(
    row?.password_hash ?? (await dummyPasswordHash),
    request.password,
    'login',
  );
  if (!row?.password_hash || !valid) throw authFailed();
  return {
    user_id: row.id,
    session: await createSession(
      sql,
      row.id,
      row.auth_version,
      config,
      request.device_hint,
    ),
  };
}

interface RefreshRow {
  id: string;
  family_id: string;
  sequence: number;
  token_expires_at: DatabaseTimestamp;
  family_expires_at: DatabaseTimestamp;
  revoked_at: DatabaseTimestamp | null;
  consumed_at: DatabaseTimestamp | null;
  user_id: string;
  auth_version: number;
  rotation_request_hash: string | null;
  successor_ciphertext: string | null;
  successor_iv: string | null;
  successor_tag: string | null;
  successor_token_id: string | null;
  successor_consumed_at: DatabaseTimestamp | null;
  successor_revoked_at: DatabaseTimestamp | null;
  successor_expires_at: DatabaseTimestamp | null;
}

async function revokeFamily(
  transaction: TransactionSql,
  familyId: string,
  now: Date,
): Promise<void> {
  await transaction`
    update trail.refresh_token_families
    set revoked_at = coalesce(revoked_at, ${now.toISOString()})
    where id = ${familyId}
  `;
  await transaction`
    update trail.refresh_tokens
    set revoked_at = coalesce(revoked_at, ${now.toISOString()}),
        rotation_request_hash = null, successor_ciphertext = null,
        successor_iv = null, successor_tag = null, successor_token_id = null
    where family_id = ${familyId}
  `;
}

async function refreshResponse(
  userId: string,
  authVersion: number,
  refreshToken: string,
  refreshExpiresAt: Date,
  config: ApiConfig,
  now: Date,
): Promise<AuthResponse> {
  const access = await signAccessToken(userId, authVersion, config, now);
  return {
    user_id: userId,
    session: {
      access_token: access.token,
      access_token_expires_at: access.expiresAt.toISOString(),
      refresh_token: refreshToken,
      refresh_token_expires_at: refreshExpiresAt.toISOString(),
      token_type: 'Bearer',
    },
  };
}

export async function refreshSession(
  providers: Providers,
  config: ApiConfig,
  refreshToken: string,
  rotationRequestId: string,
): Promise<AuthResponse> {
  const sql = sqlProvider(providers);
  const requestHash = hashOpaqueToken(rotationRequestId);
  const result = await sql.begin(async (transaction) => {
    const rows = await transaction<RefreshRow[]>`
      select t.id, t.family_id, t.sequence,
             t.expires_at as token_expires_at, t.consumed_at,
             t.rotation_request_hash, t.successor_ciphertext,
             t.successor_iv, t.successor_tag, t.successor_token_id,
             s.consumed_at as successor_consumed_at,
             s.revoked_at as successor_revoked_at,
             s.expires_at as successor_expires_at,
             f.expires_at as family_expires_at, f.revoked_at, f.user_id,
             u.auth_version
      from trail.refresh_tokens t
      join trail.refresh_token_families f on f.id = t.family_id
      join trail.users u on u.id = f.user_id
      left join trail.refresh_tokens s on s.id = t.successor_token_id
      where t.token_hash = ${hashOpaqueToken(refreshToken)}
      for update of t, f
    `;
    const row = rows[0];
    const now = new Date();
    if (!row) return null;

    if (row.consumed_at) {
      const recoverable =
        row.rotation_request_hash === requestHash &&
        row.successor_token_id !== null &&
        row.successor_ciphertext !== null &&
        row.successor_iv !== null &&
        row.successor_tag !== null &&
        row.successor_consumed_at === null &&
        row.successor_revoked_at === null &&
        row.successor_expires_at !== null &&
        asDate(row.successor_expires_at) > now &&
        !row.revoked_at;
      if (!recoverable) {
        await revokeFamily(transaction, row.family_id, now);
        return null;
      }
      const successor = decryptValue(
        {
          ciphertext: row.successor_ciphertext!,
          iv: row.successor_iv!,
          tag: row.successor_tag!,
        },
        config.REFRESH_RECOVERY_KEY,
        `refresh:${row.id}:${requestHash}`,
      );
      return refreshResponse(
        row.user_id,
        row.auth_version,
        successor,
        asDate(row.family_expires_at),
        config,
        now,
      );
    }

    if (
      row.revoked_at ||
      asDate(row.token_expires_at) <= now ||
      asDate(row.family_expires_at) <= now
    ) {
      return null;
    }

    const successor = createOpaqueToken();
    const successorTokenId = randomUUID();
    const encrypted = encryptValue(
      successor,
      config.REFRESH_RECOVERY_KEY,
      `refresh:${row.id}:${requestHash}`,
    );
    await transaction`
      update trail.refresh_tokens set
        rotation_request_hash = null, successor_ciphertext = null,
        successor_iv = null, successor_tag = null, successor_token_id = null
      where successor_token_id = ${row.id}
    `;
    await transaction`
      insert into trail.refresh_tokens (
        id, family_id, sequence, token_hash, expires_at
      ) values (
        ${successorTokenId}, ${row.family_id}, ${row.sequence + 1},
        ${hashOpaqueToken(successor)}, ${asDate(row.family_expires_at).toISOString()}
      )
    `;
    await transaction`
      update trail.refresh_tokens set
        consumed_at = ${now.toISOString()},
        rotation_request_hash = ${requestHash},
        successor_ciphertext = ${encrypted.ciphertext},
        successor_iv = ${encrypted.iv},
        successor_tag = ${encrypted.tag},
        successor_token_id = ${successorTokenId}
      where id = ${row.id} and consumed_at is null
    `;
    return refreshResponse(
      row.user_id,
      row.auth_version,
      successor,
      asDate(row.family_expires_at),
      config,
      now,
    );
  });
  if (!result) throw authFailed();
  return result;
}

export async function logout(
  providers: Providers,
  refreshToken: string,
): Promise<void> {
  const sql = sqlProvider(providers);
  await sql.begin(async (transaction) => {
    const rows = await transaction<{ family_id: string; user_id: string }[]>`
      select t.family_id, f.user_id from trail.refresh_tokens t
      join trail.refresh_token_families f on f.id = t.family_id
      where t.token_hash = ${hashOpaqueToken(refreshToken)}
      for update of t, f
    `;
    if (!rows[0]) return;
    const now = new Date();
    const newlyRevoked = await transaction<{ user_id: string }[]>`
      update trail.refresh_token_families
      set revoked_at = ${now.toISOString()}
      where id = ${rows[0].family_id} and revoked_at is null
      returning user_id
    `;
    if (!newlyRevoked[0]) return;
    await transaction`
      update trail.refresh_tokens
      set revoked_at = coalesce(revoked_at, ${now.toISOString()}),
          rotation_request_hash = null, successor_ciphertext = null,
          successor_iv = null, successor_tag = null, successor_token_id = null
      where family_id = ${rows[0].family_id}
    `;
    await transaction`
      update trail.users set auth_version = auth_version + 1,
        updated_at = ${now.toISOString()} where id = ${newlyRevoked[0].user_id}
    `;
  });
}

export async function requestPasswordReset(
  providers: Providers,
  config: ApiConfig,
  email: string,
): Promise<void> {
  const sql = sqlProvider(providers);
  const resetToken = createOpaqueToken();
  const resetTokenId = randomUUID();
  const outboxId = randomUUID();
  const expiresAt = new Date(Date.now() + resetLifetimeMs);
  const knownPayload = encryptValue(
    JSON.stringify({
      to: email,
      token: resetToken,
      purpose: 'password_reset',
    } satisfies EmailPayload),
    config.EMAIL_OUTBOX_KEY,
    `email-outbox:${outboxId}`,
  );
  const tombstonePayload = encryptValue(
    JSON.stringify({ tombstone: createOpaqueToken() }),
    config.EMAIL_OUTBOX_KEY,
    `email-outbox:${outboxId}`,
  );
  await sql`
    with account as (
      select id from trail.users
      where lower(email) = ${email} and password_hash is not null limit 1
    ), inserted_token as (
      insert into trail.password_reset_tokens (id, user_id, token_hash, expires_at)
      select ${resetTokenId}::uuid, id, ${hashOpaqueToken(resetToken)}, ${expiresAt.toISOString()}::timestamptz
      from account returning id
    )
    insert into trail.email_outbox (
      id, user_id, reset_token_id, purpose, should_deliver,
      payload_ciphertext, payload_iv, payload_tag
    )
    select ${outboxId}::uuid, account.id, inserted_token.id,
      'password_reset', true,
      ${knownPayload.ciphertext}, ${knownPayload.iv}, ${knownPayload.tag}
    from account join inserted_token on true
    union all
    select ${outboxId}::uuid, null::uuid, null::uuid, 'tombstone', false,
      ${tombstonePayload.ciphertext}, ${tombstonePayload.iv}, ${tombstonePayload.tag}
    where not exists (select 1 from account)
  `;
}

interface OutboxRow {
  id: string;
  user_id: string | null;
  reset_token_id: string | null;
  registration_verification_id: string | null;
  purpose: 'registration' | 'password_reset' | 'tombstone';
  should_deliver: boolean;
  payload_ciphertext: string;
  payload_iv: string;
  payload_tag: string;
  attempt_count: number;
}

function encryptedOutboxPayload(row: OutboxRow): EncryptedValue {
  return {
    ciphertext: row.payload_ciphertext,
    iv: row.payload_iv,
    tag: row.payload_tag,
  };
}

export async function drainEmailOutbox(
  providers: Providers,
  config: ApiConfig,
  limit = 10,
): Promise<number> {
  const sql = sqlProvider(providers);
  const rows = await sql.begin(async (transaction) => {
    const claimed = await transaction<OutboxRow[]>`
      select id, user_id, reset_token_id, registration_verification_id,
             purpose, should_deliver, payload_ciphertext, payload_iv,
             payload_tag, attempt_count
      from trail.email_outbox
      where status = 'pending' and next_attempt_at <= now()
        and attempt_count < ${maximumEmailAttempts}
      order by created_at
      limit ${Math.max(1, Math.min(limit, 100))}
      for update skip locked
    `;
    for (const row of claimed) {
      await transaction`
        update trail.email_outbox set attempt_count = attempt_count + 1,
          next_attempt_at = now() + interval '5 minutes', updated_at = now()
        where id = ${row.id}
      `;
    }
    return claimed;
  });

  for (const row of rows) {
    if (!row.should_deliver) {
      await sql`delete from trail.email_outbox where id = ${row.id}`;
      continue;
    }
    try {
      const payload = JSON.parse(
        decryptValue(
          encryptedOutboxPayload(row),
          config.EMAIL_OUTBOX_KEY,
          `email-outbox:${row.id}`,
        ),
      ) as EmailPayload;
      const registration = payload.purpose === 'registration';
      await providers.email.send({
        to: payload.to,
        subject: registration
          ? 'Verify your Trail registration'
          : 'Reset your Trail password',
        text: registration
          ? `Your Trail registration verification token is:\n\n${payload.token}\n\nThis token expires in one hour.`
          : `Your Trail password reset token is:\n\n${payload.token}\n\nThis token expires in one hour.`,
      });
      await sql.begin(async (transaction) => {
        await transaction`
          update trail.email_outbox set status = 'delivered', delivered_at = now(),
            updated_at = now(), last_error_code = null where id = ${row.id}
        `;
        if (row.purpose === 'password_reset') {
          await transaction`
            update trail.password_reset_tokens set consumed_at = now()
            where user_id = ${row.user_id} and id <> ${row.reset_token_id}
              and consumed_at is null
          `;
        }
      });
    } catch {
      const nextAttempt = row.attempt_count + 1;
      const terminal = nextAttempt >= maximumEmailAttempts;
      await sql`
        update trail.email_outbox set
          status = ${terminal ? 'dead' : 'pending'},
          next_attempt_at = now() + (${Math.min(2 ** nextAttempt, 60)} * interval '1 minute'),
          last_error_code = 'delivery_failed', updated_at = now()
        where id = ${row.id}
      `;
      providers.telemetry.captureException({
        code: 'password_reset_email_failed',
        requestId: 'email-outbox',
      });
    }
  }
  await cleanupAuthArtifacts(providers);
  return rows.length;
}

export async function cleanupAuthArtifacts(
  providers: Providers,
): Promise<void> {
  const sql = sqlProvider(providers);
  await sql.begin(async (transaction) => {
    await transaction`
      update trail.refresh_tokens predecessor set
        rotation_request_hash = null, successor_ciphertext = null,
        successor_iv = null, successor_tag = null, successor_token_id = null
      where predecessor.successor_token_id is not null and exists (
        select 1 from trail.refresh_tokens successor
        join trail.refresh_token_families family
          on family.id = successor.family_id
        where successor.id = predecessor.successor_token_id
          and (successor.consumed_at is not null
            or successor.revoked_at is not null
            or successor.expires_at <= now()
            or family.revoked_at is not null
            or family.expires_at <= now())
      )
    `;
    await transaction`
      delete from trail.email_outbox
      where status in ('delivered', 'dead')
        and updated_at < now() - interval '24 hours'
    `;
    await transaction`
      delete from trail.password_reset_tokens
      where (consumed_at is not null or expires_at <= now())
        and created_at < now() - interval '24 hours'
    `;
    await transaction`
      delete from trail.registration_verifications
      where (consumed_at is not null or expires_at <= now())
        and created_at < now() - interval '24 hours'
    `;
  });
}

export async function confirmPasswordReset(
  providers: Providers,
  token: string,
  password: string,
): Promise<void> {
  const sql = sqlProvider(providers);
  const candidates = await sql<
    {
      id: string;
      user_id: string;
      expires_at: DatabaseTimestamp;
      consumed_at: DatabaseTimestamp | null;
    }[]
  >`
    select id, user_id, expires_at, consumed_at
    from trail.password_reset_tokens
    where token_hash = ${hashOpaqueToken(token)}
  `;
  const candidate = candidates[0];
  const lookupTime = new Date();
  if (
    !candidate ||
    candidate.consumed_at ||
    asDate(candidate.expires_at) <= lookupTime
  )
    throw authFailed();

  const passwordHash = await hashPassword(password, 'password_reset');
  const valid = await sql.begin(async (transaction) => {
    const rows = await transaction<
      {
        id: string;
        user_id: string;
        expires_at: DatabaseTimestamp;
        consumed_at: DatabaseTimestamp | null;
      }[]
    >`
      select id, user_id, expires_at, consumed_at
      from trail.password_reset_tokens where id = ${candidate.id} for update
    `;
    const row = rows[0];
    const now = new Date();
    if (!row || row.consumed_at || asDate(row.expires_at) <= now) return false;
    await transaction`
      update trail.password_reset_tokens set consumed_at = ${now.toISOString()}
      where user_id = ${row.user_id} and consumed_at is null
    `;
    await transaction`
      update trail.users set password_hash = ${passwordHash},
        auth_version = auth_version + 1, updated_at = ${now.toISOString()}
      where id = ${row.user_id}
    `;
    await transaction`
      update trail.refresh_token_families
      set revoked_at = coalesce(revoked_at, ${now.toISOString()})
      where user_id = ${row.user_id}
    `;
    await transaction`
      update trail.refresh_tokens set
        revoked_at = coalesce(revoked_at, ${now.toISOString()}),
        rotation_request_hash = null, successor_ciphertext = null,
        successor_iv = null, successor_tag = null, successor_token_id = null
      where family_id in (
        select id from trail.refresh_token_families where user_id = ${row.user_id}
      )
    `;
    return true;
  });
  if (!valid) throw authFailed();
}

async function userResponse(
  sql: Queryable,
  userId: string,
): Promise<User | null> {
  const rows = await sql<UserRow[]>`
    select id, email, password_hash, display_name, avatar_url, units,
           default_sport, auth_version, created_at, updated_at
    from trail.users where id = ${userId}
  `;
  if (!rows[0]) return null;
  const identities = await sql<
    { id: string; provider: AuthProvider; created_at: DatabaseTimestamp }[]
  >`
    select id, provider, created_at from trail.auth_identities
    where user_id = ${userId} order by created_at
  `;
  const row = rows[0];
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    avatar_url: row.avatar_url,
    units: row.units,
    default_sport: row.default_sport,
    identities: identities.map((identity) => ({
      id: identity.id,
      provider: identity.provider,
      created_at: asDate(identity.created_at).toISOString(),
    })),
    created_at: asDate(row.created_at).toISOString(),
    updated_at: asDate(row.updated_at).toISOString(),
  };
}

export async function getUser(
  providers: Providers,
  userId: string,
): Promise<User> {
  const user = await userResponse(sqlProvider(providers), userId);
  if (!user)
    throw new ApplicationError({
      code: 'unauthorized',
      statusCode: 401,
      publicMessage: 'Authentication required',
    });
  return user;
}

export async function updateUser(
  providers: Providers,
  userId: string,
  update: UpdateUserRequest,
): Promise<User> {
  const sql = sqlProvider(providers);
  const current = await getUser(providers, userId);
  await sql`
    update trail.users set
      display_name = ${update.display_name ?? current.display_name},
      avatar_url = ${update.avatar_url === undefined ? current.avatar_url : update.avatar_url},
      units = ${update.units ?? current.units},
      default_sport = ${update.default_sport ?? current.default_sport},
      updated_at = now()
    where id = ${userId}
  `;
  return (await userResponse(sql, userId))!;
}

export async function deleteUser(
  providers: Providers,
  userId: string,
  authVersion: number,
  password: string,
): Promise<void> {
  const sql = sqlProvider(providers);
  const rows = await sql<
    { password_hash: string | null; auth_version: number }[]
  >`
    select password_hash, auth_version from trail.users where id = ${userId}
  `;
  if (!rows[0]) throw authFailed();
  if (!rows[0].password_hash) {
    throw new ApplicationError({
      code: 'step_up_required',
      statusCode: 409,
      publicMessage: 'Provider step-up is required before account deletion',
    });
  }
  const verified = await verifyPassword(
    rows[0].password_hash,
    password,
    'account_deletion',
  );
  if (!verified) {
    throw new ApplicationError({
      code: 'step_up_failed',
      statusCode: 403,
      publicMessage: 'Account deletion verification failed',
    });
  }
  const result = await sql`
    delete from trail.users
    where id = ${userId} and auth_version = ${authVersion}
      and password_hash = ${rows[0].password_hash}
  `;
  if (result.count !== 1) {
    throw new ApplicationError({
      code: 'step_up_failed',
      statusCode: 403,
      publicMessage: 'Account deletion verification failed',
    });
  }
}
