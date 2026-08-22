import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { randomUUID } from 'expo-crypto';
import { classifyAccuracy, type ActivitySport } from '@trail/domain';
import { Body, Button, ScreenTitle, StatusBanner } from '../../components/ui';
import { useAppState } from '../../state/app-state';
import { spacing, useTheme } from '../../theme/tokens';
import { recordingRepository } from '../../storage/recording-database';
import {
  expoLocationCollection,
  openApplicationSettings,
  requestRecordingPermissions,
} from '../../services/recording-location';
import { permissionWarnings } from './permission-policy';
import { formatCurrentMotion, formatDistance } from './recording-format';
import { RecordingCoordinator } from './recording-service';
import {
  canSaveRecording,
  elapsedRecordingMs,
} from './recording-state-machine';
import type { RecordingSession, SequencedPoint } from './recording-types';
import { RecordingMap } from './recording-map';

const sports: readonly { value: ActivitySport; label: string }[] = [
  { value: 'run', label: 'Run' },
  { value: 'ride', label: 'Ride' },
  { value: 'walk', label: 'Walk' },
  { value: 'hike', label: 'Hike' },
];
const coordinator = new RecordingCoordinator(
  recordingRepository,
  expoLocationCollection,
  { create: randomUUID },
);

function formatElapsed(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 3600)}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
export function RecordScreen() {
  const theme = useTheme();
  const { profile } = useAppState();
  const ownerUserId = profile?.id ?? null;
  const units = profile?.units ?? 'metric';
  const [sport, setSport] = useState<ActivitySport>('run');
  const [session, setSession] = useState<RecordingSession | null>(null);
  const [hudPoints, setHudPoints] = useState<readonly SequencedPoint[]>([]);
  const [mapPoints, setMapPoints] = useState<readonly SequencedPoint[]>([]);
  const [following, setFollowing] = useState(true);
  const [mapNetworkEnabled, setMapNetworkEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const recoveryPrompted = useRef(false);
  const visibleOwner = useRef<string | null>(ownerUserId);
  visibleOwner.current = ownerUserId;

  const refreshHud = useCallback(async (owner: string, id?: string) => {
    const latest = id
      ? await recordingRepository.getSession(owner, id)
      : await recordingRepository.getLatestSession(owner);
    const hud = latest
      ? await recordingRepository.getHudPoints(owner, latest.id)
      : [];
    if (visibleOwner.current !== owner) return;
    setSession(latest);
    setHudPoints(hud);
  }, []);
  const refreshMap = useCallback(async (owner: string, id: string) => {
    const display = await recordingRepository.getDisplayPoints(owner, id);
    if (visibleOwner.current === owner) setMapPoints(display);
  }, []);

  const confirmDiscard = useCallback((active: RecordingSession) => {
    Alert.alert(
      'Discard this recording?',
      'The locally recorded track will be permanently deleted. Nothing will be sent.',
      [
        { text: 'Keep recording', style: 'cancel' },
        {
          text: 'Discard recording',
          style: 'destructive',
          onPress: () =>
            void (async () => {
              setBusy(true);
              try {
                await coordinator.discard(active);
                setSession(null);
                setHudPoints([]);
                setMapPoints([]);
                setWarning(null);
              } finally {
                setBusy(false);
              }
            })(),
        },
      ],
    );
  }, []);

  useEffect(() => {
    recoveryPrompted.current = false;
    setSession(null);
    setHudPoints([]);
    setMapPoints([]);
    if (!ownerUserId) return;
    void coordinator.initialize(ownerUserId).then((recoverable) => {
      if (visibleOwner.current !== ownerUserId) return;
      if (!recoverable) {
        void refreshHud(ownerUserId);
        return;
      }
      if (recoveryPrompted.current) return;
      recoveryPrompted.current = true;
      setSession(recoverable);
      void refreshHud(ownerUserId, recoverable.id);
      void refreshMap(ownerUserId, recoverable.id);
      if (recoverable.state === 'stopping') {
        Alert.alert(
          'Stopped recording found',
          'Trail recovered this recording. Save it locally or discard it below.',
          [{ text: 'Continue' }],
        );
        return;
      }
      Alert.alert(
        'Recording found',
        'Trail found an unfinished recording saved for this account on this device.',
        [
          {
            text: 'Discard…',
            style: 'destructive',
            onPress: () => confirmDiscard(recoverable),
          },
          {
            text: 'Resume',
            onPress: () =>
              void coordinator
                .resume(recoverable)
                .then((value) => setSession(value))
                .catch(() =>
                  setWarning(
                    'Could not resume location recording. Check location settings.',
                  ),
                ),
          },
        ],
      );
    });
  }, [confirmDiscard, ownerUserId, refreshHud, refreshMap]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
      if (session && ownerUserId) {
        void coordinator
          .enforceDurationLimit(session)
          .then((updated) => {
            if (updated.state !== session.state) setSession(updated);
            return refreshHud(ownerUserId, session.id);
          })
          .catch(() => undefined);
      }
    }, 1_000);
    return () => clearInterval(timer);
  }, [ownerUserId, refreshHud, session]);
  const mapSessionId = session?.id ?? null;
  useEffect(() => {
    if (!mapSessionId || !ownerUserId) return;
    const timer = setInterval(
      () => void refreshMap(ownerUserId, mapSessionId),
      5_000,
    );
    return () => clearInterval(timer);
  }, [mapSessionId, ownerUserId, refreshMap]);

  const beginAfterEducation = async () => {
    setBusy(true);
    setWarning(null);
    try {
      const permission = await requestRecordingPermissions();
      const warnings = permissionWarnings(permission);
      if (warnings.length) setWarning(warnings.join(' '));
      if (permission.foreground === 'denied' || !ownerUserId) return;
      const started = await coordinator.start(
        ownerUserId,
        sport,
        permission.background === 'granted',
      );
      setSession(started);
      setHudPoints([]);
      setMapPoints([]);
      if (Platform.OS === 'android') {
        Alert.alert(
          'Keep Trail recording',
          'Some Android manufacturers stop location in the background. Allow unrestricted battery use for Trail if recordings stop early.',
          [{ text: 'Got it' }],
        );
      }
    } catch {
      if (ownerUserId) {
        const recoverable = await coordinator.initialize(ownerUserId);
        if (recoverable) {
          setSession(recoverable);
          await refreshHud(ownerUserId, recoverable.id);
          await refreshMap(ownerUserId, recoverable.id);
        }
      }
      setWarning(
        'Native location could not start. The recording is saved here; resume it after checking location settings.',
      );
    } finally {
      setBusy(false);
    }
  };
  const requestStart = () => {
    Alert.alert(
      'Allow location while recording',
      'Trail first asks for precise location to draw your path, then background location so recording can continue with the screen locked.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Continue', onPress: () => void beginAfterEducation() },
      ],
    );
  };

  const active =
    session &&
    ['starting', 'recording', 'paused', 'stopping', 'saving'].includes(
      session.state,
    );
  const elapsedMs = session ? elapsedRecordingMs(session, nowMs) : 0;
  const rawFixIsStale =
    session?.latestRawFixAtMs != null &&
    nowMs - session.latestRawFixAtMs > 10_000;
  const accuracyClass = classifyAccuracy(session?.latestRawAccuracyM);
  const accuracyLabel =
    session?.latestRawFixAtMs == null
      ? 'Waiting for GPS'
      : rawFixIsStale
        ? 'GPS stale'
        : accuracyClass === 'preferred'
          ? 'GPS good'
          : accuracyClass === 'usable'
            ? 'GPS fair'
            : 'GPS poor';
  const accuracyColor =
    !rawFixIsStale && accuracyClass === 'preferred'
      ? theme.action
      : !rawFixIsStale && accuracyClass === 'usable'
        ? theme.warning
        : theme.danger;
  const stopped = session?.state === 'stopping';
  const saveAllowed = stopped ? canSaveRecording(session, nowMs) : false;
  const rate = useMemo(
    () => formatCurrentMotion(hudPoints, session?.sport ?? sport, units, nowMs),
    [hudPoints, nowMs, session?.sport, sport, units],
  );

  const pause = async () => {
    if (!session || session.state !== 'recording') return;
    setBusy(true);
    try {
      setSession(await coordinator.pause(session));
    } finally {
      setBusy(false);
    }
  };
  const resume = async () => {
    if (!session || session.state !== 'paused') return;
    setBusy(true);
    try {
      setSession(await coordinator.resume(session));
    } catch {
      setWarning('Could not resume. Check location settings.');
    } finally {
      setBusy(false);
    }
  };
  const confirmStop = () => {
    if (
      !session ||
      (session.state !== 'recording' && session.state !== 'paused')
    )
      return;
    Alert.alert(
      'Stop this activity?',
      'GPS collection will stop. You can then save locally or discard.',
      [
        { text: 'Keep recording', style: 'cancel' },
        {
          text: 'Stop activity',
          onPress: () =>
            void coordinator
              .stop(session)
              .then(setSession)
              .catch(() => setWarning('Could not stop recording. Try again.')),
        },
      ],
    );
  };
  const save = async () => {
    if (!session) return;
    setBusy(true);
    try {
      setSession(await coordinator.save(session));
    } catch (error) {
      setWarning(
        error instanceof Error ? error.message : 'Could not save locally.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={[
        styles.page,
        { backgroundColor: theme.background },
      ]}
    >
      <ScreenTitle>Record</ScreenTitle>
      {warning ? (
        <StatusBanner
          action="Open Settings"
          message={warning}
          onAction={() => void openApplicationSettings()}
        />
      ) : null}
      {session?.errorCode ? (
        <StatusBanner
          error
          message={
            session.errorCode === 'task_payload_overflow'
              ? 'Location delivery exceeded the safe payload limit. Recording was paused without silently dropping the payload.'
              : 'Location persistence could not recover after retries. Recording was paused; your previously saved points remain available.'
          }
        />
      ) : null}
      {session?.stopReason === 'duration_limit' ? (
        <StatusBanner message="Recording stopped at the 12-hour safety limit. Your accepted points are saved locally." />
      ) : null}
      {session?.stopReason === 'point_limit' ? (
        <StatusBanner message="Recording stopped at the 100,000-point limit. No accepted points were silently dropped." />
      ) : null}
      {!active ? (
        <View
          accessibilityLabel="Sport"
          accessibilityRole="radiogroup"
          style={styles.sports}
        >
          {sports.map((option) => (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: sport === option.value }}
              key={option.value}
              onPress={() => setSport(option.value)}
              style={[
                styles.sport,
                {
                  backgroundColor:
                    sport === option.value ? theme.action : theme.surface,
                  borderColor: theme.border,
                },
              ]}
            >
              <Text
                style={{
                  color:
                    sport === option.value ? theme.onAction : theme.textPrimary,
                }}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View accessibilityLiveRegion="polite" style={styles.gpsRow}>
        <Ionicons
          accessibilityElementsHidden
          color={accuracyColor}
          name={accuracyClass === 'preferred' ? 'navigate-circle' : 'warning'}
          size={26}
        />
        <Text style={[styles.gpsText, { color: accuracyColor }]}>
          {accuracyLabel}
          {session?.latestRawAccuracyM != null
            ? ` • ±${Math.round(session.latestRawAccuracyM)} m`
            : ''}
        </Text>
      </View>
      {(rawFixIsStale ||
        accuracyClass === 'poor' ||
        accuracyClass === 'usable') &&
      session?.latestRawFixAtMs != null ? (
        <Body>
          GPS accuracy is limited. You may continue; Trail filters unreliable
          points.
        </Body>
      ) : null}
      <View style={styles.stats}>
        <Stat label="Elapsed" value={formatElapsed(elapsedMs)} />
        <Stat
          label="Distance"
          value={formatDistance(session?.distanceM ?? 0, units)}
        />
        <Stat
          label={
            (session?.sport ?? sport) === 'ride'
              ? 'Current speed'
              : 'Current pace'
          }
          value={rate}
        />
      </View>
      <RecordingMap
        following={following}
        networkEnabled={mapNetworkEnabled}
        onToggleFollow={() => setFollowing((value) => !value)}
        onToggleNetwork={() => setMapNetworkEnabled((value) => !value)}
        points={mapPoints}
      />
      {!session || session.state === 'local_saved' ? (
        <View style={styles.actions}>
          {session?.state === 'local_saved' ? (
            <StatusBanner message="Saved locally. Waiting to upload." />
          ) : null}
          <Button
            busy={busy}
            disabled={!ownerUserId}
            label="Start"
            onPress={requestStart}
          />
        </View>
      ) : null}
      {session?.state === 'recording' ? (
        <View style={styles.actions}>
          <Button busy={busy} label="Pause" onPress={() => void pause()} />
          <Button label="Stop" onPress={confirmStop} variant="secondary" />
        </View>
      ) : null}
      {session?.state === 'paused' ? (
        <View style={styles.actions}>
          <Button busy={busy} label="Resume" onPress={() => void resume()} />
          <Button label="Stop" onPress={confirmStop} variant="secondary" />
        </View>
      ) : null}
      {stopped ? (
        <View style={styles.actions}>
          {!saveAllowed ? (
            <StatusBanner message="Record for at least 30 seconds or 50 metres before saving. You can discard this recording." />
          ) : null}
          <Button
            busy={busy}
            disabled={!saveAllowed}
            label="Save locally"
            onPress={() => void save()}
          />
          <Button
            label="Discard recording"
            onPress={() => confirmDiscard(session)}
            variant="danger"
          />
        </View>
      ) : null}
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={[styles.stat, { borderColor: theme.border }]}
    >
      <Text style={[styles.statLabel, { color: theme.textSecondary }]}>
        {label}
      </Text>
      <Text style={[styles.statValue, { color: theme.textPrimary }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { gap: spacing.space3 },
  gpsRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.space2 },
  gpsText: { fontSize: 17, fontWeight: '600', lineHeight: 24 },
  page: { flexGrow: 1, gap: spacing.space4, padding: 20 },
  sport: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
    padding: 8,
  },
  sports: { flexDirection: 'row', gap: spacing.space2 },
  stat: {
    borderBottomWidth: 1,
    flex: 1,
    gap: 4,
    minWidth: 100,
    paddingBottom: 8,
  },
  statLabel: { fontSize: 15, lineHeight: 21 },
  statValue: { fontSize: 20, fontWeight: '600', lineHeight: 28 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.space3 },
});
