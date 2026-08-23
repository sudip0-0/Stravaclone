import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useNetInfo } from '@react-native-community/netinfo';
import type { StatsResponse, StatsSportFilter } from '@trail/contracts';
import { Body, Button, ScreenTitle, StatusBanner } from '../../components/ui';
import { useActivitySync } from '../activity-sync/sync-runtime';
import { useAppState } from '../../state/app-state';
import { recordingRepository } from '../../storage/recording-database';
import { spacing, useTheme } from '../../theme/tokens';
import {
  deriveStatsScreenViewModel,
  StatsController,
} from './stats-controller';
import {
  CALENDAR_CELL_SIZE,
  deviceTimezone,
  firstWeekday,
  formatCalendarDate,
  formatDistance,
  formatDuration,
  monthCells,
  pendingSyncMessage,
  presentTotals,
} from './stats-model';

const filters: readonly { label: string; value: StatsSportFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Run', value: 'run' },
  { label: 'Ride', value: 'ride' },
  { label: 'Walk', value: 'walk' },
  { label: 'Hike', value: 'hike' },
];

export function StatsScreen({
  openActivity,
  openProfile,
  openSettings,
}: {
  openActivity: (id: string) => void;
  openProfile: () => void;
  openSettings: () => void;
}) {
  const { api, profile, profilePhase, refreshProfile } = useAppState();
  const sync = useActivitySync();
  const theme = useTheme();
  const network = useNetInfo();
  const networkRef = useRef(network.isConnected);
  networkRef.current = network.isConnected;
  const locale = Intl.DateTimeFormat().resolvedOptions().locale || 'en-US';
  const timezone = deviceTimezone();
  const weekStartsOn = firstWeekday(locale);
  const controller = useMemo(
    () =>
      new StatsController({
        transport: api,
        pendingSource: recordingRepository,
        timezone,
        weekStartsOn,
        isOffline: () => networkRef.current === false,
      }),
    [api, timezone, weekStartsOn],
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => {
    controller.setProfile(
      profile ? { id: profile.id, units: profile.units } : null,
      profilePhase,
    );
  }, [controller, profile, profilePhase]);
  const profileId = profile?.id;
  const retryProfile = useCallback(async () => {
    try {
      await refreshProfile();
    } catch {
      /* App profile state exposes the confirmed retry failure. */
    }
  }, [refreshProfile]);
  useEffect(() => {
    if (profileId) void controller.requestRefresh();
  }, [controller, profileId, sync.pendingCount, sync.revision]);
  useFocusEffect(
    useCallback(() => {
      void controller.requestRefresh();
      return () => controller.cancel();
    }, [controller]),
  );
  useEffect(() => () => controller.cancel(), [controller]);

  const cells = useMemo(
    () =>
      monthCells(
        state.month.getFullYear(),
        state.month.getMonth(),
        weekStartsOn,
      ),
    [state.month, weekStartsOn],
  );
  const weekdayNames = useMemo(() => {
    const base = new Date(2024, 0, 7 + weekStartsOn);
    return Array.from({ length: 7 }, (_, index) =>
      new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(
        new Date(base.getFullYear(), base.getMonth(), base.getDate() + index),
      ),
    );
  }, [locale, weekStartsOn]);
  const currentMonth = new Date();
  const canMoveMonthForward =
    state.month.getFullYear() < currentMonth.getFullYear() ||
    (state.month.getFullYear() === currentMonth.getFullYear() &&
      state.month.getMonth() < currentMonth.getMonth());
  const view = deriveStatsScreenViewModel(state);
  const marks = view.currentData?.marks ?? {};
  const dayItems = view.currentData?.day.items ?? [];

  const renderTotals = (title: string, response: StatsResponse | undefined) => {
    const values =
      response && profile
        ? presentTotals(response.totals, profile.units, locale)
        : null;
    return (
      <View
        style={[
          styles.card,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
      >
        <Text
          accessibilityRole="header"
          style={[styles.cardTitle, { color: theme.textPrimary }]}
        >
          {title}
        </Text>
        {values && response && response.totals.activity_count > 0 ? (
          <View style={styles.metrics}>
            <Text style={{ color: theme.textPrimary }}>
              {values.distance} distance
            </Text>
            <Text style={{ color: theme.textPrimary }}>
              {values.time} moving
            </Text>
            <Text style={{ color: theme.textPrimary }}>
              {values.count} activities
            </Text>
            <Text style={{ color: theme.textPrimary }}>
              {values.elevation} elevation
            </Text>
          </View>
        ) : view.canShowCurrentEmptyState && response ? (
          <Body>No synchronized activities in this period.</Body>
        ) : state.loading ? (
          <Body>Loading synchronized totals…</Body>
        ) : (
          <Body>Totals are unavailable until the request succeeds.</Body>
        )}
      </View>
    );
  };

  const errorMessage =
    state.error === 'offline'
      ? 'Stats need a connection. Local pending activity status is still shown.'
      : state.error === 'network'
        ? view.currentData
          ? 'Training stats could not be refreshed. The last successful results for this selection remain visible.'
          : 'Training stats for this selection could not be loaded.'
        : null;
  const pendingMessage = pendingSyncMessage(state.pendingCount);

  return (
    <ScrollView
      contentContainerStyle={[
        styles.page,
        { backgroundColor: theme.background },
      ]}
    >
      <ScreenTitle>You</ScreenTitle>
      {!profile && profilePhase === 'loading' ? (
        <View accessibilityLiveRegion="polite" style={styles.loadingRow}>
          <ActivityIndicator
            accessibilityLabel="Loading your profile"
            color={theme.action}
          />
          <Body>Loading your profile…</Body>
        </View>
      ) : !profile && profilePhase === 'error' ? (
        <StatusBanner
          error
          message="Your profile couldn’t be loaded. Training stats are unavailable."
          action="Try again"
          onAction={() => void retryProfile()}
        />
      ) : profile ? (
        <Body>{profile.display_name}</Body>
      ) : null}
      {pendingMessage ? <StatusBanner message={pendingMessage} /> : null}
      {state.pendingError ? (
        <StatusBanner
          error
          message="Local pending activity status couldn’t be read. Server totals remain separate."
          action="Try again"
          onAction={() => void controller.requestRefresh()}
        />
      ) : null}
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Sport filter"
        style={styles.filters}
      >
        {filters.map((filter) => (
          <Pressable
            key={filter.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: state.sport === filter.value }}
            onPress={() => controller.setSport(filter.value)}
            style={[
              styles.pill,
              {
                borderColor: theme.border,
                backgroundColor:
                  state.sport === filter.value ? theme.action : theme.surface,
              },
            ]}
          >
            <Text
              style={{
                color:
                  state.sport === filter.value ? '#ffffff' : theme.textPrimary,
              }}
            >
              {filter.label}
            </Text>
          </Pressable>
        ))}
      </View>
      {errorMessage ? (
        <StatusBanner
          error
          message={errorMessage}
          action="Try again"
          onAction={() => void controller.requestRefresh()}
        />
      ) : null}
      {state.loading ? (
        <View accessibilityLiveRegion="polite" style={styles.loadingRow}>
          <ActivityIndicator
            accessibilityLabel="Loading training stats"
            color={theme.action}
          />
          <Body>
            {view.currentData
              ? 'Updating training stats; the last results for this selection remain visible.'
              : 'Loading training stats for this selection…'}
          </Body>
        </View>
      ) : null}
      <View style={styles.navigation}>
        <Button
          label="Previous week"
          variant="secondary"
          onPress={() => controller.moveWeek(-1)}
        />
        <Button
          disabled={state.weekOffset >= 0}
          label="Next week"
          variant="secondary"
          onPress={() => controller.moveWeek(1)}
        />
      </View>
      {renderTotals('Week', view.currentData?.week)}
      <View style={styles.navigation}>
        <Button
          label="Previous year"
          variant="secondary"
          onPress={() => controller.moveYear(-1)}
        />
        <Button
          disabled={state.yearOffset >= 0}
          label="Next year"
          variant="secondary"
          onPress={() => controller.moveYear(1)}
        />
      </View>
      {renderTotals('Year', view.currentData?.year)}
      <View style={styles.navigation}>
        <Button
          label="Previous month"
          variant="secondary"
          onPress={() => controller.moveMonth(-1)}
        />
        <Button
          disabled={!canMoveMonthForward}
          label="Next month"
          variant="secondary"
          onPress={() => controller.moveMonth(1)}
        />
      </View>
      <Text
        accessibilityRole="header"
        style={[styles.cardTitle, { color: theme.textPrimary }]}
      >
        {new Intl.DateTimeFormat(locale, {
          month: 'long',
          year: 'numeric',
        }).format(state.month)}
      </Text>
      <ScrollView
        accessibilityLabel="Calendar grid. Swipe horizontally to view all seven columns."
        horizontal
        showsHorizontalScrollIndicator
      >
        <View style={styles.grid}>
          {weekdayNames.map((name, index) => (
            <Text
              key={`${index}-${name}`}
              style={[styles.cell, { color: theme.textSecondary }]}
            >
              {name}
            </Text>
          ))}
          {cells.map((cell) => (
            <Pressable
              key={cell.date}
              accessibilityRole="button"
              accessibilityLabel={`${formatCalendarDate(cell.date, locale)}, ${new Intl.NumberFormat(locale).format(marks[cell.date] ?? 0)} activities`}
              accessibilityState={{
                disabled: !cell.inMonth,
                selected: state.selectedDate === cell.date,
              }}
              disabled={!cell.inMonth}
              onPress={() => controller.selectDate(cell.date)}
              style={[
                styles.cell,
                styles.day,
                {
                  borderColor:
                    state.selectedDate === cell.date
                      ? theme.action
                      : 'transparent',
                },
              ]}
            >
              <Text
                style={{
                  color: cell.inMonth ? theme.textPrimary : theme.textSecondary,
                }}
              >
                {cell.day}
              </Text>
              {marks[cell.date] ? (
                <Text
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={{ color: theme.action }}
                >
                  ●
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      </ScrollView>
      <Text
        accessibilityRole="header"
        style={[styles.cardTitle, { color: theme.textPrimary }]}
      >
        Activities on {formatCalendarDate(state.selectedDate, locale)}
      </Text>
      {view.canShowCurrentEmptyState && dayItems.length === 0 ? (
        <Body>No synchronized activities on this day.</Body>
      ) : !view.currentData && !state.loading ? (
        <Body>Day activities for this selection are unavailable.</Body>
      ) : null}
      {dayItems.map((item) => (
        <Pressable
          accessibilityRole="button"
          key={item.id}
          onPress={() => {
            const id = controller.activityToOpen(item.id);
            if (id) openActivity(id);
          }}
          style={[styles.activity, { borderColor: theme.border }]}
        >
          <Text style={[styles.activityTitle, { color: theme.textPrimary }]}>
            {item.title ?? item.sport[0]!.toUpperCase() + item.sport.slice(1)}
          </Text>
          <Text style={{ color: theme.textSecondary }}>
            {formatDistance(
              item.stats.distance_m,
              profile?.units ?? 'metric',
              locale,
            )}{' '}
            · {formatDuration(item.stats.moving_time_s, locale)}
          </Text>
        </Pressable>
      ))}
      <Button label="Profile" variant="secondary" onPress={openProfile} />
      <Button label="Settings" variant="secondary" onPress={openSettings} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  activity: { borderBottomWidth: 1, gap: 4, minHeight: 56, paddingVertical: 8 },
  activityTitle: { fontSize: 17, fontWeight: '600' },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    gap: spacing.space2,
    padding: spacing.space3,
  },
  cardTitle: { fontSize: 20, fontWeight: '700', lineHeight: 28 },
  cell: {
    minHeight: CALENDAR_CELL_SIZE,
    textAlign: 'center',
    width: CALENDAR_CELL_SIZE,
  },
  day: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 2,
    justifyContent: 'center',
    minHeight: 64,
    paddingVertical: spacing.space1,
  },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.space2 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.space1,
    width: CALENDAR_CELL_SIZE * 7,
  },
  loadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.space2,
  },
  metrics: { gap: spacing.space1 },
  navigation: {
    flexDirection: 'row',
    gap: spacing.space2,
    justifyContent: 'space-between',
  },
  page: { flexGrow: 1, gap: spacing.space3, padding: 20 },
  pill: {
    borderRadius: 20,
    borderWidth: 1,
    minHeight: 48,
    minWidth: 58,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
});
