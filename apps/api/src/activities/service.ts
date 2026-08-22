import { createHash } from 'node:crypto';
import type {
  Activity,
  ActivityListResponse,
  CreateActivityRequest,
  UnitSystem,
  UpdateActivityRequest,
} from '@trail/contracts';
import {
  buildSmoothedGpsElevationProfile,
  encodePolyline,
  generateSplits,
  haversineDistanceM,
  paceSecondsPerUnit,
  speedMetersPerSecond,
  type TrackPoint,
} from '@trail/domain';
import type { Sql } from 'postgres';
import { ApplicationError } from '../http/application-error.js';

interface ActivityRow {
  id: string;
  user_id: string;
  route_id: string | null;
  sport: Activity['sport'];
  title: string | null;
  notes: string | null;
  started_at: Date | string;
  ended_at: Date | string;
  distance_m: number;
  moving_time_s: number;
  elapsed_time_s: number;
  elevation_gain_m: number;
  elevation_loss_m: number;
  polyline: string;
  polylines: string[];
  ingest_hash: string;
  created_at: Date | string;
  updated_at: Date | string;
}
interface SplitRow {
  split_index: number;
  unit_system: UnitSystem;
  distance_m: number;
  duration_s: number;
  boundary_distance_m: number;
}
interface ElevationRow {
  distance_m: number;
  elapsed_time_s: number;
  elevation_m: number;
}

function applicationError(
  statusCode: number,
  code: 'invalid_request' | 'not_found' | 'idempotency_conflict',
  message: string,
) {
  return new ApplicationError({ statusCode, code, publicMessage: message });
}
function normalizedSource(input: CreateActivityRequest) {
  const timestamp = (value: string) => new Date(value).toISOString();
  return {
    payload_version: input.payload_version,
    id: input.id.toLowerCase(),
    sport: input.sport,
    started_at: timestamp(input.started_at),
    ended_at: timestamp(input.ended_at),
    route_id: input.route_id?.toLowerCase() ?? null,
    // The contract proves both arrays are already strictly ordered; mapping preserves
    // that canonical order without an O(n log n) resort at the 100k/10k bounds.
    pauses: input.pauses.map((pause) => ({
      started_at: timestamp(pause.started_at),
      ended_at: timestamp(pause.ended_at),
    })),
    points: input.points.map((point) => ({
      sequence: point.sequence,
      latitude: point.latitude,
      longitude: point.longitude,
      elevation_m: point.elevation_m ?? null,
      accuracy_m: point.accuracy_m ?? null,
      recorded_at: timestamp(point.recorded_at),
    })),
  };
}
function ingestHash(input: CreateActivityRequest): string {
  return createHash('sha256')
    .update(JSON.stringify(normalizedSource(input)))
    .digest('hex');
}
function canonical(input: CreateActivityRequest) {
  const points: TrackPoint[] = input.points.map((point) => ({
    latitude: point.latitude,
    longitude: point.longitude,
    elevationM: point.elevation_m,
    accuracyM: point.accuracy_m,
    timestampMs: Date.parse(point.recorded_at),
  }));
  const startedAtMs = Date.parse(input.started_at);
  const endedAtMs = Date.parse(input.ended_at);
  const pauses = input.pauses.map((pause) => ({
    startedAtMs: Date.parse(pause.started_at),
    endedAtMs: Date.parse(pause.ended_at),
  }));
  const cumulative = [{ distanceM: 0, movingTimeS: 0 }];
  const segments: TrackPoint[][] = [[points[0]!]];
  let distanceM = 0;
  let movingTimeS = 0;
  let pauseIndex = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const point = points[index]!;
    while (
      pauses[pauseIndex] &&
      pauses[pauseIndex]!.endedAtMs <= previous.timestampMs
    )
      pauseIndex += 1;
    const pause = pauses[pauseIndex];
    const crossesPause =
      pause !== undefined &&
      pause.startedAtMs < point.timestampMs &&
      pause.endedAtMs > previous.timestampMs;
    if (crossesPause) {
      segments.push([point]);
    } else {
      distanceM += haversineDistanceM(previous, point);
      const intervalMs = point.timestampMs - previous.timestampMs;
      if (intervalMs <= 10_000) movingTimeS += intervalMs / 1000;
      segments.at(-1)!.push(point);
    }
    cumulative.push({ distanceM, movingTimeS });
  }
  const pointIndex = new Map(
    points.map((point, index) => [point.timestampMs, index]),
  );
  const segmentElevations = segments.map((segment) =>
    buildSmoothedGpsElevationProfile(segment),
  );
  const elevation = {
    source: 'gps_smoothed' as const,
    gainM: segmentElevations.reduce((total, value) => total + value.gainM, 0),
    lossM: segmentElevations.reduce((total, value) => total + value.lossM, 0),
    samples: segmentElevations.flatMap((value) => value.samples),
  };
  return {
    points,
    distanceM,
    movingTimeS: Math.round(movingTimeS),
    elapsedTimeS: Math.round((endedAtMs - startedAtMs) / 1000),
    polylines: segments.map((segment) => encodePolyline(segment)),
    elevation,
    elevationSamples: elevation.samples.map((sample) => {
      const index = pointIndex.get(sample.timestampMs) ?? 0;
      return {
        distanceM: cumulative[index]?.distanceM ?? 0,
        elapsedTimeS: (sample.timestampMs - startedAtMs) / 1000,
        elevationM: sample.elevationM,
      };
    }),
    splits: (['metric', 'imperial'] as const).flatMap((units) =>
      generateSplits(cumulative, units).map((split) => ({ ...split, units })),
    ),
  };
}
function iso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
function stats(row: ActivityRow) {
  return {
    distance_m: row.distance_m,
    moving_time_s: row.moving_time_s,
    elapsed_time_s: row.elapsed_time_s,
    elevation_gain_m: row.elevation_gain_m,
    elevation_loss_m: row.elevation_loss_m,
    average_pace_s_per_km: paceSecondsPerUnit(
      row.moving_time_s,
      row.distance_m,
    ),
    average_speed_mps: speedMetersPerSecond(row.moving_time_s, row.distance_m),
  };
}
function summary(row: ActivityRow) {
  return {
    id: row.id,
    sport: row.sport,
    title: row.title,
    started_at: iso(row.started_at),
    stats: stats(row),
  };
}
async function detailInSnapshot(
  sql: Sql,
  ownerUserId: string,
  id: string,
): Promise<Activity | null> {
  const rows = await sql<
    ActivityRow[]
  >`select * from trail.activities where id=${id} and user_id=${ownerUserId}`;
  const row = rows[0];
  if (!row) return null;
  const users = await sql<
    { units: UnitSystem }[]
  >`select units from trail.users where id=${ownerUserId}`;
  const units = users[0]?.units ?? 'metric';
  const splits = await sql<
    SplitRow[]
  >`select s.split_index,s.unit_system,s.distance_m,s.duration_s,s.boundary_distance_m
     from trail.activity_splits s join trail.activities a on a.id=s.activity_id
     where s.activity_id=${id} and a.user_id=${ownerUserId} and s.unit_system=${units}
     order by s.split_index`;
  const elevation = await sql<
    ElevationRow[]
  >`select e.distance_m,e.elapsed_time_s,e.elevation_m
     from trail.activity_elevation_samples e join trail.activities a on a.id=e.activity_id
     where e.activity_id=${id} and a.user_id=${ownerUserId} order by e.seq`;
  return {
    id: row.id,
    sport: row.sport,
    title: row.title,
    notes: row.notes,
    started_at: iso(row.started_at),
    ended_at: iso(row.ended_at),
    route_id: row.route_id,
    stats: stats(row),
    polylines: row.polylines,
    splits: splits.map((split) => ({
      index: split.split_index,
      unit_system: split.unit_system,
      distance_m: split.distance_m,
      moving_time_s: split.duration_s,
      pace_s_per_unit: paceSecondsPerUnit(
        split.duration_s,
        split.distance_m,
        split.unit_system === 'metric' ? 1000 : 1609.344,
      ),
      partial:
        split.distance_m <
        (split.unit_system === 'metric' ? 1000 : 1609.344) - 0.001,
    })),
    elevation: {
      source: 'gps_smoothed',
      gain_m: row.elevation_gain_m,
      loss_m: row.elevation_loss_m,
      samples: elevation.map((sample) => ({
        distance_m: sample.distance_m,
        elapsed_time_s: sample.elapsed_time_s,
        elevation_m: sample.elevation_m,
      })),
    },
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

async function detail(
  sql: Sql,
  ownerUserId: string,
  id: string,
): Promise<Activity | null> {
  return sql.begin('isolation level repeatable read', (transaction) =>
    detailInSnapshot(transaction, ownerUserId, id),
  );
}

export async function createActivity(
  sql: Sql,
  ownerUserId: string,
  input: CreateActivityRequest,
) {
  const hash = ingestHash(input);
  const computed = canonical(input);
  let created = false;
  await sql.begin(async (transaction) => {
    await transaction`select pg_advisory_xact_lock(hashtextextended(${input.id}, 0))`;
    const existing = await transaction<
      { user_id: string; ingest_hash: string }[]
    >`select user_id,ingest_hash from trail.activities where id=${input.id}`;
    if (existing[0]) {
      if (
        existing[0].user_id === ownerUserId &&
        existing[0].ingest_hash === hash
      )
        return;
      throw applicationError(
        409,
        'idempotency_conflict',
        'Activity identifier conflicts with an existing activity',
      );
    }
    if (input.route_id) {
      const route = await transaction<
        { exists: boolean }[]
      >`select exists(select 1 from trail.routes where id=${input.route_id} and user_id=${ownerUserId}) as exists`;
      if (!route[0]?.exists)
        throw applicationError(404, 'not_found', 'Route not found');
    }
    await transaction`insert into trail.activities (id,user_id,route_id,sport,title,notes,started_at,ended_at,distance_m,moving_time_s,elapsed_time_s,elevation_gain_m,elevation_loss_m,polyline,polylines,ingest_hash) values (${input.id},${ownerUserId},${input.route_id ?? null},${input.sport},${input.title ?? null},${input.notes ?? null},${input.started_at},${input.ended_at},${computed.distanceM},${computed.movingTimeS},${computed.elapsedTimeS},${computed.elevation.gainM},${computed.elevation.lossM},${computed.polylines[0]!},${JSON.stringify(computed.polylines)}::jsonb,${hash})`;
    if (input.pauses.length)
      await transaction`insert into trail.activity_pauses ${transaction(
        input.pauses.map((pause, seq) => ({
          activity_id: input.id,
          seq,
          started_at: pause.started_at,
          ended_at: pause.ended_at,
        })),
      )}`;
    for (let offset = 0; offset < input.points.length; offset += 5_000) {
      const chunk = input.points.slice(offset, offset + 5_000);
      await transaction`insert into trail.activity_points ${transaction(chunk.map((point) => ({ activity_id: input.id, seq: point.sequence, latitude: point.latitude, longitude: point.longitude, elevation_m: point.elevation_m, accuracy_m: point.accuracy_m, recorded_at: point.recorded_at })))}`;
    }
    if (computed.splits.length)
      await transaction`insert into trail.activity_splits ${transaction(computed.splits.map((split) => ({ activity_id: input.id, unit_system: split.units, split_index: split.index, boundary_distance_m: split.index * (split.units === 'metric' ? 1000 : 1609.344), distance_m: split.distanceM, duration_s: split.movingTimeS })))}`;
    for (
      let offset = 0;
      offset < computed.elevationSamples.length;
      offset += 5_000
    ) {
      const chunk = computed.elevationSamples.slice(offset, offset + 5_000);
      await transaction`insert into trail.activity_elevation_samples ${transaction(chunk.map((sample, index) => ({ activity_id: input.id, seq: offset + index, distance_m: sample.distanceM, elapsed_time_s: sample.elapsedTimeS, elevation_m: sample.elevationM, source: 'gps_smoothed' })))}`;
    }
    created = true;
  });
  return { activity: (await detail(sql, ownerUserId, input.id))!, created };
}

export async function getActivity(sql: Sql, ownerUserId: string, id: string) {
  const activity = await detail(sql, ownerUserId, id);
  if (!activity) throw applicationError(404, 'not_found', 'Activity not found');
  return activity;
}
export async function listActivities(
  sql: Sql,
  ownerUserId: string,
  limit: number,
  cursor?: string,
): Promise<ActivityListResponse> {
  let cursorValue: { startedAt: string; id: string } | undefined;
  if (cursor) {
    try {
      cursorValue = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8'),
      ) as { startedAt: string; id: string };
      if (
        !cursorValue.startedAt ||
        !cursorValue.id ||
        !Number.isFinite(Date.parse(cursorValue.startedAt))
      )
        throw new Error('invalid');
    } catch {
      throw applicationError(400, 'invalid_request', 'Invalid activity cursor');
    }
  }
  const rows = cursorValue
    ? await sql<
        ActivityRow[]
      >`select * from trail.activities where user_id=${ownerUserId} and (started_at,id) < (${cursorValue.startedAt},${cursorValue.id}) order by started_at desc,id desc limit ${limit + 1}`
    : await sql<
        ActivityRow[]
      >`select * from trail.activities where user_id=${ownerUserId} order by started_at desc,id desc limit ${limit + 1}`;
  const hasMore = rows.length > limit;
  const visible = rows.slice(0, limit);
  const last = visible.at(-1);
  return {
    items: visible.map(summary),
    page: {
      has_more: hasMore,
      next_cursor:
        hasMore && last
          ? Buffer.from(
              JSON.stringify({ startedAt: iso(last.started_at), id: last.id }),
            ).toString('base64url')
          : null,
    },
  };
}
export async function updateActivity(
  sql: Sql,
  ownerUserId: string,
  id: string,
  patch: UpdateActivityRequest,
) {
  return sql.begin('isolation level repeatable read', async (transaction) => {
    const rows = await transaction<
      ActivityRow[]
    >`update trail.activities set title=case when ${patch.title !== undefined} then ${patch.title ?? null} else title end, notes=case when ${patch.notes !== undefined} then ${patch.notes ?? null} else notes end, updated_at=now() where id=${id} and user_id=${ownerUserId} returning *`;
    if (!rows[0])
      throw applicationError(404, 'not_found', 'Activity not found');
    return (await detailInSnapshot(transaction, ownerUserId, id))!;
  });
}
export async function deleteActivity(
  sql: Sql,
  ownerUserId: string,
  id: string,
) {
  const rows = await sql<
    { id: string }[]
  >`delete from trail.activities where id=${id} and user_id=${ownerUserId} returning id`;
  if (!rows[0]) throw applicationError(404, 'not_found', 'Activity not found');
}
