import type {
  CreateRouteRequest,
  Route,
  RouteListResponse,
  UpdateRouteRequest,
} from '@trail/contracts';
import { encodePolyline, trackDistanceM } from '@trail/domain';
import type { Sql } from 'postgres';
import { z } from 'zod';
import { ApplicationError } from '../http/application-error.js';

const cursorSchema = z.strictObject({
  createdAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
});

interface RouteRow {
  id: string;
  name: string;
  sport_hint: Route['sport_hint'];
  waypoints: Route['waypoints'];
  polyline: string;
  distance_m: number;
  elevation_gain_m: number | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function notFound(): ApplicationError {
  return new ApplicationError({
    statusCode: 404,
    code: 'not_found',
    publicMessage: 'Route not found',
  });
}
function invalidCursor(): ApplicationError {
  return new ApplicationError({
    statusCode: 400,
    code: 'invalid_request',
    publicMessage: 'Invalid route cursor',
  });
}
function iso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
function route(row: RouteRow): Route {
  return {
    id: row.id,
    name: row.name,
    sport_hint: row.sport_hint,
    waypoints: row.waypoints,
    polyline: row.polyline,
    distance_m: row.distance_m,
    elevation_gain_m: row.elevation_gain_m,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}
function computed(waypoints: Route['waypoints']) {
  return {
    polyline: encodePolyline(waypoints),
    distanceM: trackDistanceM(waypoints),
  };
}

export async function createRoute(
  sql: Sql,
  ownerUserId: string,
  input: CreateRouteRequest,
): Promise<{ route: Route; created: boolean }> {
  const value = computed(input.waypoints);
  return sql.begin(async (transaction) => {
    await transaction`select pg_advisory_xact_lock(hashtextextended(${input.id}, 0))`;
    const existing = await transaction<
      (RouteRow & { user_id: string })[]
    >`select * from trail.routes where id=${input.id}`;
    if (existing[0]) {
      const same =
        existing[0].user_id === ownerUserId &&
        existing[0].name === input.name &&
        existing[0].sport_hint === (input.sport_hint ?? null) &&
        JSON.stringify(existing[0].waypoints) ===
          JSON.stringify(input.waypoints);
      if (same) return { route: route(existing[0]), created: false };
      throw new ApplicationError({
        statusCode: 409,
        code: 'idempotency_conflict',
        publicMessage: 'Route identifier conflicts with an existing route',
      });
    }
    const rows = await transaction<RouteRow[]>`
      insert into trail.routes (id,user_id,name,sport_hint,waypoints,polyline,distance_m,elevation_gain_m)
      values (${input.id},${ownerUserId},${input.name},${input.sport_hint ?? null},${JSON.stringify(input.waypoints)}::jsonb,${value.polyline},${value.distanceM},null)
      returning *`;
    return { route: route(rows[0]!), created: true };
  });
}

export async function getRoute(
  sql: Sql,
  ownerUserId: string,
  id: string,
): Promise<Route> {
  const rows = await sql<
    RouteRow[]
  >`select * from trail.routes where id=${id} and user_id=${ownerUserId}`;
  if (!rows[0]) throw notFound();
  return route(rows[0]);
}

export async function listRoutes(
  sql: Sql,
  ownerUserId: string,
  limit: number,
  cursor?: string,
): Promise<RouteListResponse> {
  let cursorValue: { createdAt: string; id: string } | undefined;
  if (cursor) {
    try {
      cursorValue = cursorSchema.parse(
        JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
      );
    } catch {
      throw invalidCursor();
    }
  }
  const rows = cursorValue
    ? await sql<
        RouteRow[]
      >`select * from trail.routes where user_id=${ownerUserId} and (created_at,id) < (${cursorValue.createdAt},${cursorValue.id}) order by created_at desc,id desc limit ${limit + 1}`
    : await sql<
        RouteRow[]
      >`select * from trail.routes where user_id=${ownerUserId} order by created_at desc,id desc limit ${limit + 1}`;
  const hasMore = rows.length > limit;
  const visible = rows.slice(0, limit);
  const last = visible.at(-1);
  return {
    items: visible.map(route),
    page: {
      has_more: hasMore,
      next_cursor:
        hasMore && last
          ? Buffer.from(
              JSON.stringify({ createdAt: iso(last.created_at), id: last.id }),
            ).toString('base64url')
          : null,
    },
  };
}

export async function updateRoute(
  sql: Sql,
  ownerUserId: string,
  id: string,
  patch: UpdateRouteRequest,
): Promise<Route> {
  return sql.begin(async (transaction) => {
    const existing = await transaction<
      RouteRow[]
    >`select * from trail.routes where id=${id} and user_id=${ownerUserId} for update`;
    if (!existing[0]) throw notFound();
    const waypoints = patch.waypoints ?? existing[0].waypoints;
    const value = computed(waypoints);
    const rows = await transaction<RouteRow[]>`
      update trail.routes set
        name=${patch.name ?? existing[0].name},
        sport_hint=${patch.sport_hint === undefined ? existing[0].sport_hint : patch.sport_hint},
        waypoints=${JSON.stringify(waypoints)}::jsonb,
        polyline=${value.polyline}, distance_m=${value.distanceM}, elevation_gain_m=null, updated_at=now()
      where id=${id} and user_id=${ownerUserId} returning *`;
    return route(rows[0]!);
  });
}

export async function deleteRoute(
  sql: Sql,
  ownerUserId: string,
  id: string,
): Promise<void> {
  const rows = await sql<
    { id: string }[]
  >`delete from trail.routes where id=${id} and user_id=${ownerUserId} returning id`;
  if (!rows[0]) throw notFound();
}
