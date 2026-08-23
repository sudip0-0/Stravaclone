import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type * as MapLibreType from '@maplibre/maplibre-react-native';
import { MapAttribution } from '../../components/map-attribution';
import { environment } from '../../config/environment';
import { useTheme } from '../../theme/tokens';
import type { SequencedPoint } from './recording-types';

let MapLibreGL: typeof MapLibreType | null = null;
try {
  // Native TurboModules are unavailable in Expo Go; loading must not crash recording.
  /* eslint-disable @typescript-eslint/no-require-imports -- guarded native module fallback */
  MapLibreGL =
    require('@maplibre/maplibre-react-native') as typeof MapLibreType;
  /* eslint-enable @typescript-eslint/no-require-imports */
} catch {
  MapLibreGL = null;
}

export function RecordingMap({
  points,
  routePoints = [],
  following,
  networkEnabled,
  onToggleFollow,
  onToggleNetwork,
}: {
  points: readonly SequencedPoint[];
  routePoints?: readonly { latitude: number; longitude: number }[];
  following: boolean;
  networkEnabled: boolean;
  onToggleFollow: () => void;
  onToggleNetwork: () => void;
}) {
  const theme = useTheme();
  const nativeMapAvailable = MapLibreGL !== null;
  const routeShape = useMemo(
    () => ({
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: routePoints.map((point) => [
          point.longitude,
          point.latitude,
        ]),
      },
    }),
    [routePoints],
  );
  const shape = useMemo(
    () => ({
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: points.map((point) => [point.longitude, point.latitude]),
      },
    }),
    [points],
  );
  return (
    <View>
      <View
        style={[
          styles.mapCanvas,
          { borderColor: theme.border, backgroundColor: theme.surface },
        ]}
      >
        {networkEnabled && nativeMapAvailable && MapLibreGL ? (
          <MapLibreGL.Map
            accessibilityLabel="Live recording map"
            attribution={false}
            logo={false}
            mapStyle={environment.mapStyleUrl}
            style={styles.map}
          >
            <MapLibreGL.Camera
              initialViewState={{ zoom: 16 }}
              {...(following ? { trackUserLocation: 'default' as const } : {})}
            />
            <MapLibreGL.UserLocation accuracy animated heading />
            {routePoints.length > 1 ? (
              <MapLibreGL.GeoJSONSource data={routeShape} id="planned-route">
                <MapLibreGL.Layer
                  id="planned-route-line"
                  paint={{
                    'line-color': '#4176A6',
                    'line-dasharray': [2, 2],
                    'line-width': 4,
                  }}
                  type="line"
                />
              </MapLibreGL.GeoJSONSource>
            ) : null}
            {points.length > 1 ? (
              <MapLibreGL.GeoJSONSource data={shape} id="recording-route">
                <MapLibreGL.Layer
                  id="recording-line"
                  paint={{ 'line-color': '#146C43', 'line-width': 5 }}
                  type="line"
                />
              </MapLibreGL.GeoJSONSource>
            ) : null}
          </MapLibreGL.Map>
        ) : (
          <View accessibilityRole="summary" style={styles.fallback}>
            <Text style={[styles.fallbackTitle, { color: theme.textPrimary }]}>
              {networkEnabled
                ? 'Map unavailable in this build'
                : 'Map network is off'}
            </Text>
            <Text style={[styles.fallbackBody, { color: theme.textSecondary }]}>
              {networkEnabled
                ? 'GPS recording still works. MapLibre requires an Expo development build and is not available in Expo Go.'
                : `GPS recording still works without map requests. Loading the map sends your IP address and requested map area, which can approximate your location, to ${environment.mapProvider.name} infrastructure, subject to provider terms and retention practices.`}
            </Text>
          </View>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: networkEnabled }}
          onPress={onToggleNetwork}
          style={[
            styles.network,
            { backgroundColor: theme.background, borderColor: theme.border },
          ]}
        >
          <Text style={{ color: theme.textPrimary }}>
            {networkEnabled ? 'Turn map network off' : 'Load map with network'}
          </Text>
        </Pressable>
        {networkEnabled && nativeMapAvailable ? (
          <Pressable
            accessibilityLabel={
              following ? 'Stop following my location' : 'Follow my location'
            }
            accessibilityRole="button"
            accessibilityState={{ selected: following }}
            onPress={onToggleFollow}
            style={[
              styles.follow,
              { backgroundColor: theme.background, borderColor: theme.border },
            ]}
          >
            <Text style={{ color: theme.textPrimary }}>
              {following ? 'Following' : 'Follow'}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {networkEnabled ? (
        <MapAttribution provider={environment.mapProvider} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  mapCanvas: {
    borderRadius: 16,
    borderWidth: 1,
    height: 260,
    overflow: 'hidden',
  },
  fallback: {
    alignItems: 'center',
    flex: 1,
    gap: 8,
    justifyContent: 'center',
    padding: 24,
  },
  fallbackBody: { fontSize: 15, lineHeight: 21, textAlign: 'center' },
  fallbackTitle: { fontSize: 17, fontWeight: '600', lineHeight: 24 },
  follow: {
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 48,
    minWidth: 88,
    padding: 12,
    position: 'absolute',
    right: 8,
    top: 64,
  },
  map: { flex: 1 },
  network: {
    borderRadius: 12,
    borderWidth: 1,
    left: 8,
    minHeight: 48,
    padding: 12,
    position: 'absolute',
    top: 8,
  },
});
