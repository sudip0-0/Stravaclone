import { StyleSheet, Text, View } from 'react-native';
import type * as MapLibreType from '@maplibre/maplibre-react-native';
import { MapAttribution } from '../../components/map-attribution';
import { environment } from '../../config/environment';
import { useTheme } from '../../theme/tokens';
import {
  activityGeometryGeoJson,
  type ActivityDisplayGeometry,
} from './activity-model';

let MapLibreGL: typeof MapLibreType | null = null;
try {
  // Native map is unavailable in Expo Go; activity detail remains functional.
  /* eslint-disable @typescript-eslint/no-require-imports -- guarded native module fallback */
  MapLibreGL =
    require('@maplibre/maplibre-react-native') as typeof MapLibreType;
  /* eslint-enable @typescript-eslint/no-require-imports */
} catch {
  MapLibreGL = null;
}
export function ActivityMap({
  geometry,
}: {
  geometry: ActivityDisplayGeometry;
}) {
  const theme = useTheme();
  const points = [...geometry.lineSegments.flat(), ...geometry.singletonPoints];
  if (!MapLibreGL || points.length === 0)
    return (
      <View style={[styles.fallback, { borderColor: theme.border }]}>
        <Text style={{ color: theme.textSecondary }}>
          Map unavailable in this build. Route data remains available.
        </Text>
      </View>
    );
  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => point.longitude);
  const bounds: [number, number, number, number] = [
    Math.min(...longitudes),
    Math.min(...latitudes),
    Math.max(...longitudes),
    Math.max(...latitudes),
  ];
  const shape = activityGeometryGeoJson(geometry);
  return (
    <View>
      <View style={styles.mapCanvas}>
        <MapLibreGL.Map
          accessibilityLabel="Activity route map"
          attribution={false}
          logo={false}
          mapStyle={environment.mapStyleUrl}
          style={styles.map}
        >
          <MapLibreGL.Camera
            bounds={bounds}
            padding={{ top: 40, right: 40, bottom: 40, left: 40 }}
          />
          <MapLibreGL.GeoJSONSource data={shape} id="activity-route">
            <MapLibreGL.Layer
              id="activity-line"
              paint={{ 'line-color': '#146C43', 'line-width': 5 }}
              type="line"
            />
            <MapLibreGL.Layer
              id="activity-singletons"
              paint={{ 'circle-color': '#146C43', 'circle-radius': 4 }}
              type="circle"
            />
          </MapLibreGL.GeoJSONSource>
        </MapLibreGL.Map>
      </View>
      <MapAttribution provider={environment.mapProvider} />
    </View>
  );
}
const styles = StyleSheet.create({
  map: { flex: 1 },
  mapCanvas: { height: 212, overflow: 'hidden' },
  fallback: {
    alignItems: 'center',
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 160,
    padding: 16,
  },
});
