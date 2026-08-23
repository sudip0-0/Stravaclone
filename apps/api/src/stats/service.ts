import type {
  ActivitySummary,
  CalendarDayQuery,
  StatsQuery,
  StatsResponse,
} from '@trail/contracts';
import type { Sql } from 'postgres';
import { ApplicationError } from '../http/application-error.js';

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function invalidPeriod(): never {
  throw new ApplicationError({
    statusCode: 400,
    code: 'invalid_request',
    publicMessage: 'The requested local calendar period is invalid',
  });
}

function localParts(instant: string, timezone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US-u-nu-latn', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

function localDateNumber(parts: LocalParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000;
}

export function validateStatsPeriod(query: StatsQuery): void {
  const start = localParts(query.starts_at, query.timezone);
  const end = localParts(query.ends_at, query.timezone);
  if (
    start.hour !== 0 ||
    start.minute !== 0 ||
    start.second !== 0 ||
    end.hour !== 0 ||
    end.minute !== 0 ||
    end.second !== 0
  )
    invalidPeriod();
  const localDays = localDateNumber(end) - localDateNumber(start);
  const elapsedHours =
    (Date.parse(query.ends_at) - Date.parse(query.starts_at)) / 3_600_000;
  if (query.period === 'week') {
    if (localDays !== 7 || elapsedHours < 167 || elapsedHours > 169)
      invalidPeriod();
    return;
  }
  if (
    start.month !== 1 ||
    start.day !== 1 ||
    end.month !== 1 ||
    end.day !== 1 ||
    end.year !== start.year + 1 ||
    localDays < 365 ||
    localDays > 366 ||
    elapsedHours < 8_759 ||
    elapsedHours > 8_785
  )
    invalidPeriod();
}

interface TotalsRow {
  distance_m: number;
  moving_time_s: number;
  activity_count: number;
  elevation_gain_m: number;
}

export async function getStats(
  sql: Sql,
  ownerUserId: string,
  query: StatsQuery,
): Promise<StatsResponse> {
  validateStatsPeriod(query);
  const rows = await sql<TotalsRow[]>`
    select
      coalesce(sum(distance_m), 0)::double precision as distance_m,
      coalesce(sum(moving_time_s), 0)::double precision as moving_time_s,
      count(*)::integer as activity_count,
      coalesce(sum(elevation_gain_m), 0)::double precision as elevation_gain_m
    from trail.activities
    where user_id=${ownerUserId}
      and started_at >= ${query.starts_at}
      and started_at < ${query.ends_at}
      and (${query.sport} = 'all' or sport=${query.sport})`;
  return {
    period: query.period,
    sport: query.sport,
    starts_at: new Date(query.starts_at).toISOString(),
    ends_at: new Date(query.ends_at).toISOString(),
    totals: rows[0] ?? {
      distance_m: 0,
      moving_time_s: 0,
      activity_count: 0,
      elevation_gain_m: 0,
    },
  };
}

interface BoundsRow {
  starts_at: Date | string;
  ends_at: Date | string;
}

async function localBounds(
  sql: Sql,
  timezone: string,
  localStart: string,
  interval: '1 day' | '1 month',
): Promise<{ startsAt: string; endsAt: string }> {
  const rows = await sql<BoundsRow[]>`
    select
      (${localStart}::date::timestamp at time zone ${timezone}) as starts_at,
      ((${localStart}::date + ${interval}::interval)::timestamp at time zone ${timezone}) as ends_at`;
  const row = rows[0];
  if (!row) invalidPeriod();
  return {
    startsAt: new Date(row.starts_at).toISOString(),
    endsAt: new Date(row.ends_at).toISOString(),
  };
}

function validDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export async function getCalendar(
  sql: Sql,
  ownerUserId: string,
  query: {
    year: number;
    month: number;
    timezone: string;
    sport: StatsQuery['sport'];
  },
) {
  const localStart = `${String(query.year).padStart(4, '0')}-${String(query.month).padStart(2, '0')}-01`;
  const bounds = await localBounds(sql, query.timezone, localStart, '1 month');
  const rows = await sql<{ date: string; activity_count: number }[]>`
    select to_char(local_date, 'YYYY-MM-DD') as date,
           count(*)::integer as activity_count
    from (
      select (started_at at time zone ${query.timezone})::date as local_date
      from trail.activities
      where user_id=${ownerUserId}
        and started_at >= ${bounds.startsAt}
        and started_at < ${bounds.endsAt}
        and (${query.sport} = 'all' or sport=${query.sport})
    ) bounded_activities
    group by local_date
    order by local_date`;
  return { days: rows };
}

interface SummaryRow {
  id: string;
  sport: ActivitySummary['sport'];
  title: string | null;
  started_at: Date | string;
  distance_m: number;
  moving_time_s: number;
  elapsed_time_s: number;
  elevation_gain_m: number;
  elevation_loss_m: number;
}

export async function getCalendarDay(
  sql: Sql,
  ownerUserId: string,
  query: CalendarDayQuery,
) {
  const [year, month, day] = query.date.split('-').map(Number);
  if (!validDate(year!, month!, day!)) invalidPeriod();
  const bounds = await localBounds(sql, query.timezone, query.date, '1 day');
  const rows = await sql<SummaryRow[]>`
    select id,sport,title,started_at,distance_m,moving_time_s,elapsed_time_s,
           elevation_gain_m,elevation_loss_m
    from trail.activities
    where user_id=${ownerUserId}
      and started_at >= ${bounds.startsAt}
      and started_at < ${bounds.endsAt}
      and (${query.sport} = 'all' or sport=${query.sport})
    order by started_at desc,id desc
    limit 200`;
  return {
    date: query.date,
    items: rows.map((row) => ({
      id: row.id,
      sport: row.sport,
      title: row.title,
      started_at: new Date(row.started_at).toISOString(),
      stats: {
        distance_m: row.distance_m,
        moving_time_s: row.moving_time_s,
        elapsed_time_s: row.elapsed_time_s,
        elevation_gain_m: row.elevation_gain_m,
        elevation_loss_m: row.elevation_loss_m,
        average_pace_s_per_km:
          row.distance_m > 0
            ? (row.moving_time_s * 1000) / row.distance_m
            : null,
        average_speed_mps:
          row.moving_time_s > 0 ? row.distance_m / row.moving_time_s : null,
      },
    })),
  };
}
