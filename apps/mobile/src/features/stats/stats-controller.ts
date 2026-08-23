import type {
  CalendarDayResponse,
  CalendarResponse,
  StatsQuery,
  StatsResponse,
  StatsSportFilter,
  UnitSystem,
} from '@trail/contracts';
import { localDateKey, statsRange } from './stats-model';

export interface StatsTransport {
  getStats(query: StatsQuery, signal?: AbortSignal): Promise<StatsResponse>;
  getCalendar(
    year: number,
    month: number,
    timezone: string,
    sport: StatsSportFilter,
    signal?: AbortSignal,
  ): Promise<CalendarResponse>;
  getCalendarDay(
    date: string,
    timezone: string,
    sport: StatsSportFilter,
    signal?: AbortSignal,
  ): Promise<CalendarDayResponse>;
}

export interface PendingActivitySource {
  pendingCount(ownerUserId: string): Promise<number>;
}

export interface StatsProfile {
  readonly id: string;
  readonly units: UnitSystem;
}

export interface StatsData {
  readonly week: StatsResponse;
  readonly year: StatsResponse;
  readonly marks: Readonly<Record<string, number>>;
  readonly day: CalendarDayResponse;
}

export interface StatsScreenViewModel {
  readonly currentData: StatsData | null;
  readonly hasRetainedData: boolean;
  readonly loading: boolean;
  readonly error: StatsControllerState['error'];
  readonly canShowCurrentEmptyState: boolean;
}

export interface StatsControllerState {
  readonly profile: StatsProfile | null;
  readonly profilePhase: 'loading' | 'ready' | 'error';
  readonly sport: StatsSportFilter;
  readonly weekOffset: number;
  readonly yearOffset: number;
  readonly month: Date;
  readonly selectedDate: string;
  readonly loading: boolean;
  readonly error: 'profile' | 'offline' | 'network' | null;
  readonly data: StatsData | null;
  readonly dataIsCurrent: boolean;
  readonly pendingCount: number;
  readonly pendingLoading: boolean;
  readonly pendingError: boolean;
}

export function deriveStatsScreenViewModel(
  state: StatsControllerState,
): StatsScreenViewModel {
  const currentData = state.dataIsCurrent ? state.data : null;
  return {
    currentData,
    hasRetainedData: state.data !== null && currentData === null,
    loading: state.loading,
    error: state.error,
    canShowCurrentEmptyState: currentData !== null,
  };
}

interface StatsControllerOptions {
  readonly transport: StatsTransport;
  readonly pendingSource: PendingActivitySource;
  readonly timezone: string;
  readonly weekStartsOn: number;
  readonly now?: () => Date;
  readonly isOffline?: () => boolean;
}

type Listener = () => void;

export class StatsController {
  private readonly listeners = new Set<Listener>();
  private generation = 0;
  private queued = false;
  private running: Promise<void> | null = null;
  private abortController: AbortController | null = null;
  private dataKey: string | null = null;
  private state: StatsControllerState;

  constructor(private readonly options: StatsControllerOptions) {
    const now = options.now?.() ?? new Date();
    this.state = {
      profile: null,
      profilePhase: 'loading',
      sport: 'all',
      weekOffset: 0,
      yearOffset: 0,
      month: new Date(now.getFullYear(), now.getMonth(), 1),
      selectedDate: localDateKey(now),
      loading: true,
      error: null,
      data: null,
      dataIsCurrent: false,
      pendingCount: 0,
      pendingLoading: false,
      pendingError: false,
    };
  }

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): StatsControllerState => this.state;

  setProfile(
    profile: StatsProfile | null,
    profilePhase: StatsControllerState['profilePhase'] = profile
      ? 'ready'
      : 'error',
  ): void {
    const previous = this.state.profile;
    if (!profile) {
      this.cancel();
      this.setState({
        profile: null,
        profilePhase,
        loading: profilePhase === 'loading',
        error: profilePhase === 'error' ? 'profile' : null,
        data: null,
        dataIsCurrent: false,
        pendingCount: 0,
        pendingLoading: false,
        pendingError: false,
      });
      return;
    }
    const ownerChanged = previous?.id !== profile.id;
    this.setState({
      profile,
      profilePhase,
      ...(ownerChanged
        ? { data: null, dataIsCurrent: false, pendingCount: 0 }
        : {}),
      error: null,
    });
    if (ownerChanged) void this.requestRefresh();
  }

  setSport(sport: StatsSportFilter): void {
    if (sport === this.state.sport) return;
    this.setState({ sport, dataIsCurrent: false });
    void this.requestRefresh();
  }

  moveWeek(delta: -1 | 1): void {
    const next = Math.min(0, this.state.weekOffset + delta);
    if (next === this.state.weekOffset) return;
    this.setState({ weekOffset: next, dataIsCurrent: false });
    void this.requestRefresh();
  }

  moveYear(delta: -1 | 1): void {
    const next = Math.min(0, this.state.yearOffset + delta);
    if (next === this.state.yearOffset) return;
    this.setState({ yearOffset: next, dataIsCurrent: false });
    void this.requestRefresh();
  }

  moveMonth(delta: -1 | 1): void {
    const current = this.state.month;
    const next = new Date(current.getFullYear(), current.getMonth() + delta, 1);
    const now = this.options.now?.() ?? new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    if (next > currentMonth) return;
    this.setState({
      month: next,
      selectedDate: localDateKey(next),
      dataIsCurrent: false,
    });
    void this.requestRefresh();
  }

  selectDate(date: string): void {
    const prefix = `${this.state.month.getFullYear()}-${String(
      this.state.month.getMonth() + 1,
    ).padStart(2, '0')}-`;
    if (!date.startsWith(prefix) || date === this.state.selectedDate) return;
    this.setState({ selectedDate: date, dataIsCurrent: false });
    void this.requestRefresh();
  }

  activityToOpen(id: string): string | null {
    return this.state.dataIsCurrent &&
      this.state.data?.day.items.some((item) => item.id === id)
      ? id
      : null;
  }

  requestRefresh(): Promise<void> {
    if (!this.state.profile) {
      this.setState({
        loading: this.state.profilePhase === 'loading',
        error: this.state.profilePhase === 'error' ? 'profile' : null,
      });
      return Promise.resolve();
    }
    this.generation += 1;
    this.queued = true;
    this.setState({ loading: true, error: null });
    this.abortController?.abort();
    if (!this.running) this.running = this.drain();
    return this.running;
  }

  cancel(): void {
    this.generation += 1;
    this.queued = false;
    this.abortController?.abort();
    this.abortController = null;
  }

  private async drain(): Promise<void> {
    try {
      while (this.queued) {
        this.queued = false;
        await this.loadGeneration(this.generation);
      }
    } finally {
      this.running = null;
      if (this.queued) void this.requestRefresh();
    }
  }

  private async loadGeneration(generation: number): Promise<void> {
    const profile = this.state.profile;
    if (!profile) return;
    const snapshot = this.querySnapshot();
    const key = this.queryKey(snapshot);
    const abortController = new AbortController();
    this.abortController = abortController;
    this.setState({
      loading: true,
      error: null,
      dataIsCurrent: this.dataKey === key,
      pendingLoading: true,
      pendingError: false,
    });

    const pendingPromise = this.options.pendingSource
      .pendingCount(profile.id)
      .then((count) => {
        if (
          generation === this.generation &&
          this.state.profile?.id === profile.id
        )
          this.setState({
            pendingCount: count,
            pendingLoading: false,
            pendingError: false,
          });
      })
      .catch(() => {
        if (
          generation === this.generation &&
          this.state.profile?.id === profile.id
        )
          this.setState({ pendingLoading: false, pendingError: true });
      });

    const weekRange = statsRange(
      'week',
      snapshot.anchor,
      this.options.weekStartsOn,
      snapshot.weekOffset,
    );
    const yearRange = statsRange(
      'year',
      snapshot.anchor,
      this.options.weekStartsOn,
      snapshot.yearOffset,
    );
    try {
      const [week, year, calendar, day] = await Promise.all([
        this.options.transport.getStats(
          {
            period: 'week',
            sport: snapshot.sport,
            timezone: this.options.timezone,
            ...weekRange,
          },
          abortController.signal,
        ),
        this.options.transport.getStats(
          {
            period: 'year',
            sport: snapshot.sport,
            timezone: this.options.timezone,
            ...yearRange,
          },
          abortController.signal,
        ),
        this.options.transport.getCalendar(
          snapshot.month.getFullYear(),
          snapshot.month.getMonth() + 1,
          this.options.timezone,
          snapshot.sport,
          abortController.signal,
        ),
        this.options.transport.getCalendarDay(
          snapshot.selectedDate,
          this.options.timezone,
          snapshot.sport,
          abortController.signal,
        ),
      ]);
      if (generation !== this.generation || abortController.signal.aborted)
        return;
      const data: StatsData = {
        week,
        year,
        marks: Object.fromEntries(
          calendar.days.map((item) => [item.date, item.activity_count]),
        ),
        day,
      };
      this.dataKey = key;
      this.setState({ data, dataIsCurrent: true, loading: false, error: null });
    } catch {
      if (generation !== this.generation || abortController.signal.aborted)
        return;
      this.setState({
        loading: false,
        dataIsCurrent: this.dataKey === key,
        error: this.options.isOffline?.() ? 'offline' : 'network',
      });
    } finally {
      await pendingPromise;
      if (this.abortController === abortController) this.abortController = null;
    }
  }

  private querySnapshot() {
    return {
      anchor: this.options.now?.() ?? new Date(),
      sport: this.state.sport,
      weekOffset: this.state.weekOffset,
      yearOffset: this.state.yearOffset,
      month: new Date(this.state.month),
      selectedDate: this.state.selectedDate,
    };
  }

  private queryKey(snapshot: ReturnType<StatsController['querySnapshot']>) {
    return [
      snapshot.sport,
      snapshot.weekOffset,
      snapshot.yearOffset,
      snapshot.month.getFullYear(),
      snapshot.month.getMonth(),
      snapshot.selectedDate,
      this.options.timezone,
    ].join('|');
  }

  private setState(patch: Partial<StatsControllerState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
}
