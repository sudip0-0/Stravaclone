import { randomUUID } from 'node:crypto';
import {
  MAX_ACTIVITY_PHOTOS,
  MAX_PHOTO_INPUT_BYTES,
  SIGNED_UPLOAD_TTL_SECONDS,
  type ActivityPhoto,
  type InitiatePhotoUploadRequest,
  type PhotoCompleteResponse,
  type SignedPhotoDownload,
  type SignedPhotoUpload,
} from '@trail/contracts';
import type { Sql } from 'postgres';
import { ApplicationError } from '../http/application-error.js';
import type { ObjectStorageProvider } from '../providers/ports.js';
import {
  detectPhotoMime,
  InvalidPhotoError,
  readBoundedPhoto,
} from './processor.js';

interface PhotoRow {
  id: string;
  activity_id: string;
  user_id: string;
  legacy_object_key: string | null;
  staging_object_key: string | null;
  normalized_object_key: string | null;
  status: ActivityPhoto['status'];
  mime: ActivityPhoto['mime'];
  size_bytes: number | null;
  input_mime: InitiatePhotoUploadRequest['input_mime'];
  input_size_bytes: number;
  upload_attempt_count: number;
  width: number | null;
  height: number | null;
  latitude: number | null;
  longitude: number | null;
  captured_at: Date | string | null;
  sort_order: number;
  error_code: string | null;
  created_at: Date | string;
}

function error(
  statusCode: number,
  code:
    | 'not_found'
    | 'too_many_photos'
    | 'photo_too_large'
    | 'staging_missing'
    | 'unsupported_media_type'
    | 'conflict',
  publicMessage: string,
): ApplicationError {
  return new ApplicationError({ statusCode, code, publicMessage });
}

function expiresAt(): string {
  return new Date(Date.now() + SIGNED_UPLOAD_TTL_SECONDS * 1000).toISOString();
}

async function ownedActivityExists(
  sql: Sql,
  ownerUserId: string,
  activityId: string,
): Promise<boolean> {
  const rows = await sql<
    { exists: boolean }[]
  >`select exists(select 1 from trail.activities where id=${activityId} and user_id=${ownerUserId}) as exists`;
  return rows[0]?.exists ?? false;
}

async function ownedPhoto(
  sql: Sql,
  ownerUserId: string,
  activityId: string,
  photoId: string,
): Promise<PhotoRow | null> {
  const rows = await sql<
    PhotoRow[]
  >`select * from trail.activity_photos where id=${photoId} and activity_id=${activityId} and user_id=${ownerUserId}`;
  return rows[0] ?? null;
}

async function queueDeletion(
  sql: Sql,
  row: PhotoRow,
  key: string,
): Promise<void> {
  const staging = key === row.staging_object_key;
  await sql`insert into trail.object_deletion_outbox (owner_user_id,source_activity_id,source_photo_id,object_key,status,attempt_count,next_attempt_at,completed_at,last_error_code,lease_token,lease_expires_at,updated_at) values (${row.user_id},${row.activity_id},${row.id},${key},'pending',0,case when ${staging} then greatest(now(),${row.created_at}::timestamptz+interval '15 minutes') else now() end,null,null,null,null,now()) on conflict (object_key) do update set status='pending',attempt_count=0,next_attempt_at=case when ${staging} then greatest(trail.object_deletion_outbox.next_attempt_at,excluded.next_attempt_at) else excluded.next_attempt_at end,completed_at=null,last_error_code=null,lease_token=null,lease_expires_at=null,updated_at=now()`;
}

async function rejectStaging(
  sql: Sql,
  storage: ObjectStorageProvider,
  row: PhotoRow,
  safeCode: string,
): Promise<void> {
  const stagingObjectKey = row.staging_object_key;
  if (!stagingObjectKey) return;
  await sql.begin(async (transaction) => {
    await transaction`update trail.activity_photos set status='failed',error_code=${safeCode},processing_lease_token=null,processing_lease_expires_at=null,updated_at=now() where id=${row.id}`;
    await queueDeletion(transaction, row, stagingObjectKey);
  });
  try {
    await storage.delete(stagingObjectKey);
  } catch {
    return;
  }
}

async function cleanStagingCapability(
  sql: Sql,
  storage: ObjectStorageProvider,
  row: PhotoRow,
): Promise<void> {
  const stagingObjectKey = row.staging_object_key;
  if (!stagingObjectKey) return;
  await queueDeletion(sql, row, stagingObjectKey);
  try {
    await storage.delete(stagingObjectKey);
  } catch {
    return;
  }
}

export async function initiatePhotoUpload(
  sql: Sql,
  storage: ObjectStorageProvider,
  ownerUserId: string,
  activityId: string,
  input: InitiatePhotoUploadRequest,
): Promise<SignedPhotoUpload> {
  const photoId = randomUUID();
  const prefix = `users/${ownerUserId}/activities/${activityId}/photos/${photoId}`;
  const stagingObjectKey = `${prefix}/staging`;
  const normalizedObjectKey = `${prefix}/normalized`;
  await sql.begin(async (transaction) => {
    await transaction`select pg_advisory_xact_lock(hashtextextended(${activityId}, 0))`;
    if (!(await ownedActivityExists(transaction, ownerUserId, activityId)))
      throw error(404, 'not_found', 'Activity not found');
    const existing = await transaction<
      { sort_order: number }[]
    >`select sort_order from trail.activity_photos where activity_id=${activityId} order by sort_order`;
    if (existing.length >= MAX_ACTIVITY_PHOTOS)
      throw error(409, 'too_many_photos', 'Activity already has 10 photos');
    const occupied = new Set(existing.map((row) => row.sort_order));
    let sortOrder = 0;
    while (occupied.has(sortOrder)) sortOrder += 1;
    await transaction`insert into trail.activity_photos (id,activity_id,user_id,staging_object_key,normalized_object_key,status,input_mime,input_size_bytes,upload_attempt_count,latitude,longitude,captured_at,sort_order) values (${photoId},${activityId},${ownerUserId},${stagingObjectKey},${normalizedObjectKey},'pending',${input.input_mime},${input.input_size_bytes},1,${input.user_approved_latitude ?? null},${input.user_approved_longitude ?? null},${input.user_approved_captured_at ?? null},${sortOrder})`;
  });
  try {
    const signed = await storage.presignPost(
      stagingObjectKey,
      input.input_mime,
      input.input_size_bytes,
      input.input_size_bytes,
      SIGNED_UPLOAD_TTL_SECONDS,
    );
    return {
      photo_id: photoId,
      status: 'pending',
      upload_url: signed.url,
      expires_at: expiresAt(),
      form_fields: signed.fields,
    };
  } catch (cause) {
    await sql`delete from trail.activity_photos where id=${photoId} and user_id=${ownerUserId}`;
    throw cause;
  }
}

export async function reissuePhotoUpload(
  sql: Sql,
  storage: ObjectStorageProvider,
  ownerUserId: string,
  activityId: string,
  photoId: string,
): Promise<SignedPhotoUpload> {
  const row = await ownedPhoto(sql, ownerUserId, activityId, photoId);
  if (!row) throw error(404, 'not_found', 'Photo not found');
  if (
    row.legacy_object_key ||
    !row.staging_object_key ||
    !row.normalized_object_key ||
    !['pending', 'failed'].includes(row.status)
  )
    throw error(409, 'conflict', 'Photo reservation cannot be reissued');
  if (row.upload_attempt_count >= 5)
    throw error(409, 'conflict', 'Photo upload attempt limit reached');
  if (await storage.head(row.staging_object_key))
    throw error(409, 'conflict', 'Photo staging upload already exists');
  const signed = await storage.presignPost(
    row.staging_object_key,
    row.input_mime,
    row.input_size_bytes,
    row.input_size_bytes,
    SIGNED_UPLOAD_TTL_SECONDS,
  );
  const updated = await sql.begin(async (transaction) => {
    const rows = await transaction<
      { id: string }[]
    >`update trail.activity_photos set status='pending',error_code=null,upload_attempt_count=least(5,upload_attempt_count+1),updated_at=now() where id=${photoId} and activity_id=${activityId} and user_id=${ownerUserId} and status in ('pending','failed') and legacy_object_key is null and upload_attempt_count<5 returning id`;
    if (!rows[0]) return false;
    await transaction`insert into trail.object_deletion_outbox (owner_user_id,source_activity_id,source_photo_id,object_key,status,attempt_count,next_attempt_at,completed_at,last_error_code,lease_token,lease_expires_at,updated_at) values (${ownerUserId},${activityId},${photoId},${row.staging_object_key},'pending',0,now()+interval '15 minutes',null,null,null,null,now()) on conflict (object_key) do update set status='pending',attempt_count=0,next_attempt_at=greatest(trail.object_deletion_outbox.next_attempt_at,excluded.next_attempt_at),completed_at=null,last_error_code=null,lease_token=null,lease_expires_at=null,updated_at=now()`;
    return true;
  });
  if (!updated)
    throw error(409, 'conflict', 'Photo reservation cannot be reissued');
  return {
    photo_id: photoId,
    status: 'pending',
    upload_url: signed.url,
    expires_at: expiresAt(),
    form_fields: signed.fields,
  };
}

export async function completePhotoUpload(
  sql: Sql,
  storage: ObjectStorageProvider,
  ownerUserId: string,
  activityId: string,
  photoId: string,
): Promise<PhotoCompleteResponse> {
  const row = await ownedPhoto(sql, ownerUserId, activityId, photoId);
  if (!row) throw error(404, 'not_found', 'Photo not found');
  if (row.status === 'ready') {
    await cleanStagingCapability(sql, storage, row);
    return { photo_id: row.id, status: row.status };
  }
  if (row.status === 'processing' || row.status === 'failed')
    return { photo_id: row.id, status: row.status };
  if (!row.staging_object_key)
    throw error(409, 'staging_missing', 'Photo staging upload is missing');
  const head = await storage.head(row.staging_object_key);
  if (!head)
    throw error(409, 'staging_missing', 'Photo staging upload is missing');
  if (head.sizeBytes <= 0 || head.sizeBytes > MAX_PHOTO_INPUT_BYTES) {
    await rejectStaging(sql, storage, row, 'photo_too_large');
    throw error(413, 'photo_too_large', 'Photo exceeds the 10 MiB limit');
  }
  if (head.sizeBytes !== row.input_size_bytes) {
    await rejectStaging(sql, storage, row, 'photo_size_mismatch');
    throw error(
      409,
      'conflict',
      'Uploaded photo size does not match initiation',
    );
  }
  if (head.contentType !== row.input_mime) {
    await rejectStaging(sql, storage, row, 'photo_mime_mismatch');
    throw error(
      415,
      'unsupported_media_type',
      'Uploaded photo type does not match initiation',
    );
  }
  try {
    const bytes = await readBoundedPhoto(
      await storage.get(row.staging_object_key),
    );
    if (detectPhotoMime(bytes) !== row.input_mime)
      throw new InvalidPhotoError('unsupported_media_type');
  } catch {
    await rejectStaging(sql, storage, row, 'unsupported_media_type');
    throw error(
      415,
      'unsupported_media_type',
      'Uploaded photo bytes are unsupported',
    );
  }
  const rows = await sql<
    { id: string; status: ActivityPhoto['status'] }[]
  >`update trail.activity_photos set status='processing',error_code=null,next_processing_at=now(),processing_lease_token=null,processing_lease_expires_at=null,updated_at=now() where id=${photoId} and activity_id=${activityId} and user_id=${ownerUserId} and status='pending' returning id,status`;
  const updated =
    rows[0] ?? (await ownedPhoto(sql, ownerUserId, activityId, photoId));
  if (!updated) throw error(404, 'not_found', 'Photo not found');
  return { photo_id: updated.id, status: updated.status };
}

async function toContract(
  storage: ObjectStorageProvider,
  row: PhotoRow,
): Promise<ActivityPhoto> {
  const signed =
    row.status === 'ready' && row.normalized_object_key
      ? await storage.presignGet(
          row.normalized_object_key,
          SIGNED_UPLOAD_TTL_SECONDS,
        )
      : null;
  return {
    id: row.id,
    activity_id: row.activity_id,
    status: row.status,
    mime: row.mime,
    size_bytes: row.size_bytes,
    width: row.width,
    height: row.height,
    user_approved_latitude: row.latitude,
    user_approved_longitude: row.longitude,
    user_approved_captured_at: row.captured_at
      ? new Date(row.captured_at).toISOString()
      : null,
    sort_order: row.sort_order,
    error_code: row.error_code,
    download_url: signed,
    download_expires_at: signed ? expiresAt() : null,
  };
}

export async function listPhotos(
  sql: Sql,
  storage: ObjectStorageProvider,
  ownerUserId: string,
  activityId: string,
): Promise<ActivityPhoto[]> {
  if (!(await ownedActivityExists(sql, ownerUserId, activityId)))
    throw error(404, 'not_found', 'Activity not found');
  const rows = await sql<
    PhotoRow[]
  >`select * from trail.activity_photos where activity_id=${activityId} and user_id=${ownerUserId} order by sort_order,id`;
  return Promise.all(rows.map((row) => toContract(storage, row)));
}

export async function signPhotoDownload(
  sql: Sql,
  storage: ObjectStorageProvider,
  ownerUserId: string,
  activityId: string,
  photoId: string,
): Promise<SignedPhotoDownload> {
  const row = await ownedPhoto(sql, ownerUserId, activityId, photoId);
  if (!row) throw error(404, 'not_found', 'Photo not found');
  if (row.status !== 'ready' || !row.normalized_object_key)
    throw error(409, 'conflict', 'Photo is not ready');
  return {
    download_url: await storage.presignGet(
      row.normalized_object_key,
      SIGNED_UPLOAD_TTL_SECONDS,
    ),
    expires_at: expiresAt(),
  };
}

export async function deletePhoto(
  sql: Sql,
  ownerUserId: string,
  activityId: string,
  photoId: string,
): Promise<void> {
  const rows = await sql<
    { id: string }[]
  >`delete from trail.activity_photos where id=${photoId} and activity_id=${activityId} and user_id=${ownerUserId} returning id`;
  if (!rows[0] && !(await ownedActivityExists(sql, ownerUserId, activityId)))
    throw error(404, 'not_found', 'Activity not found');
}
