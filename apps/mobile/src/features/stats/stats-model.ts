import type { StatsQuery, StatsTotals, UnitSystem } from '@trail/contracts';

export type CalendarCell = { date: string; day: number; inMonth: boolean };

export const CALENDAR_COLUMN_COUNT = 7;
export const CALENDAR_CELL_SIZE = 48;

export function calendarGridLayout(
  viewportWidth: number,
  horizontalPagePadding = 40,
) {
  const availableWidth = Math.max(0, viewportWidth - horizontalPagePadding);
  const gridWidth = CALENDAR_COLUMN_COUNT * CALENDAR_CELL_SIZE;
  return {
    availableWidth,
    cellHeight: CALENDAR_CELL_SIZE,
    cellWidth: CALENDAR_CELL_SIZE,
    columnCount: CALENDAR_COLUMN_COUNT,
    gridWidth,
    horizontalScrollRequired: gridWidth > availableWidth,
  };
}

export function deviceTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

const sundayRegions = new Set([
  'US',
  'CA',
  'MX',
  'BR',
  'JP',
  'PH',
  'AU',
  'NZ',
  'IN',
]);
const saturdayRegions = new Set([
  'AE',
  'AF',
  'BH',
  'DJ',
  'DZ',
  'EG',
  'IQ',
  'IR',
  'JO',
  'KW',
  'LY',
  'OM',
  'QA',
  'SD',
  'SY',
]);

export function firstWeekday(locale: string): number {
  try {
    const Locale = Intl.Locale as unknown as new (tag: string) => {
      region?: string;
      weekInfo?: { firstDay: number };
      getWeekInfo?: () => { firstDay: number };
    };
    const parsed = new Locale(locale);
    const first = parsed.weekInfo?.firstDay ?? parsed.getWeekInfo?.().firstDay;
    if (first && first >= 1 && first <= 7) return first % 7;
    const region = parsed.region;
    if (region && saturdayRegions.has(region)) return 6;
    if (region && sundayRegions.has(region)) return 0;
  } catch {
    // Invalid or unsupported locale falls through to ISO Monday.
  }
  return 1;
}

function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

export function statsRange(
  period: 'week' | 'year',
  anchor: Date,
  weekStartsOn: number,
  offset = 0,
): Pick<StatsQuery, 'starts_at' | 'ends_at'> {
  if (period === 'year') {
    const year = anchor.getFullYear() + offset;
    return {
      starts_at: new Date(year, 0, 1).toISOString(),
      ends_at: new Date(year + 1, 0, 1).toISOString(),
    };
  }
  const start = startOfLocalDay(anchor);
  start.setDate(
    start.getDate() - ((start.getDay() - weekStartsOn + 7) % 7) + offset * 7,
  );
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { starts_at: start.toISOString(), ends_at: end.toISOString() };
}

export function localDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function monthCells(
  year: number,
  monthIndex: number,
  weekStartsOn: number,
): CalendarCell[] {
  const first = new Date(year, monthIndex, 1);
  const leading = (first.getDay() - weekStartsOn + 7) % 7;
  const gridStart = new Date(year, monthIndex, 1 - leading);
  const cells: CalendarCell[] = [];
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    cells.push({
      date: localDateKey(date),
      day: date.getDate(),
      inMonth: date.getMonth() === monthIndex,
    });
  }
  return cells;
}

export function formatDistance(
  meters: number,
  units: UnitSystem,
  locale: string,
) {
  const value = units === 'metric' ? meters / 1000 : meters / 1609.344;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} ${units === 'metric' ? 'km' : 'mi'}`;
}

export function formatElevation(
  meters: number,
  units: UnitSystem,
  locale: string,
) {
  const value = units === 'metric' ? meters : meters * 3.28084;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)} ${units === 'metric' ? 'm' : 'ft'}`;
}

export function formatDuration(
  seconds: number,
  locale = Intl.DateTimeFormat().resolvedOptions().locale || 'en-US',
): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const number = new Intl.NumberFormat(locale);
  return hours > 0
    ? `${number.format(hours)}h ${number.format(minutes)}m`
    : `${number.format(minutes)}m`;
}

export function formatCalendarDate(dateKey: string, locale: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!year || !month || !day) return dateKey;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(
    new Date(year, month - 1, day),
  );
}

export function pendingSyncMessage(count: number): string | null {
  if (count <= 0) return null;
  return `${count} ${count === 1 ? 'activity is' : 'activities are'} waiting to sync and excluded from these server totals.`;
}

export function presentTotals(
  totals: StatsTotals,
  units: UnitSystem,
  locale: string,
) {
  return {
    distance: formatDistance(totals.distance_m, units, locale),
    time: formatDuration(totals.moving_time_s, locale),
    count: new Intl.NumberFormat(locale).format(totals.activity_count),
    elevation: formatElevation(totals.elevation_gain_m, units, locale),
  };
}
