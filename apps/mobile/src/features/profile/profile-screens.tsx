import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextInput,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Sport, UnitSystem } from '@trail/contracts';
import {
  Body,
  Button,
  Field,
  ScreenTitle,
  StatusBanner,
} from '../../components/ui';
import { environment } from '../../config/environment';
import { ApiResponseError, mapApiError } from '../../services/errors';
import { evaluateSignOut } from '../../state/draft-guard';
import { useAppState } from '../../state/app-state';
import { spacing, useTheme } from '../../theme/tokens';
import { StatsScreen } from '../stats/stats-screen';
import { profilePatch } from './profile-model';

export type YouParamList = {
  YouHome: undefined;
  Profile: undefined;
  Settings: undefined;
};
type Props<Name extends keyof YouParamList> = NativeStackScreenProps<
  YouParamList,
  Name
>;

function Page({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <ScrollView
      contentContainerStyle={[
        styles.page,
        { backgroundColor: theme.background },
      ]}
    >
      {children}
    </ScrollView>
  );
}
function Row({
  title,
  value,
  onPress,
  danger = false,
}: {
  title: string;
  value?: string;
  onPress?: (() => void) | undefined;
  danger?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityLabel={[title, value].filter(Boolean).join(', ')}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityState={{ disabled: !onPress }}
      disabled={!onPress}
      onPress={onPress}
      style={[styles.row, { borderColor: theme.border }]}
    >
      <Text
        style={[
          styles.rowTitle,
          { color: danger ? theme.danger : theme.textPrimary },
        ]}
      >
        {title}
      </Text>
      {value ? (
        <Text style={[styles.value, { color: theme.textSecondary }]}>
          {value}
        </Text>
      ) : null}
    </Pressable>
  );
}
function Choices<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { label: string; value: T }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityLabel={label}
      accessibilityRole="radiogroup"
      style={styles.choices}
    >
      <Text style={[styles.label, { color: theme.textPrimary }]}>{label}</Text>
      {options.map((option) => (
        <Pressable
          accessibilityLabel={option.label}
          accessibilityRole="radio"
          accessibilityState={{ checked: value === option.value }}
          key={option.value}
          onPress={() => onChange(option.value)}
          style={[
            styles.choice,
            {
              borderColor: theme.border,
              backgroundColor:
                value === option.value ? theme.surface : theme.background,
            },
          ]}
        >
          <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>
            {value === option.value ? '● ' : '○ '}
            {option.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
const sports = [
  { label: 'Run', value: 'run' },
  { label: 'Ride', value: 'ride' },
  { label: 'Walk', value: 'walk' },
  { label: 'Hike', value: 'hike' },
] as const;
const units = [
  { label: 'Metric', value: 'metric' },
  { label: 'Imperial', value: 'imperial' },
] as const;

export function YouScreen({ navigation }: Props<'YouHome'>) {
  return (
    <StatsScreen
      openActivity={(id) =>
        navigation.getParent()?.navigate('Activity', {
          screen: 'ActivityDetail',
          params: { id },
        })
      }
      openProfile={() => navigation.navigate('Profile')}
      openSettings={() => navigation.navigate('Settings')}
    />
  );
}

export function ProfileScreen(): React.ReactElement {
  const { profile, profilePhase, refreshProfile, updateProfile } =
    useAppState();
  const [name, setName] = useState('');
  const [sport, setSport] = useState<Sport>('run');
  const [unit, setUnit] = useState<UnitSystem>('metric');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (profile) {
      setName(profile.display_name);
      setSport(profile.default_sport);
      setUnit(profile.units);
    }
  }, [profile]);
  if (!profile)
    return (
      <Page>
        <ScreenTitle>Profile</ScreenTitle>
        {profilePhase === 'loading' ? (
          <Body>Loading your profile…</Body>
        ) : (
          <StatusBanner
            error
            message="Your profile couldn’t be loaded."
            action="Try again"
            onAction={() => {
              void refreshProfile().catch(() => undefined);
            }}
          />
        )}
      </Page>
    );
  const patch = profilePatch(profile, {
    display_name: name,
    default_sport: sport,
    units: unit,
  });
  const save = async () => {
    if (!patch || !name.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      await updateProfile(patch);
      setMessage('Profile updated.');
    } catch (error) {
      setMessage(mapApiError(error, 'profile').message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page>
      <ScreenTitle>Profile</ScreenTitle>
      {message ? (
        <StatusBanner
          error={message !== 'Profile updated.'}
          message={message}
          action={message !== 'Profile updated.' ? 'Try again' : undefined}
          onAction={() => void save()}
        />
      ) : null}
      <Field
        error={!name.trim() ? 'Display name is required.' : undefined}
        label="Display name"
        maxLength={100}
        onChangeText={setName}
        value={name}
      />
      <Choices
        label="Default sport"
        onChange={setSport}
        options={sports}
        value={sport}
      />
      <Choices label="Units" onChange={setUnit} options={units} value={unit} />
      <Button
        busy={busy}
        disabled={!patch || !name.trim()}
        label={busy ? 'Saving…' : 'Save changes'}
        onPress={() => void save()}
      />
    </Page>
  );
}

export function SettingsScreen({ navigation }: Props<'Settings'>) {
  const {
    profile,
    updateProfile,
    signOut,
    deleteAccount,
    cancelAccountDeletionIntent,
    draftReporter,
  } = useAppState();
  const [error, setError] = useState<string | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const deletePasswordRef = useRef<TextInput>(null);
  const providerStatus = (provider: 'apple' | 'google') => {
    if (profile?.identities.some((identity) => identity.provider === provider))
      return 'Linked';
    const configured =
      provider === 'apple'
        ? Platform.OS === 'ios' && Boolean(environment.appleClientId)
        : Boolean(environment.googleClientId);
    return configured ? 'Not linked — native setup required' : 'Unavailable';
  };
  const setUnits = async (value: UnitSystem) => {
    if (!profile || profile.units === value) return;
    try {
      await updateProfile({ units: value });
    } catch (cause) {
      setError(mapApiError(cause, 'profile').message);
    }
  };
  const beginSignOut = async () => {
    if (!profile) return;
    const decision = await evaluateSignOut(draftReporter, profile.id);
    if (!decision.allowed) {
      Alert.alert(decision.title, decision.message, [
        { text: 'Stay signed in', style: 'cancel' },
        {
          text:
            decision.destination === 'Record'
              ? 'Go to Record'
              : 'Review activity',
          onPress: () => navigation.getParent()?.navigate(decision.destination),
        },
      ]);
      return;
    }
    Alert.alert(
      'Sign out?',
      'Your securely stored session will be removed after Trail signs out. Local drafts are never cleared here.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          onPress: () =>
            void (async () => {
              try {
                await signOut();
              } catch {
                setError('Couldn’t sign out. Try again.');
              }
            })(),
        },
      ],
    );
  };
  const beginDelete = () => {
    setError(null);
    setShowDelete(true);
    setTimeout(() => deletePasswordRef.current?.focus(), 0);
  };
  const confirmDelete = () =>
    Alert.alert(
      'Permanently delete Trail account?',
      'Your account, server data, and this account’s local recordings, pending uploads, and photos will be deleted after Trail confirms your current password. Other accounts’ local data is not affected. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: () =>
            void (async () => {
              setDeleting(true);
              try {
                await deleteAccount(deletePassword);
              } catch (cause) {
                if (
                  cause instanceof ApiResponseError &&
                  cause.code === 'step_up_required'
                )
                  setError(
                    'Provider verification is required before this SSO-only account can be deleted. Account deletion is unavailable in this build.',
                  );
                else if (
                  cause instanceof ApiResponseError &&
                  (cause.code === 'step_up_failed' ||
                    cause.code === 'invalid_credentials')
                )
                  setError('Current password is incorrect.');
                else if (
                  cause instanceof Error &&
                  cause.message.startsWith('Finish or resolve local activities')
                )
                  setError(
                    'Finish or resolve this account’s recording or pending upload before deleting the account. GPS recording was not interrupted.',
                  );
                else if (
                  cause instanceof Error &&
                  cause.message.startsWith(
                    'Account deletion requires manual resolution',
                  )
                )
                  setError(
                    'A previous account deletion attempt is unresolved. Your local data is preserved and will not be deleted automatically. Contact support or retry after the intent expires.',
                  );
                else setError('Couldn’t delete your account. Try again.');
              } finally {
                setDeleting(false);
              }
            })(),
        },
      ],
    );
  const resolveDeletionIntent = () =>
    Alert.alert(
      'Cancel unresolved deletion intent?',
      'This keeps all local data and permits a new account-deletion attempt. It cannot cancel cleanup already confirmed by the server.',
      [
        { text: 'Keep intent', style: 'cancel' },
        {
          text: 'Cancel intent',
          onPress: () =>
            void cancelAccountDeletionIntent()
              .then(() =>
                setError(
                  'Unresolved deletion intent cancelled. Local data was kept.',
                ),
              )
              .catch(() =>
                setError('Couldn’t resolve the deletion intent. Try again.'),
              ),
        },
      ],
    );
  const legal = (title: string) =>
    Alert.alert(
      title,
      `${title} content is not available in this development build.`,
    );
  return (
    <Page>
      <ScreenTitle>Settings</ScreenTitle>
      {error ? (
        <StatusBanner
          error
          message={error}
          action="Dismiss"
          onAction={() => setError(null)}
        />
      ) : null}
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        Preferences
      </Text>
      <Choices
        label="Units"
        onChange={(value) => void setUnits(value)}
        options={units}
        value={profile?.units ?? 'metric'}
      />
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        Linked accounts
      </Text>
      {Platform.OS === 'ios' ? (
        <Row title="Apple" value={providerStatus('apple')} />
      ) : null}
      <Row title="Google" value={providerStatus('google')} />
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        About
      </Text>
      <Row title="Privacy policy" onPress={() => legal('Privacy policy')} />
      <Row title="Terms" onPress={() => legal('Terms')} />
      <Row
        title="Map provider"
        value={environment.mapProvider.name}
        onPress={() => void Linking.openURL(environment.mapProvider.url)}
      />
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        Account
      </Text>
      <Row title="Sign out" onPress={() => void beginSignOut()} />
      <Row
        title="Resolve deletion attempt"
        value="Keeps local data"
        onPress={resolveDeletionIntent}
      />
      <Row danger title="Delete account" onPress={beginDelete} />
      {showDelete ? (
        <View style={styles.deleteForm}>
          <Body>
            Enter your current password to continue. SSO-only accounts require
            provider verification.
          </Body>
          <Field
            autoComplete="current-password"
            inputRef={deletePasswordRef}
            label="Current password"
            onChangeText={setDeletePassword}
            secureTextEntry
            value={deletePassword}
          />
          <Button
            busy={deleting}
            disabled={!deletePassword}
            label={deleting ? 'Deleting…' : 'Continue to deletion confirmation'}
            onPress={confirmDelete}
            variant="danger"
          />
          <Button
            label="Cancel"
            onPress={() => {
              setShowDelete(false);
              setDeletePassword('');
            }}
            variant="secondary"
          />
        </View>
      ) : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  choice: {
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    padding: 12,
  },
  choices: { gap: spacing.space2 },
  deleteForm: { gap: spacing.space3 },
  label: { fontSize: 17, fontWeight: '600', lineHeight: 24 },
  page: { flexGrow: 1, gap: spacing.space4, padding: 20 },
  row: {
    borderBottomWidth: 1,
    gap: 4,
    justifyContent: 'center',
    minHeight: 56,
    paddingVertical: 8,
  },
  rowTitle: { fontSize: 17, fontWeight: '600', lineHeight: 24 },
  section: { marginTop: spacing.space2 },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    lineHeight: 28,
    marginTop: spacing.space3,
  },
  value: { fontSize: 15, lineHeight: 21 },
});
