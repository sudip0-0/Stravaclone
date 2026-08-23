import { describe, expect, it, vi } from 'vitest';
import type {
  CalendarDayResponse,
  CalendarResponse,
  StatsQuery,
  StatsResponse,
  StatsSportFilter,
} from '@trail/contracts';
import {
  deriveStatsScreenViewModel,
  StatsController,
  type StatsTransport,
} from './stats-controller';

function stats(
  period: 'week' | 'year',
  sport: StatsSportFilter,
  count = 1,
): StatsResponse {
  return {
    period,
    sport,
    starts_at: '2026-01-01T05:00:00.000Z',
    ends_at:
      period === 'week'
        ? '2026-01-08T05:00:00.000Z'
        : '2027-01-01T05:00:00.000Z',
    totals: {
      distance_m: count * 1000,
      moving_time_s: count * 600,
      activity_count: count,
      elevation_gain_m: count * 10,
    },
  };
}

function day(date: string, id?: string): CalendarDayResponse {
  return {
    date,
    items: id
      ? [
          {
            id,
            sport: 'run',
            title: 'Run',
            started_at: '2026-01-15T12:00:00.000Z',
            stats: {
              distance_m: 1000,
              moving_time_s: 600,
              elapsed_time_s: 600,
              elevation_gain_m: 10,
              elevation_loss_m: 5,
              average_pace_s_per_km: 600,
              average_speed_mps: 1.666,
            },
          },
        ]
      : [],
  };
}

function transport(count = 1): StatsTransport {
  return {
    getStats: vi.fn(async (query: StatsQuery) =>
      stats(query.period, query.sport, count),
    ),
    getCalendar: vi.fn(
      async (): Promise<CalendarResponse> => ({
        days: count ? [{ date: '2026-01-15', activity_count: count }] : [],
      }),
    ),
    getCalendarDay: vi.fn(async (date: string) =>
      day(date, count ? '00000000-0000-4000-8000-000000000001' : undefined),
    ),
  };
}

function failureControlledTransport() {
  let fail = false;
  const rejectIfNeeded = () => {
    if (fail) throw new Error('request failed');
  };
  const api: StatsTransport = {
    async getStats(query) {
      rejectIfNeeded();
      return stats(query.period, query.sport);
    },
    async getCalendar() {
      rejectIfNeeded();
      return { days: [{ date: '2026-01-15', activity_count: 1 }] };
    },
    async getCalendarDay(date) {
      rejectIfNeeded();
      return day(date, '00000000-0000-4000-8000-000000000001');
    },
  };
  return { api, fail: () => (fail = true) };
}

function create(
  api: StatsTransport = transport(),
  pendingCount: () => Promise<number> = async () => 0,
  offline = false,
) {
  return new StatsController({
    transport: api,
    pendingSource: { pendingCount },
    timezone: 'America/New_York',
    weekStartsOn: 0,
    now: () => new Date(2026, 0, 20, 12),
    isOffline: () => offline,
  });
}

async function waitFor(
  controller: StatsController,
  predicate: () => boolean,
): Promise<void> {
  if (predicate()) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error('controller state timeout'));
    }, 2_000);
    const unsubscribe = controller.subscribe(() => {
      if (!predicate()) return;
      clearTimeout(timeout);
      unsubscribe();
      resolve();
    });
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('Phase 7 stats controller', () => {
  it('shows initial profile loading before a confirmed profile failure', () => {
    const controller = create();
    expect(controller.getSnapshot()).toMatchObject({
      profilePhase: 'loading',
      loading: true,
      error: null,
      data: null,
    });
    void controller.requestRefresh();
    expect(controller.getSnapshot()).toMatchObject({
      loading: true,
      error: null,
    });
  });

  it('ends loading on profile failure and succeeds after profile retry', async () => {
    const controller = create();
    controller.setProfile(null, 'error');
    expect(controller.getSnapshot()).toMatchObject({
      loading: false,
      error: 'profile',
      data: null,
    });
    controller.setProfile({ id: 'owner', units: 'metric' });
    await waitFor(controller, () => controller.getSnapshot().dataIsCurrent);
    expect(controller.getSnapshot()).toMatchObject({
      loading: false,
      error: null,
    });
  });

  it('loads local pending state independently when every API call fails offline', async () => {
    const api: StatsTransport = {
      getStats: vi.fn(async () => Promise.reject(new Error('offline'))),
      getCalendar: vi.fn(async () => Promise.reject(new Error('offline'))),
      getCalendarDay: vi.fn(async () => Promise.reject(new Error('offline'))),
    };
    const pending = vi.fn(async () => 2);
    const controller = create(api, pending, true);
    controller.setProfile({ id: 'owner', units: 'metric' });
    await waitFor(controller, () => !controller.getSnapshot().loading);
    expect(pending).toHaveBeenCalledWith('owner');
    expect(controller.getSnapshot()).toMatchObject({
      pendingCount: 2,
      pendingLoading: false,
      error: 'offline',
      data: null,
    });
  });

  it('aborts stale filter responses and queues only one latest refresh', async () => {
    const firstWeek = deferred<StatsResponse>();
    const firstYear = deferred<StatsResponse>();
    const firstCalendar = deferred<CalendarResponse>();
    const firstDay = deferred<CalendarDayResponse>();
    let calls = 0;
    let statsCalls = 0;
    const api: StatsTransport = {
      getStats: vi.fn(async (query: StatsQuery) => {
        calls += 1;
        const index = statsCalls++;
        if (index === 0) return firstWeek.promise;
        if (index === 1) return firstYear.promise;
        return stats(query.period, query.sport, 3);
      }),
      getCalendar: vi.fn(async () => {
        calls += 1;
        return calls <= 4
          ? firstCalendar.promise
          : { days: [{ date: '2026-01-15', activity_count: 3 }] };
      }),
      getCalendarDay: vi.fn(async (date: string) => {
        calls += 1;
        return calls <= 4
          ? firstDay.promise
          : day(date, '00000000-0000-4000-8000-000000000003');
      }),
    };
    const controller = create(api);
    controller.setProfile({ id: 'owner', units: 'metric' });
    controller.setSport('run');
    controller.setSport('ride');
    firstWeek.resolve(stats('week', 'all', 1));
    firstYear.resolve(stats('year', 'all', 1));
    firstCalendar.resolve({ days: [] });
    firstDay.resolve(day('2026-01-20'));
    await waitFor(
      controller,
      () => controller.getSnapshot().data?.week.sport === 'ride',
    );
    expect(controller.getSnapshot().data?.week.totals.activity_count).toBe(3);
    expect(calls).toBe(8);
  });

  it('hides retained totals/calendar/day data during and after a failed sport change', async () => {
    const controlled = failureControlledTransport();
    const controller = create(controlled.api);
    controller.setProfile({ id: 'owner', units: 'metric' });
    await waitFor(controller, () => controller.getSnapshot().dataIsCurrent);
    controlled.fail();
    controller.setSport('ride');
    expect(deriveStatsScreenViewModel(controller.getSnapshot())).toMatchObject({
      currentData: null,
      hasRetainedData: true,
      loading: true,
    });
    await waitFor(
      controller,
      () => controller.getSnapshot().error === 'network',
    );
    expect(deriveStatsScreenViewModel(controller.getSnapshot())).toMatchObject({
      currentData: null,
      hasRetainedData: true,
      loading: false,
      error: 'network',
      canShowCurrentEmptyState: false,
    });
  });

  it('hides retained marks and day rows during and after a failed month change', async () => {
    const controlled = failureControlledTransport();
    const controller = create(controlled.api);
    controller.setProfile({ id: 'owner', units: 'metric' });
    await waitFor(controller, () => controller.getSnapshot().dataIsCurrent);
    controlled.fail();
    controller.moveMonth(-1);
    expect(
      deriveStatsScreenViewModel(controller.getSnapshot()).currentData,
    ).toBeNull();
    expect(
      controller.activityToOpen('00000000-0000-4000-8000-000000000001'),
    ).toBeNull();
    await waitFor(
      controller,
      () => controller.getSnapshot().error === 'network',
    );
    const failed = deriveStatsScreenViewModel(controller.getSnapshot());
    expect(failed.currentData).toBeNull();
    expect(failed.hasRetainedData).toBe(true);
    expect(controller.getSnapshot().selectedDate).toBe('2025-12-01');
  });

  it('hides retained selected-day rows during and after a failed day change', async () => {
    const controlled = failureControlledTransport();
    const controller = create(controlled.api);
    controller.setProfile({ id: 'owner', units: 'metric' });
    await waitFor(controller, () => controller.getSnapshot().dataIsCurrent);
    controlled.fail();
    controller.selectDate('2026-01-15');
    const intermediate = deriveStatsScreenViewModel(controller.getSnapshot());
    expect(intermediate.currentData).toBeNull();
    expect(intermediate.loading).toBe(true);
    await waitFor(
      controller,
      () => controller.getSnapshot().error === 'network',
    );
    expect(deriveStatsScreenViewModel(controller.getSnapshot())).toMatchObject({
      currentData: null,
      hasRetainedData: true,
      error: 'network',
    });
  });

  it('ignores stale pending-count results from an older generation', async () => {
    const firstPending = deferred<number>();
    let calls = 0;
    const controller = create(transport(), () => {
      calls += 1;
      return calls === 1 ? firstPending.promise : Promise.resolve(4);
    });
    controller.setProfile({ id: 'owner', units: 'metric' });
    void controller.requestRefresh();
    firstPending.resolve(99);
    await waitFor(
      controller,
      () => controller.getSnapshot().pendingCount === 4,
    );
    expect(controller.getSnapshot().pendingCount).toBe(4);
  });

  it('refreshes successful data after focus/sync revisions such as deletion and late sync', async () => {
    let count = 2;
    const api = transport();
    // The test transport is a Vitest mock; accessing it detached is intentional.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    vi.mocked(api.getStats).mockImplementation(async (query) =>
      stats(query.period, query.sport, count),
    );
    const controller = create(api);
    controller.setProfile({ id: 'owner', units: 'metric' });
    await waitFor(controller, () => controller.getSnapshot().dataIsCurrent);
    count = 1;
    await controller.requestRefresh();
    expect(controller.getSnapshot().data?.week.totals.activity_count).toBe(1);
    count = 3;
    await controller.requestRefresh();
    expect(controller.getSnapshot().data?.week.totals.activity_count).toBe(3);
  });

  it('reloads filters but applies unit changes locally without a server refresh', async () => {
    const api = transport();
    const controller = create(api);
    controller.setProfile({ id: 'owner', units: 'metric' });
    await waitFor(controller, () => controller.getSnapshot().dataIsCurrent);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const beforeUnits = vi.mocked(api.getStats).mock.calls.length;
    controller.setProfile({ id: 'owner', units: 'imperial' });
    expect(controller.getSnapshot().profile?.units).toBe('imperial');
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(vi.mocked(api.getStats)).toHaveBeenCalledTimes(beforeUnits);
    controller.setSport('hike');
    await waitFor(
      controller,
      () => controller.getSnapshot().data?.week.sport === 'hike',
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(vi.mocked(api.getStats).mock.calls.length).toBeGreaterThan(
      beforeUnits,
    );
  });

  it('models calendar selection and only opens a loaded selected-day activity', async () => {
    const controller = create();
    controller.setProfile({ id: 'owner', units: 'metric' });
    await waitFor(controller, () => controller.getSnapshot().dataIsCurrent);
    controller.selectDate('2026-01-15');
    await waitFor(
      controller,
      () => controller.getSnapshot().data?.day.date === '2026-01-15',
    );
    expect(
      controller.activityToOpen('00000000-0000-4000-8000-000000000001'),
    ).toBe('00000000-0000-4000-8000-000000000001');
    expect(controller.activityToOpen('missing')).toBeNull();
    controller.selectDate('2026-02-01');
    expect(controller.getSnapshot().selectedDate).toBe('2026-01-15');
  });

  it('bounds future week, year, and month navigation', async () => {
    const controller = create();
    controller.setProfile({ id: 'owner', units: 'metric' });
    await waitFor(controller, () => controller.getSnapshot().dataIsCurrent);
    controller.moveWeek(1);
    controller.moveYear(1);
    controller.moveMonth(1);
    expect(controller.getSnapshot()).toMatchObject({
      weekOffset: 0,
      yearOffset: 0,
      selectedDate: '2026-01-20',
    });
    controller.moveWeek(-1);
    controller.moveYear(-1);
    controller.moveMonth(-1);
    expect(controller.getSnapshot()).toMatchObject({
      weekOffset: -1,
      yearOffset: -1,
      selectedDate: '2025-12-01',
    });
  });
});
