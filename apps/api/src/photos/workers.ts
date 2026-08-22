import { randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';
import type { ObjectStorageProvider, Providers } from '../providers/ports.js';
import {
  InvalidPhotoError,
  processPhoto,
  readBoundedPhoto,
} from './processor.js';

const PROCESSING_MAX_ATTEMPTS = 5;
const DELETION_MAX_ATTEMPTS = 10;
const LEASE_SECONDS = 120;

interface ProcessingJob {
  id: string;
  user_id: string;
  activity_id: string;
  staging_object_key: string;
  normalized_object_key: string;
  processing_attempt_count: number;
  processing_lease_token: string;
  created_at: Date | string;
}
interface DeletionJob {
  id: string;
  object_key: string;
  attempt_count: number;
  lease_token: string;
}

function retrySeconds(attempt: number): number {
  return Math.min(3600, 2 ** Math.min(Math.max(attempt, 1), 10) * 15);
}

async function upsertDeletion(
  sql: Sql,
  job: Pick<
    ProcessingJob,
    'id' | 'user_id' | 'activity_id' | 'staging_object_key' | 'created_at'
  >,
  objectKey: string,
): Promise<void> {
  const staging = objectKey === job.staging_object_key;
  await sql`insert into trail.object_deletion_outbox (owner_user_id,source_activity_id,source_photo_id,object_key,status,attempt_count,next_attempt_at,completed_at,last_error_code,lease_token,lease_expires_at,updated_at) values (${job.user_id},${job.activity_id},${job.id},${objectKey},'pending',0,case when ${staging} then greatest(now(),${job.created_at}::timestamptz+interval '15 minutes') else now() end,null,null,null,null,now()) on conflict (object_key) do update set status='pending',attempt_count=0,next_attempt_at=case when ${staging} then greatest(trail.object_deletion_outbox.next_attempt_at,excluded.next_attempt_at) else excluded.next_attempt_at end,completed_at=null,last_error_code=null,lease_token=null,lease_expires_at=null,updated_at=now()`;
}

async function deleteQueuedObject(
  sql: Sql,
  storage: ObjectStorageProvider,
  objectKey: string,
  preservePending = false,
): Promise<void> {
  try {
    await storage.delete(objectKey);
    if (!preservePending)
      await sql`update trail.object_deletion_outbox set status='completed',completed_at=now(),lease_token=null,lease_expires_at=null,last_error_code=null,updated_at=now() where object_key=${objectKey} and status in ('pending','retry')`;
  } catch {
    return;
  }
}

async function claimProcessingJobs(
  sql: Sql,
  limit: number,
): Promise<ProcessingJob[]> {
  const token = randomUUID();
  return sql.begin(
    (transaction) =>
      transaction<ProcessingJob[]>`with candidates as (
      select id from trail.activity_photos
      where status='processing' and processing_attempt_count < ${PROCESSING_MAX_ATTEMPTS}
        and next_processing_at <= now()
        and (processing_lease_expires_at is null or processing_lease_expires_at <= now())
      order by next_processing_at,id for update skip locked limit ${limit}
    )
    update trail.activity_photos photo
    set processing_attempt_count=least(${PROCESSING_MAX_ATTEMPTS},photo.processing_attempt_count+1),
        processing_lease_token=${token},processing_lease_expires_at=now()+(${LEASE_SECONDS}*interval '1 second'),updated_at=now()
    from candidates where photo.id=candidates.id
    returning photo.id,photo.user_id,photo.activity_id,photo.staging_object_key,photo.normalized_object_key,
              photo.processing_attempt_count,photo.processing_lease_token,photo.created_at`,
  );
}

async function finalizeProcessingFailure(
  sql: Sql,
  storage: ObjectStorageProvider,
  job: ProcessingJob,
  cause: unknown,
): Promise<void> {
  const terminal =
    cause instanceof InvalidPhotoError ||
    job.processing_attempt_count >= PROCESSING_MAX_ATTEMPTS;
  if (!terminal) {
    await sql`update trail.activity_photos set error_code='photo_processing_retry',next_processing_at=now()+(${retrySeconds(job.processing_attempt_count)}*interval '1 second'),processing_lease_token=null,processing_lease_expires_at=null,updated_at=now() where id=${job.id} and processing_lease_token=${job.processing_lease_token} and status='processing'`;
    return;
  }
  const safeCode =
    cause instanceof InvalidPhotoError
      ? cause.safeCode
      : 'photo_processing_failed';
  await sql.begin(async (transaction) => {
    await transaction`update trail.activity_photos set status='failed',error_code=${safeCode},processing_lease_token=null,processing_lease_expires_at=null,updated_at=now() where id=${job.id} and processing_lease_token=${job.processing_lease_token} and status='processing'`;
    await upsertDeletion(transaction, job, job.staging_object_key);
  });
  await deleteQueuedObject(sql, storage, job.staging_object_key, true);
}

async function processClaimedPhoto(
  sql: Sql,
  storage: ObjectStorageProvider,
  job: ProcessingJob,
): Promise<void> {
  let normalizedWritten = false;
  try {
    const body = await readBoundedPhoto(
      await storage.get(job.staging_object_key),
    );
    const output = await processPhoto(body);
    await storage.put(job.normalized_object_key, output.body, output.mime);
    normalizedWritten = true;
    const finalized = await sql.begin(async (transaction) => {
      const rows = await transaction<
        { id: string }[]
      >`update trail.activity_photos set status='ready',mime=${output.mime},size_bytes=${output.body.length},width=${output.width},height=${output.height},error_code=null,processing_lease_token=null,processing_lease_expires_at=null,updated_at=now() where id=${job.id} and processing_lease_token=${job.processing_lease_token} and status='processing' returning id`;
      if (rows[0])
        await upsertDeletion(transaction, job, job.staging_object_key);
      return rows[0] !== undefined;
    });
    if (!finalized) {
      await upsertDeletion(sql, job, job.normalized_object_key);
      await deleteQueuedObject(sql, storage, job.normalized_object_key);
      return;
    }
    await deleteQueuedObject(sql, storage, job.staging_object_key, true);
  } catch (cause) {
    if (normalizedWritten) {
      await upsertDeletion(sql, job, job.normalized_object_key);
      await deleteQueuedObject(sql, storage, job.normalized_object_key);
    }
    await finalizeProcessingFailure(sql, storage, job, cause);
  }
}

export async function drainPhotoProcessing(
  providers: Providers,
  limit = 2,
): Promise<number> {
  const sql = providers.database.sql;
  if (!sql) return 0;
  const batchSize = Math.max(0, Math.min(limit, 4));
  const exhausted = await sql.begin(
    (transaction) =>
      transaction<ProcessingJob[]>`with candidates as (
      select id from trail.activity_photos where status='processing'
        and processing_attempt_count >= ${PROCESSING_MAX_ATTEMPTS}
        and (processing_lease_expires_at is null or processing_lease_expires_at <= now())
      order by id for update skip locked limit ${batchSize}
    ) update trail.activity_photos photo set status='failed',error_code='photo_processing_failed',
      processing_lease_token=null,processing_lease_expires_at=null,updated_at=now()
      from candidates where photo.id=candidates.id
      returning photo.id,photo.user_id,photo.activity_id,photo.staging_object_key,photo.normalized_object_key,
        photo.processing_attempt_count,gen_random_uuid() as processing_lease_token,photo.created_at`,
  );
  await Promise.allSettled(
    exhausted.map(async (job) => {
      await upsertDeletion(sql, job, job.staging_object_key);
      await deleteQueuedObject(
        sql,
        providers.objectStorage,
        job.staging_object_key,
        true,
      );
    }),
  );
  const jobs = await claimProcessingJobs(sql, batchSize);
  await Promise.allSettled(
    jobs.map((job) => processClaimedPhoto(sql, providers.objectStorage, job)),
  );
  await sql`delete from trail.activity_photos where status='pending' and created_at < now()-interval '24 hours'`;
  return jobs.length;
}

async function claimDeletionJobs(
  sql: Sql,
  limit: number,
): Promise<DeletionJob[]> {
  const token = randomUUID();
  return sql.begin(
    (transaction) =>
      transaction<DeletionJob[]>`with candidates as (
      select id from trail.object_deletion_outbox
      where status in ('pending','retry') and attempt_count < ${DELETION_MAX_ATTEMPTS}
        and next_attempt_at <= now() and (lease_expires_at is null or lease_expires_at <= now())
      order by next_attempt_at,id for update skip locked limit ${limit}
    )
    update trail.object_deletion_outbox job
    set attempt_count=least(${DELETION_MAX_ATTEMPTS},job.attempt_count+1),lease_token=${token},
        lease_expires_at=now()+(${LEASE_SECONDS}*interval '1 second'),updated_at=now()
    from candidates where job.id=candidates.id
    returning job.id,job.object_key,job.attempt_count,job.lease_token`,
  );
}

async function deleteClaimedObject(
  sql: Sql,
  storage: ObjectStorageProvider,
  job: DeletionJob,
): Promise<void> {
  try {
    await storage.delete(job.object_key);
    await sql`update trail.object_deletion_outbox set status='completed',completed_at=now(),last_error_code=null,lease_token=null,lease_expires_at=null,updated_at=now() where id=${job.id} and lease_token=${job.lease_token}`;
  } catch {
    if (job.attempt_count >= DELETION_MAX_ATTEMPTS) {
      await sql`update trail.object_deletion_outbox set status='failed',last_error_code='object_delete_failed',lease_token=null,lease_expires_at=null,updated_at=now() where id=${job.id} and lease_token=${job.lease_token}`;
      return;
    }
    await sql`update trail.object_deletion_outbox set status='retry',next_attempt_at=now()+(${retrySeconds(job.attempt_count)}*interval '1 second'),last_error_code='object_delete_failed',lease_token=null,lease_expires_at=null,updated_at=now() where id=${job.id} and lease_token=${job.lease_token}`;
  }
}

export async function drainObjectDeletionOutbox(
  providers: Providers,
  limit = 10,
): Promise<number> {
  const sql = providers.database.sql;
  if (!sql) return 0;
  const batchSize = Math.max(0, Math.min(limit, 25));
  await sql`update trail.object_deletion_outbox set status='failed',last_error_code='object_delete_failed',lease_token=null,lease_expires_at=null,updated_at=now() where status in ('pending','retry') and attempt_count >= ${DELETION_MAX_ATTEMPTS} and (lease_expires_at is null or lease_expires_at <= now())`;
  const jobs = await claimDeletionJobs(sql, batchSize);
  await Promise.allSettled(
    jobs.map((job) => deleteClaimedObject(sql, providers.objectStorage, job)),
  );
  await sql`delete from trail.object_deletion_outbox where status='completed' and completed_at < now()-interval '24 hours'`;
  return jobs.length;
}
