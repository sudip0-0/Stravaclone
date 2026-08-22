import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import NetInfo, { useNetInfo } from '@react-native-community/netinfo';
import { Ionicons } from '@expo/vector-icons';
import {
  NavigationContainer,
  DarkTheme,
  DefaultTheme,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Body, Button, ScreenTitle, StatusBanner } from '../components/ui';
import {
  ForgotPasswordScreen,
  ResetCompleteScreen,
  ResetPasswordScreen,
  SignInScreen,
  SignUpScreen,
  VerifyEmailScreen,
  WelcomeScreen,
  type AuthParamList,
} from '../features/auth/auth-screens';
import {
  ProfileScreen,
  SettingsScreen,
  YouScreen,
  type YouParamList,
} from '../features/profile/profile-screens';
import { ActivityStack } from '../features/activities/activity-screens';
import { RecordScreen } from '../features/record/record-screen';
import { RoutesStack } from '../features/routes/route-screens';
import { useAppState } from '../state/app-state';
import { useTheme } from '../theme/tokens';

const Auth = createNativeStackNavigator<AuthParamList>();
const Tabs = createBottomTabNavigator();
const You = createNativeStackNavigator<YouParamList>();

function LoadingScreen() {
  const theme = useTheme();
  return (
    <View
      style={[styles.center, { backgroundColor: theme.background }]}
      accessibilityLiveRegion="polite"
    >
      <ActivityIndicator
        accessibilityElementsHidden
        color={theme.action}
        size="large"
      />
      <Text style={[styles.loading, { color: theme.textPrimary }]}>
        Opening Trail…
      </Text>
    </View>
  );
}
function CleanupRequiredScreen() {
  const { retryRequiredCleanup } = useAppState();
  const theme = useTheme();
  return (
    <View style={[styles.center, { backgroundColor: theme.background }]}>
      <ScreenTitle>Local cleanup required</ScreenTitle>
      <Body>
        The account was deleted on the server, but Trail could not safely
        preserve or complete local cleanup. Stay here and retry; account
        switching is blocked.
      </Body>
      <Button
        label="Retry local cleanup"
        onPress={() => void retryRequiredCleanup()}
      />
    </View>
  );
}
function SessionRetryScreen() {
  const { retrySession, sessionRetryReason } = useAppState();
  const theme = useTheme();
  const detail =
    sessionRetryReason === 'offline'
      ? 'You appear to be offline. Your secure session is still saved.'
      : 'Trail could not renew your session. Your secure session is still saved.';
  return (
    <View style={[styles.center, { backgroundColor: theme.background }]}>
      <ScreenTitle>Connection needed</ScreenTitle>
      <Body>{detail}</Body>
      <Button label="Try again" onPress={() => void retrySession()} />
    </View>
  );
}
function YouStack() {
  return (
    <You.Navigator screenOptions={{ headerBackTitle: 'Back', headerTitle: '' }}>
      <You.Screen
        component={YouScreen}
        name="YouHome"
        options={{ headerShown: false }}
      />
      <You.Screen component={ProfileScreen} name="Profile" />
      <You.Screen component={SettingsScreen} name="Settings" />
    </You.Navigator>
  );
}

function Shell() {
  const theme = useTheme();
  const network = useNetInfo();
  const offline = network.isConnected === false;
  const icons: Record<
    string,
    {
      active: keyof typeof Ionicons.glyphMap;
      inactive: keyof typeof Ionicons.glyphMap;
    }
  > = {
    Record: { active: 'radio-button-on', inactive: 'radio-button-off' },
    Activity: { active: 'list-circle', inactive: 'list-circle-outline' },
    Routes: { active: 'map', inactive: 'map-outline' },
    You: { active: 'person', inactive: 'person-outline' },
  };
  return (
    <View style={[styles.flex, { backgroundColor: theme.background }]}>
      {offline ? (
        <StatusBanner message="Offline. Some changes may not sync." />
      ) : null}
      <Tabs.Navigator
        initialRouteName="Record"
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: theme.action,
          tabBarInactiveTintColor: theme.textSecondary,
          tabBarLabelStyle: styles.tabLabel,
          tabBarStyle: {
            backgroundColor: theme.surface,
            borderTopColor: theme.border,
            minHeight: 64,
          },
          tabBarItemStyle: { minHeight: 48 },
          tabBarAccessibilityLabel: route.name,
          tabBarIcon: ({ color, focused, size }) => (
            <Ionicons
              accessibilityElementsHidden
              color={color}
              name={
                focused
                  ? (icons[route.name]?.active ?? 'ellipse')
                  : (icons[route.name]?.inactive ?? 'ellipse-outline')
              }
              size={size}
            />
          ),
        })}
      >
        <Tabs.Screen name="Record" component={RecordScreen} />
        <Tabs.Screen component={ActivityStack} name="Activity" />
        <Tabs.Screen component={RoutesStack} name="Routes" />
        <Tabs.Screen component={YouStack} name="You" />
      </Tabs.Navigator>
    </View>
  );
}

export function RootNavigation() {
  const { phase } = useAppState();
  const theme = useTheme();
  if (phase === 'restoring') return <LoadingScreen />;
  if (phase === 'session-retry') return <SessionRetryScreen />;
  if (phase === 'cleanup-required') return <CleanupRequiredScreen />;
  const navigationTheme = {
    ...(theme.background === '#101512' ? DarkTheme : DefaultTheme),
    colors: {
      ...(theme.background === '#101512'
        ? DarkTheme.colors
        : DefaultTheme.colors),
      background: theme.background,
      card: theme.surface,
      text: theme.textPrimary,
      border: theme.border,
      primary: theme.action,
    },
  };
  return (
    <NavigationContainer theme={navigationTheme}>
      {phase === 'signed-in' ? (
        <Shell />
      ) : (
        <Auth.Navigator
          initialRouteName="Welcome"
          screenOptions={{ headerBackTitle: 'Back', headerTitle: '' }}
        >
          <Auth.Screen
            component={WelcomeScreen}
            name="Welcome"
            options={{ headerShown: false }}
          />
          <Auth.Screen component={SignInScreen} name="SignIn" />
          <Auth.Screen component={SignUpScreen} name="SignUp" />
          <Auth.Screen component={VerifyEmailScreen} name="VerifyEmail" />
          <Auth.Screen component={ForgotPasswordScreen} name="ForgotPassword" />
          <Auth.Screen component={ResetPasswordScreen} name="ResetPassword" />
          <Auth.Screen
            component={ResetCompleteScreen}
            name="ResetComplete"
            options={{ gestureEnabled: false }}
          />
        </Auth.Navigator>
      )}
    </NavigationContainer>
  );
}

void NetInfo.fetch();
const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    flex: 1,
    gap: 16,
    justifyContent: 'center',
    padding: 20,
  },
  flex: { flex: 1 },
  loading: { fontSize: 17, lineHeight: 24 },
  page: { flex: 1, gap: 16, padding: 20 },
  tabLabel: { fontSize: 13, lineHeight: 18 },
});
