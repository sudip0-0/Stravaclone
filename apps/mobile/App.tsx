import { useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

const tabs = ['Record', 'Activity', 'Routes', 'You'] as const;
type Tab = (typeof tabs)[number];

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('Record');

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="auto" />
      <View style={styles.content} accessibilityRole="summary">
        <Text style={styles.heading}>{activeTab}</Text>
        <Text style={styles.body}>
          This is a placeholder for the {activeTab.toLowerCase()} area. Trail
          features are not implemented yet.
        </Text>
      </View>
      <View style={styles.tabBar} accessibilityRole="tablist">
        {tabs.map((tab) => (
          <Pressable
            accessibilityLabel={`${tab} tab`}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === tab }}
            key={tab}
            onPress={() => setActiveTab(tab)}
            style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
          >
            <Text
              style={[styles.tabText, activeTab === tab && styles.selected]}
            >
              {tab}
            </Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 18, lineHeight: 26, maxWidth: 480, textAlign: 'center' },
  content: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  heading: { fontSize: 30, fontWeight: '600', marginBottom: 12 },
  pressed: { opacity: 0.6 },
  screen: { backgroundColor: '#ffffff', flex: 1 },
  selected: { fontWeight: '700', textDecorationLine: 'underline' },
  tab: {
    alignItems: 'center',
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 4,
    paddingVertical: 14,
  },
  tabBar: {
    borderTopColor: '#767676',
    borderTopWidth: 1,
    flexDirection: 'row',
  },
  tabText: { color: '#111111', fontSize: 16 },
});
