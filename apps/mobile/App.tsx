import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigation } from './src/navigation/root-navigation';
import { AppStateProvider } from './src/state/app-state';
import { RecordingDraftStateReporter } from './src/state/recording-draft-reporter';
import { RecordingAccountLifecycleService } from './src/state/recording-account-lifecycle';
import { SecureConfirmedCleanupFallbackStore } from './src/storage/confirmed-cleanup-fallback';
import { recordingRepository } from './src/storage/recording-database';
import { stopNativeCollection } from './src/services/recording-location';
import { ActivitySyncRuntime } from './src/features/activity-sync/sync-runtime';
import { PhotoSyncRuntime } from './src/features/photos/photo-sync-runtime';
import { RouteSyncRuntime } from './src/features/routes/route-sync-runtime';

const draftReporter = new RecordingDraftStateReporter(recordingRepository);
const recordingLifecycle = new RecordingAccountLifecycleService(
  recordingRepository,
  draftReporter,
  stopNativeCollection,
  new SecureConfirmedCleanupFallbackStore(),
);

export default function App() {
  return (
    <SafeAreaProvider>
      <AppStateProvider
        draftReporter={draftReporter}
        recordingLifecycle={recordingLifecycle}
      >
        <ActivitySyncRuntime>
          <PhotoSyncRuntime>
            <RouteSyncRuntime>
              <StatusBar style="auto" />
              <RootNavigation />
            </RouteSyncRuntime>
          </PhotoSyncRuntime>
        </ActivitySyncRuntime>
      </AppStateProvider>
    </SafeAreaProvider>
  );
}
