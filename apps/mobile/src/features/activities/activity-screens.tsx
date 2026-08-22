import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import type { Activity, ActivitySummary } from '@trail/contracts';
import { Body, Button, ScreenTitle, StatusBanner } from '../../components/ui';
import { useAppState } from '../../state/app-state';
import { recordingRepository } from '../../storage/recording-database';
import { spacing, useTheme } from '../../theme/tokens';
import { useActivitySync } from '../activity-sync/sync-runtime';
import { PhotoGallery } from '../photos/photo-gallery';
import { ActivityMap } from './activity-map';
import {
  activityTitle,
  ActivityLoadQueue,
  buildActivityDisplayGeometry,
  elevationLabel,
  formatActivityDistance,
  formatActivityDuration,
  formatActivityPace,
  formatActivitySpeed,
  formatElevation,
  mergeActivityRows,
} from './activity-model';

export type ActivityParamList = {
  ActivityHome: undefined;
  ActivityDetail: { id: string };
};
const Stack = createNativeStackNavigator<ActivityParamList>();
type PendingSummary = ActivitySummary & {
  pending: true;
  syncStatus: 'waiting_to_upload' | 'uploading' | 'needs_attention';
};

function ActivityListScreen({
  navigation,
}: NativeStackScreenProps<ActivityParamList, 'ActivityHome'>) {
  const { api, profile } = useAppState();
  const sync = useActivitySync();
  const theme = useTheme();
  const [remote, setRemote] = useState<ActivitySummary[]>([]);
  const [pending, setPending] = useState<PendingSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadQueue = useRef(new ActivityLoadQueue());
  const load = async (next?: string) => {
    if (!profile || !loadQueue.current.begin(next)) return;
    setError(null);
    try {
      setPending(await recordingRepository.pendingActivityRows(profile.id));
      const page = await api.listActivities(next, 50);
      setRemote((current) => {
        const values = next ? [...current, ...page.items] : [...page.items];
        return [
          ...new Map(values.map((item) => [item.id, item])).values(),
        ].slice(0, 200);
      });
      setCursor(page.page.next_cursor);
    } catch {
      setError(
        'Activities could not be refreshed. Saved local activities remain on this device.',
      );
    } finally {
      setLoading(false);
      const queued = loadQueue.current.finish();
      if (queued) void load(queued.cursor);
    }
  };
  useEffect(() => {
    void load();
  }, [profile?.id, sync.pendingCount]);
  const rows = useMemo(
    () => mergeActivityRows(pending, remote),
    [pending, remote],
  );
  if (loading)
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <Body>Loading activities…</Body>
      </View>
    );
  return (
    <View style={[styles.page, { backgroundColor: theme.background }]}>
      <ScreenTitle>Activity</ScreenTitle>
      {sync.pendingCount > 0 ? (
        <StatusBanner
          message={`${sync.pendingCount} ${sync.pendingCount === 1 ? 'activity is' : 'activities are'} waiting to upload.`}
        />
      ) : null}
      {error ? (
        <>
          <StatusBanner message={error} />
          <Button label="Try again" onPress={() => void load()} />
        </>
      ) : null}
      {rows.length === 0 ? (
        <View style={styles.center}>
          <Body>
            No activities yet. Save a recording and it will appear here, even
            offline.
          </Body>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const local = 'pending' in item && item.pending === true;
            return (
              <Pressable
                accessibilityRole="button"
                disabled={local}
                onPress={() =>
                  navigation.navigate('ActivityDetail', { id: item.id })
                }
                style={[
                  styles.card,
                  { borderColor: theme.border, backgroundColor: theme.surface },
                ]}
              >
                <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>
                  {activityTitle(item)}
                </Text>
                <Text style={{ color: theme.textSecondary }}>
                  {item.sport.toUpperCase()} ·{' '}
                  {new Date(item.started_at).toLocaleString()} ·{' '}
                  {formatActivityDistance(
                    item.stats.distance_m,
                    profile?.units ?? 'metric',
                  )}{' '}
                  · {formatActivityDuration(item.stats.moving_time_s)}
                </Text>
                {local ? (
                  <Text
                    accessibilityLiveRegion="polite"
                    style={{ color: theme.warning }}
                  >
                    {'syncStatus' in item && item.syncStatus === 'uploading'
                      ? 'Uploading'
                      : 'syncStatus' in item &&
                          item.syncStatus === 'needs_attention'
                        ? 'Needs attention · use manual retry'
                        : 'Waiting to upload'}{' '}
                    · detail available after sync
                  </Text>
                ) : null}
              </Pressable>
            );
          }}
          onEndReached={() => {
            if (cursor && remote.length < 200) void load(cursor);
          }}
          onEndReachedThreshold={0.5}
        />
      )}
      {sync.pendingCount > 0 ? (
        <Button
          busy={sync.syncing}
          label="Retry pending uploads"
          onPress={() => void sync.retry()}
        />
      ) : null}
    </View>
  );
}
function ActivityDetailScreen({
  route,
  navigation,
}: NativeStackScreenProps<ActivityParamList, 'ActivityDetail'>) {
  const { api, profile } = useAppState();
  const theme = useTheme();
  const [activity, setActivity] = useState<Activity | null>(null);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [mapEnabled, setMapEnabled] = useState(false);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const load = async () => {
    try {
      const value = await api.getActivity(route.params.id);
      setActivity(value);
      setTitle(value.title ?? '');
      setNotes(value.notes ?? '');
      setError(false);
    } catch {
      setError(true);
    }
  };
  useEffect(() => {
    void load();
  }, [route.params.id]);
  const saveChanges = async () => {
    if (!activity || mutationBusy) return;
    setMutationBusy(true);
    setMutationError(null);
    try {
      setActivity(
        await api.updateActivity(activity.id, {
          title: title.trim() || null,
          notes: notes || null,
        }),
      );
      setEditing(false);
    } catch {
      setMutationError('Changes could not be saved. Try again.');
    } finally {
      setMutationBusy(false);
    }
  };
  const confirmDelete = async () => {
    if (!activity || mutationBusy) return;
    setMutationBusy(true);
    setMutationError(null);
    try {
      await api.deleteActivity(activity.id);
      navigation.goBack();
    } catch {
      setMutationError('Activity could not be deleted. Try again.');
      setMutationBusy(false);
    }
  };
  if (error)
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <StatusBanner message="Activity detail is unavailable offline." />
        <Button label="Try again" onPress={() => void load()} />
      </View>
    );
  if (!activity)
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <Body>Loading activity…</Body>
      </View>
    );
  const units = profile?.units ?? 'metric';
  const mapGeometry = mapEnabled
    ? buildActivityDisplayGeometry(activity.polylines)
    : {
        lineSegments: [],
        singletonPoints: [],
        pointCount: 0,
        degraded: false,
      };
  const chartSamples = activity.elevation.samples.filter(
    (_, index, samples) =>
      index % Math.max(1, Math.ceil(samples.length / 60)) === 0,
  );
  const elevations = chartSamples.map((sample) => sample.elevation_m);
  const minimumElevation = Math.min(...elevations, 0);
  const elevationRange = Math.max(
    1,
    Math.max(...elevations, 1) - minimumElevation,
  );
  return (
    <ScrollView
      contentContainerStyle={[
        styles.detail,
        { backgroundColor: theme.background },
      ]}
    >
      <ScreenTitle>{activityTitle(activity)}</ScreenTitle>
      <Body>{activity.sport.toUpperCase()}</Body>
      <Text style={[styles.headline, { color: theme.textPrimary }]}>
        {formatActivityDistance(
          activity.stats.distance_m,
          profile?.units ?? 'metric',
        )}
      </Text>
      <Body>
        Moving {formatActivityDuration(activity.stats.moving_time_s)} · Elapsed{' '}
        {formatActivityDuration(activity.stats.elapsed_time_s)}
      </Body>
      <Body>
        {activity.sport === 'ride'
          ? `Average speed ${formatActivitySpeed(activity.stats.average_speed_mps, units)}`
          : `Average pace ${formatActivityPace(
              activity.stats.average_pace_s_per_km === null
                ? null
                : activity.stats.average_pace_s_per_km *
                    (units === 'metric' ? 1 : 1.609344),
              units,
            )}`}{' '}
        · Elevation gain{' '}
        {formatElevation(activity.stats.elevation_gain_m, units)}
      </Body>
      {activity.notes ? <Body>{activity.notes}</Body> : null}
      <Button
        label={mapEnabled ? 'Hide network map' : 'Load network map'}
        onPress={() => setMapEnabled((value) => !value)}
      />
      {mapEnabled ? <ActivityMap geometry={mapGeometry} /> : null}
      <Body>
        {mapEnabled
          ? `Route loaded and fit from ${mapGeometry.pointCount} display points (maximum 1,000). ${mapGeometry.degraded ? 'The pause-separated route exceeded the display budget, so representative segments were retained without joining across pauses. ' : ''}Map requests may disclose the viewed area and IP address to the map provider.`
          : 'Map is off by default for network privacy. Your route remains private in Trail.'}
      </Body>
      <Text
        accessibilityRole="header"
        style={[styles.sectionTitle, { color: theme.textPrimary }]}
      >
        Splits
      </Text>
      {activity.splits.map((split) => (
        <Body key={split.index}>
          {split.index}.{' '}
          {formatActivityDistance(split.distance_m, split.unit_system)} ·{' '}
          {formatActivityDuration(split.moving_time_s)} ·{' '}
          {formatActivityPace(split.pace_s_per_unit, split.unit_system)}
          {split.partial ? ' · partial' : ''}
        </Body>
      ))}
      <Text
        accessibilityRole="header"
        style={[styles.sectionTitle, { color: theme.textPrimary }]}
      >
        {elevationLabel(activity)}
      </Text>
      <View
        accessibilityLabel={`${elevationLabel(activity)} chart with ${activity.elevation.samples.length} samples`}
        accessibilityRole="image"
        style={[styles.chart, { borderColor: theme.border }]}
      >
        <View accessibilityElementsHidden style={styles.chartSeries}>
          {chartSamples.map((sample, index) => (
            <View
              key={`${sample.distance_m}-${index}`}
              style={[
                styles.chartBar,
                {
                  backgroundColor: theme.action,
                  height:
                    8 +
                    ((sample.elevation_m - minimumElevation) / elevationRange) *
                      64,
                },
              ]}
            />
          ))}
        </View>
        <Body>
          Gain {formatElevation(activity.elevation.gain_m, units)} · Loss{' '}
          {formatElevation(activity.elevation.loss_m, units)}
        </Body>
      </View>
      <Text
        accessibilityRole="header"
        style={[styles.sectionTitle, { color: theme.textPrimary }]}
      >
        Photos
      </Text>
      <PhotoGallery activityId={activity.id} />
      {mutationError ? <StatusBanner message={mutationError} /> : null}
      {editing ? (
        <>
          <TextInput
            accessibilityLabel="Activity title"
            maxLength={200}
            onChangeText={setTitle}
            style={[
              styles.input,
              { borderColor: theme.border, color: theme.textPrimary },
            ]}
            value={title}
          />
          <TextInput
            accessibilityLabel="Activity notes"
            maxLength={10000}
            multiline
            onChangeText={setNotes}
            style={[
              styles.input,
              { borderColor: theme.border, color: theme.textPrimary },
            ]}
            value={notes}
          />
          <Button
            busy={mutationBusy}
            label="Save changes"
            onPress={() => void saveChanges()}
          />
        </>
      ) : (
        <Button label="Edit title and notes" onPress={() => setEditing(true)} />
      )}
      <Button
        label="Delete activity"
        onPress={() =>
          Alert.alert(
            'Delete this activity?',
            'This removes the activity and queues private photo cleanup. This cannot be undone.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () => void confirmDelete(),
              },
            ],
          )
        }
      />
    </ScrollView>
  );
}
export function ActivityStack() {
  return (
    <Stack.Navigator
      screenOptions={{ headerBackTitle: 'Back', headerTitle: '' }}
    >
      <Stack.Screen
        component={ActivityListScreen}
        name="ActivityHome"
        options={{ headerShown: false }}
      />
      <Stack.Screen component={ActivityDetailScreen} name="ActivityDetail" />
    </Stack.Navigator>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, gap: spacing.space4, padding: spacing.space5 },
  detail: { flexGrow: 1, gap: spacing.space4, padding: spacing.space5 },
  center: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.space5,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    gap: spacing.space1,
    marginBottom: spacing.space2,
    padding: spacing.space4,
  },
  cardTitle: { fontSize: 18, fontWeight: '700' },
  headline: { fontSize: 34, fontWeight: '800' },
  sectionTitle: { fontSize: 21, fontWeight: '700', marginTop: spacing.space4 },
  chart: {
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 96,
    padding: spacing.space4,
  },
  chartSeries: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 1,
    height: 80,
  },
  chartBar: { flex: 1, minWidth: 1 },
  input: {
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 48,
    padding: spacing.space2,
  },
});
