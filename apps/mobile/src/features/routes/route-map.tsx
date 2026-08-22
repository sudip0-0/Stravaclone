import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type * as MapLibreType from '@maplibre/maplibre-react-native';
import type { Coordinate } from '@trail/contracts';
import { useTheme } from '../../theme/tokens';
import { OPENFREEMAP_STYLE_URL } from '../record/recording-map';

let MapLibreGL: typeof MapLibreType | null = null;
try {
  // MapLibre native modules are unavailable in Expo Go.
  /* eslint-disable @typescript-eslint/no-require-imports -- guarded native module fallback */
  MapLibreGL =
    require('@maplibre/maplibre-react-native') as typeof MapLibreType;
  /* eslint-enable @typescript-eslint/no-require-imports */
} catch {
  MapLibreGL = null;
}

function pressedCoordinate(event: unknown): Coordinate | null {
  if (!event || typeof event !== 'object' || !('nativeEvent' in event))
    return null;
  const nativeEvent = event.nativeEvent;
  if (
    !nativeEvent ||
    typeof nativeEvent !== 'object' ||
    !('geometry' in nativeEvent)
  )
    return null;
  const geometry = nativeEvent.geometry;
  if (!geometry || typeof geometry !== 'object' || !('coordinates' in geometry))
    return null;
  const coordinates = geometry.coordinates;
  return Array.isArray(coordinates) &&
    typeof coordinates[0] === 'number' &&
    typeof coordinates[1] === 'number'
    ? { longitude: coordinates[0], latitude: coordinates[1] }
    : null;
}

export function RouteMap({
  waypoints,
  networkEnabled,
  editable,
  onAdd,
  onToggleNetwork,
}: {
  waypoints: readonly Coordinate[];
  networkEnabled: boolean;
  editable?: boolean;
  onAdd?: (point: Coordinate) => void;
  onToggleNetwork: () => void;
}) {
  const theme = useTheme();
  const shape = {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'LineString' as const,
      coordinates: waypoints.map((point) => [point.longitude, point.latitude]),
    },
  };
  const markers = {
    type: 'FeatureCollection' as const,
    features: waypoints.map((point, index) => ({
      type: 'Feature' as const,
      properties: { label: String(index + 1) },
      geometry: {
        type: 'Point' as const,
        coordinates: [point.longitude, point.latitude],
      },
    })),
  };
  return (
    <View
      style={[
        styles.container,
        { borderColor: theme.border, backgroundColor: theme.surface },
      ]}
    >
      {networkEnabled && MapLibreGL ? (
        <MapLibreGL.Map
          accessibilityLabel={
            editable
              ? 'Route builder map. Tap to add ordered waypoints.'
              : 'Route detail map'
          }
          attribution={false}
          logo={false}
          mapStyle={OPENFREEMAP_STYLE_URL}
          {...(editable && onAdd
            ? {
                onPress: (event) => {
                  const coordinate = pressedCoordinate(event);
                  if (coordinate) onAdd(coordinate);
                },
              }
            : {})}
          style={styles.map}
        >
          <MapLibreGL.Camera
            initialViewState={{
              center: waypoints[0]
                ? [waypoints[0].longitude, waypoints[0].latitude]
                : [0, 20],
              zoom: waypoints.length ? 13 : 1,
            }}
          />
          {waypoints.length > 1 ? (
            <MapLibreGL.GeoJSONSource data={shape} id="raw-route">
              <MapLibreGL.Layer
                id="raw-route-line"
                type="line"
                paint={{ 'line-color': '#146C43', 'line-width': 5 }}
              />
            </MapLibreGL.GeoJSONSource>
          ) : null}
          {waypoints.length ? (
            <MapLibreGL.GeoJSONSource data={markers} id="route-waypoints">
              <MapLibreGL.Layer
                id="route-waypoint-circles"
                type="circle"
                paint={{
                  'circle-color': '#146C43',
                  'circle-radius': 13,
                  'circle-stroke-color': '#FFFFFF',
                  'circle-stroke-width': 2,
                }}
              />
              <MapLibreGL.Layer
                id="route-waypoint-labels"
                type="symbol"
                layout={{ 'text-field': ['get', 'label'], 'text-size': 13 }}
                paint={{ 'text-color': '#FFFFFF' }}
              />
            </MapLibreGL.GeoJSONSource>
          ) : null}
        </MapLibreGL.Map>
      ) : (
        <View style={styles.fallback}>
          <Text style={{ color: theme.textPrimary, fontWeight: '600' }}>
            Map network is off
          </Text>
          <Text style={{ color: theme.textSecondary, textAlign: 'center' }}>
            Route coordinates remain private until you choose to load the map.
            Loading sends your IP address and requested map area, which can
            approximate location, to OpenFreeMap infrastructure.
          </Text>
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: networkEnabled }}
        onPress={onToggleNetwork}
        style={[
          styles.toggle,
          { backgroundColor: theme.background, borderColor: theme.border },
        ]}
      >
        <Text style={{ color: theme.textPrimary }}>
          {networkEnabled ? 'Turn map network off' : 'Load map with network'}
        </Text>
      </Pressable>
      {networkEnabled ? (
        <View
          style={[styles.attribution, { backgroundColor: theme.background }]}
        >
          <Text style={{ color: theme.textPrimary }}>© </Text>
          <Text
            accessibilityRole="link"
            onPress={() =>
              void Linking.openURL('https://www.openstreetmap.org/copyright')
            }
            style={{ color: theme.link }}
          >
            OpenStreetMap
          </Text>
          <Text style={{ color: theme.textPrimary }}> · </Text>
          <Text
            accessibilityRole="link"
            onPress={() => void Linking.openURL('https://openfreemap.org')}
            style={{ color: theme.link }}
          >
            OpenFreeMap
          </Text>
        </View>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  attribution: {
    bottom: 4,
    flexDirection: 'row',
    padding: 4,
    position: 'absolute',
    right: 4,
  },
  container: {
    borderRadius: 16,
    borderWidth: 1,
    height: 320,
    overflow: 'hidden',
  },
  fallback: {
    alignItems: 'center',
    flex: 1,
    gap: 8,
    justifyContent: 'center',
    padding: 24,
  },
  map: { flex: 1 },
  toggle: {
    borderRadius: 12,
    borderWidth: 1,
    left: 8,
    minHeight: 48,
    padding: 12,
    position: 'absolute',
    top: 8,
  },
});
