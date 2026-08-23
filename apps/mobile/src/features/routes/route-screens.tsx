import { useCallback, useState } from 'react';
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
import { useFocusEffect } from '@react-navigation/native';
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import { randomUUID } from 'expo-crypto';
import type { Sport } from '@trail/contracts';
import { Body, Button, ScreenTitle, StatusBanner } from '../../components/ui';
import { useAppState } from '../../state/app-state';
import { spacing, useTheme } from '../../theme/tokens';
import { formatDistance as formatDisplayDistance } from '../stats/stats-model';
import { RouteMap } from './route-map';
import {
  addWaypoint,
  canSaveRoute,
  clearWaypoints,
  emptyRouteBuilder,
  routeDistanceM,
  undoWaypoint,
} from './route-model';
import { setRouteHandoff } from './route-handoff';
import type { CachedRoute } from './route-cache';
import { useRouteSync } from './route-sync-runtime';

export type RoutesParamList = {
  RoutesHome: undefined;
  RouteBuilder: undefined;
  RouteDetail: { id: string };
};
const Stack = createNativeStackNavigator<RoutesParamList>();
const sports: readonly { value: Sport; label: string }[] = [
  { value: 'run', label: 'Run' },
  { value: 'ride', label: 'Ride' },
  { value: 'walk', label: 'Walk' },
  { value: 'hike', label: 'Hike' },
];

function RouteListScreen({
  navigation,
}: NativeStackScreenProps<RoutesParamList, 'RoutesHome'>) {
  const { profile } = useAppState();
  const { service } = useRouteSync();
  const theme = useTheme();
  const locale = Intl.DateTimeFormat().resolvedOptions().locale || 'en-US';
  const [items, setItems] = useState<CachedRoute[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const load = useCallback(
    async (next?: string) => {
      if (!profile) return;
      const cached = await service.list(profile.id);
      setItems(cached.slice());
      setLoading(false);
      try {
        setError(false);
        setCursor(await service.refresh(profile.id, next));
        setItems((await service.list(profile.id)).slice());
      } catch {
        setError(cached.length === 0);
      }
    },
    [profile, service],
  );
  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load]),
  );
  return (
    <View style={[styles.page, { backgroundColor: theme.background }]}>
      <ScreenTitle>Routes</ScreenTitle>
      {error ? <StatusBanner error message="Could not load routes." /> : null}
      {!loading && items.length === 0 ? (
        <View style={styles.empty}>
          <Body>
            No saved routes yet. Build an unsnapped route from ordered map taps.
          </Body>
          <Button
            label="Build a route"
            onPress={() => navigation.navigate('RouteBuilder')}
          />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                navigation.navigate('RouteDetail', { id: item.id })
              }
              style={[styles.card, { borderColor: theme.border }]}
            >
              <Text style={[styles.name, { color: theme.textPrimary }]}>
                {item.name}
              </Text>
              <Text style={{ color: theme.textSecondary }}>
                {formatDisplayDistance(
                  item.distance_m,
                  profile?.units ?? 'metric',
                  locale,
                )}
                {item.sport_hint ? ` · ${item.sport_hint}` : ''}
                {item.sync_status !== 'synced'
                  ? ` · ${item.sync_status.replace('_', ' ')}`
                  : ''}
              </Text>
            </Pressable>
          )}
          ListFooterComponent={
            cursor ? (
              <Button
                label="Load more"
                onPress={() => void load(cursor)}
                variant="secondary"
              />
            ) : null
          }
        />
      )}
      {items.length ? (
        <Button
          label="Build a route"
          onPress={() => navigation.navigate('RouteBuilder')}
        />
      ) : null}
    </View>
  );
}
function BuilderScreen({
  navigation,
}: NativeStackScreenProps<RoutesParamList, 'RouteBuilder'>) {
  const { profile } = useAppState();
  const { service } = useRouteSync();
  const theme = useTheme();
  const locale = Intl.DateTimeFormat().resolvedOptions().locale || 'en-US';
  const [state, setState] = useState(emptyRouteBuilder);
  const [network, setNetwork] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const save = async () => {
    if (!canSaveRoute(state)) return;
    setBusy(true);
    setError(false);
    try {
      if (!profile) return;
      const saved = await service.create(profile.id, {
        id: randomUUID(),
        name: state.name.trim(),
        sport_hint: state.sportHint,
        waypoints: [...state.waypoints],
      });
      navigation.replace('RouteDetail', { id: saved.id });
    } catch {
      setError(true);
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
      <ScreenTitle>Build route</ScreenTitle>
      <StatusBanner message="Routes are straight lines between your ordered taps. Trail does not snap to roads, call a routing service, or estimate elevation." />
      {error ? <StatusBanner error message="Could not save route." /> : null}
      <RouteMap
        editable
        networkEnabled={network}
        onAdd={(point) => setState((current) => addWaypoint(current, point))}
        onToggleNetwork={() => setNetwork((value) => !value)}
        waypoints={state.waypoints}
      />
      <Text
        accessibilityLiveRegion="polite"
        style={{ color: theme.textPrimary }}
      >
        {state.waypoints.length} waypoints ·{' '}
        {formatDisplayDistance(
          routeDistanceM(state),
          profile?.units ?? 'metric',
          locale,
        )}{' '}
        raw distance
      </Text>
      <View style={styles.row}>
        <Button
          disabled={!state.waypoints.length}
          label="Undo"
          onPress={() => setState((current) => undoWaypoint(current))}
          variant="secondary"
        />
        <Button
          disabled={!state.waypoints.length}
          label="Clear"
          onPress={() => setState((current) => clearWaypoints(current))}
          variant="secondary"
        />
      </View>
      <TextInput
        accessibilityLabel="Route name"
        maxLength={200}
        onChangeText={(name) => setState((current) => ({ ...current, name }))}
        placeholder="Route name"
        placeholderTextColor={theme.textSecondary}
        style={[
          styles.input,
          { borderColor: theme.border, color: theme.textPrimary },
        ]}
        value={state.name}
      />
      <Body>Sport hint (optional)</Body>
      <View
        accessibilityLabel="Sport hint"
        accessibilityRole="radiogroup"
        style={styles.row}
      >
        {sports.map((option) => (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ checked: state.sportHint === option.value }}
            key={option.value}
            onPress={() =>
              setState((current) => ({
                ...current,
                sportHint:
                  current.sportHint === option.value ? null : option.value,
              }))
            }
            style={[
              styles.sport,
              {
                borderColor: theme.border,
                backgroundColor:
                  state.sportHint === option.value
                    ? theme.action
                    : theme.surface,
              },
            ]}
          >
            <Text
              style={{
                color:
                  state.sportHint === option.value
                    ? theme.onAction
                    : theme.textPrimary,
              }}
            >
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Button
        busy={busy}
        disabled={!canSaveRoute(state)}
        label="Save route"
        onPress={() => void save()}
      />
    </ScrollView>
  );
}
function DetailScreen({
  navigation,
  route: navigationRoute,
}: NativeStackScreenProps<RoutesParamList, 'RouteDetail'>) {
  const { profile } = useAppState();
  const { service } = useRouteSync();
  const theme = useTheme();
  const locale = Intl.DateTimeFormat().resolvedOptions().locale || 'en-US';
  const [value, setValue] = useState<CachedRoute | null>(null);
  const [editName, setEditName] = useState('');
  const [network, setNetwork] = useState(false);
  const [error, setError] = useState(false);
  useFocusEffect(
    useCallback(() => {
      if (!profile) return;
      void service
        .get(profile.id, navigationRoute.params.id)
        .then((route) => {
          setValue(route);
          setEditName(route?.name ?? '');
          setError(!route);
        })
        .catch(() => setError(true));
    }, [profile, service, navigationRoute.params.id]),
  );
  if (error)
    return (
      <View style={[styles.page, { backgroundColor: theme.background }]}>
        <StatusBanner error message="Route not found." />
      </View>
    );
  if (!value)
    return (
      <View
        accessibilityLiveRegion="polite"
        style={[styles.page, { backgroundColor: theme.background }]}
      >
        <Body>Loading route…</Body>
      </View>
    );
  const record = () => {
    if (!profile) return;
    setRouteHandoff({
      ownerUserId: profile.id,
      routeId: value.id,
      sport: value.sport_hint ?? 'run',
      polyline: value.polyline,
      waypoints: value.waypoints,
    });
    navigation.getParent()?.navigate('Record' as never);
  };
  const saveChanges = async () => {
    if (!profile || !editName.trim() || editName.trim() === value.name) return;
    const updated = await service.update(profile.id, value.id, {
      name: editName.trim(),
    });
    setValue(updated);
    setEditName(updated.name);
  };
  const remove = () =>
    Alert.alert(
      'Delete this route?',
      'Activities recorded from it will be kept, with their route reference cleared.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete route',
          style: 'destructive',
          onPress: () =>
            void (profile
              ? service
                  .delete(profile.id, value.id)
                  .then(() => navigation.popToTop())
              : Promise.resolve()),
        },
      ],
    );
  return (
    <ScrollView
      contentContainerStyle={[
        styles.page,
        { backgroundColor: theme.background },
      ]}
    >
      <ScreenTitle>{value.name}</ScreenTitle>
      <RouteMap
        networkEnabled={network}
        onToggleNetwork={() => setNetwork((item) => !item)}
        waypoints={value.waypoints}
      />
      <Body>
        {formatDisplayDistance(
          value.distance_m,
          profile?.units ?? 'metric',
          locale,
        )}{' '}
        · {value.waypoints.length} waypoints
        {value.sport_hint ? ` · ${value.sport_hint}` : ''}
      </Body>
      <StatusBanner message="This is the raw, unsnapped waypoint line. No routing or elevation provider was contacted." />
      {value.sync_status !== 'synced' ? (
        <StatusBanner
          message={`Route is ${value.sync_status.replace('_', ' ')} and remains available on this device.`}
        />
      ) : null}
      <TextInput
        accessibilityLabel="Edit route name"
        maxLength={200}
        onChangeText={setEditName}
        style={[
          styles.input,
          { borderColor: theme.border, color: theme.textPrimary },
        ]}
        value={editName}
      />
      <Button
        disabled={!editName.trim() || editName.trim() === value.name}
        label="Save changes"
        onPress={() => void saveChanges()}
        variant="secondary"
      />
      <Button label="Record this route" onPress={record} />
      <Button label="Delete route" onPress={remove} variant="danger" />
    </ScrollView>
  );
}
export function RoutesStack() {
  return (
    <Stack.Navigator
      screenOptions={{ headerBackTitle: 'Back', headerTitle: '' }}
    >
      <Stack.Screen
        component={RouteListScreen}
        name="RoutesHome"
        options={{ headerShown: false }}
      />
      <Stack.Screen component={BuilderScreen} name="RouteBuilder" />
      <Stack.Screen component={DetailScreen} name="RouteDetail" />
    </Stack.Navigator>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, gap: spacing.space4, padding: 20 },
  empty: { flex: 1, gap: spacing.space4, justifyContent: 'center' },
  card: { borderBottomWidth: 1, gap: 4, minHeight: 64, paddingVertical: 12 },
  name: { fontSize: 18, fontWeight: '600' },
  row: { flexDirection: 'row', gap: spacing.space2 },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 17,
    minHeight: 48,
    padding: 12,
  },
  sport: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    minHeight: 48,
    justifyContent: 'center',
  },
});
