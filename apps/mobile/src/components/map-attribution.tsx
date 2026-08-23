import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { MapProviderConfig } from '../config/environment';
import { useTheme } from '../theme/tokens';
import { mapAttributionLinks } from './map-attribution-model';

export function MapAttribution({ provider }: { provider: MapProviderConfig }) {
  const theme = useTheme();
  const links = mapAttributionLinks(provider);
  return (
    <View
      accessibilityLabel="Map attribution"
      style={[styles.container, { backgroundColor: theme.background }]}
    >
      {links.map((link) => (
        <Pressable
          accessibilityRole="link"
          key={link.url}
          onPress={() => void Linking.openURL(link.url)}
          style={styles.target}
        >
          <Text style={[styles.text, { color: theme.link }]}>{link.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'stretch',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    padding: 4,
  },
  target: {
    justifyContent: 'center',
    maxWidth: '100%',
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  text: { flexShrink: 1, fontSize: 12, lineHeight: 18 },
});
