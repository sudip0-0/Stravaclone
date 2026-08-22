import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigation } from './src/navigation/root-navigation';
import { AppStateProvider } from './src/state/app-state';

export default function App() {
  return (
    <SafeAreaProvider>
      <AppStateProvider>
        <StatusBar style="auto" />
        <RootNavigation />
      </AppStateProvider>
    </SafeAreaProvider>
  );
}
