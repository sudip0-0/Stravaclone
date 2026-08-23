import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  calendarGridLayout,
  firstWeekday,
  formatCalendarDate,
  formatDistance,
  formatElevation,
  monthCells,
  pendingSyncMessage,
  statsRange,
} from './stats-model';

const originalTimezone = process.env.TZ;
beforeEach(() => {
  process.env.TZ = 'America/New_York';
});
afterEach(() => {
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
});

describe('Phase 7 local calendar model', () => {
  it('uses Sunday and Monday locale week starts with robust fallback', () => {
    expect(firstWeekday('en-US')).toBe(0);
    expect(firstWeekday('en-GB')).toBe(1);
    expect(firstWeekday('not a locale')).toBe(1);
  });

  it('builds locale-aligned 42-day month grids across month boundaries', () => {
    const sunday = monthCells(2026, 2, 0);
    const monday = monthCells(2026, 2, 1);
    expect(sunday).toHaveLength(42);
    expect(sunday[0]).toMatchObject({ date: '2026-03-01', inMonth: true });
    expect(monday[0]).toMatchObject({ date: '2026-02-23', inMonth: false });
  });

  it('models seven fixed 48dp columns in a horizontal viewport at 320dp', () => {
    const layout = calendarGridLayout(320);
    expect(layout).toMatchObject({
      availableWidth: 280,
      cellHeight: 48,
      cellWidth: 48,
      columnCount: 7,
      gridWidth: 336,
      horizontalScrollRequired: true,
    });
    expect(layout.gridWidth).toBe(layout.cellWidth * layout.columnCount);
  });

  it('derives explicit UTC boundaries from local midnights across spring DST', () => {
    const range = statsRange('week', new Date(2026, 2, 10, 12), 0);
    expect(range).toEqual({
      starts_at: '2026-03-08T05:00:00.000Z',
      ends_at: '2026-03-15T04:00:00.000Z',
    });
    expect(
      (Date.parse(range.ends_at) - Date.parse(range.starts_at)) / 3_600_000,
    ).toBe(167);
  });

  it('derives explicit UTC boundaries across fall-back DST', () => {
    const range = statsRange('week', new Date(2026, 10, 3, 12), 0);
    expect(range).toEqual({
      starts_at: '2026-11-01T04:00:00.000Z',
      ends_at: '2026-11-08T05:00:00.000Z',
    });
    expect(
      (Date.parse(range.ends_at) - Date.parse(range.starts_at)) / 3_600_000,
    ).toBe(169);
  });

  it('derives local calendar year boundaries rather than fixed durations', () => {
    expect(statsRange('year', new Date(2026, 5, 1), 1, -1)).toEqual({
      starts_at: '2025-01-01T05:00:00.000Z',
      ends_at: '2026-01-01T05:00:00.000Z',
    });
  });

  it('formats SI totals at metric and imperial presentation boundaries', () => {
    expect(formatDistance(1609.344, 'metric', 'en-US')).toBe('1.6 km');
    expect(formatDistance(1609.344, 'imperial', 'en-US')).toBe('1 mi');
    expect(formatElevation(100, 'imperial', 'en-US')).toBe('328 ft');
    expect(formatDistance(1609.344, 'metric', 'de-DE')).toBe('1,6 km');
    expect(formatCalendarDate('2026-03-08', 'en-US')).toBe('March 8, 2026');
    expect(formatCalendarDate('2026-03-08', 'de-DE')).toBe('8. März 2026');
  });

  it('explains that pending local activities are excluded', () => {
    expect(pendingSyncMessage(0)).toBeNull();
    expect(pendingSyncMessage(1)).toContain(
      'excluded from these server totals',
    );
    expect(pendingSyncMessage(2)).toContain('2 activities are');
  });
});
