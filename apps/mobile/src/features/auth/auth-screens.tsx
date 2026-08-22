import { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextInput,
  type TextInputProps,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  Body,
  Button,
  Field,
  ScreenTitle,
  StatusBanner,
} from '../../components/ui';
import { environment } from '../../config/environment';
import { mapApiError } from '../../services/errors';
import { useAppState } from '../../state/app-state';
import { spacing, useTheme } from '../../theme/tokens';
import { firstInvalidField } from './form-focus';

export type AuthParamList = {
  Welcome: undefined;
  SignIn: undefined;
  SignUp: undefined;
  VerifyEmail: undefined;
  ForgotPassword: undefined;
  ResetPassword: undefined;
  ResetComplete: undefined;
};
type Props<Name extends keyof AuthParamList> = NativeStackScreenProps<
  AuthParamList,
  Name
>;

function Layout({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.flex, { backgroundColor: theme.background }]}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.form}>{children}</View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
function LinkButton({
  label,
  onPress,
  role = 'link',
}: {
  label: string;
  onPress: () => void;
  role?: 'link' | 'button';
}) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole={role} onPress={onPress} style={styles.link}>
      <Text style={[styles.linkText, { color: theme.link }]}>{label}</Text>
    </Pressable>
  );
}
function PasswordField(
  props: Omit<TextInputProps, 'secureTextEntry'> & {
    label: string;
    error?: string | undefined;
    inputRef?: React.RefObject<TextInput | null> | undefined;
  },
) {
  const [visible, setVisible] = useState(false);
  return (
    <View>
      <Field {...props} secureTextEntry={!visible} />
      <LinkButton
        label={visible ? 'Hide password' : 'Show password'}
        onPress={() => setVisible((current) => !current)}
        role="button"
      />
    </View>
  );
}
function ProviderPresentation() {
  const configured = (
    Platform.OS === 'ios' && environment.appleClientId ? ['Apple'] : []
  ).concat(environment.googleClientId ? ['Google'] : []);
  if (!configured.length) return null;
  return (
    <View style={styles.group}>
      <Body secondary>Or continue with</Body>
      {configured.map((provider) => (
        <Button
          disabled
          key={provider}
          label={`Continue with ${provider} — unavailable in this build`}
          onPress={() => undefined}
          variant="secondary"
        />
      ))}
      <Body secondary>
        Provider sign-in requires an externally configured development build.
      </Body>
    </View>
  );
}

export function WelcomeScreen({ navigation }: Props<'Welcome'>) {
  const theme = useTheme();
  return (
    <Layout>
      <Text
        accessibilityRole="header"
        style={[styles.wordmark, { color: theme.action }]}
      >
        Trail
      </Text>
      <Text
        accessibilityRole="header"
        style={[styles.display, { color: theme.textPrimary }]}
      >
        Record your time outside.
      </Text>
      <Body secondary>
        Record reliably, review maps and stats, and track your training.
      </Body>
      <View style={styles.group}>
        <Button
          label="Create account"
          onPress={() => navigation.navigate('SignUp')}
        />
        <Button
          label="Sign in"
          onPress={() => navigation.navigate('SignIn')}
          variant="secondary"
        />
      </View>
    </Layout>
  );
}

function validate(
  email: string,
  password: string,
): { email?: string; password?: string } {
  const errors: { email?: string; password?: string } = {};
  if (!/^\S+@\S+\.\S+$/.test(email))
    errors.email = 'Enter a valid email address.';
  if (password.length < 8) errors.password = 'Use at least 8 characters.';
  return errors;
}

export function SignInScreen({ navigation }: Props<'SignIn'>) {
  const { signIn, terminalMessage } = useAppState();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(terminalMessage);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const submit = async () => {
    const invalid = validate(email, password);
    const errors: { email?: string; password?: string } = {};
    if (invalid.email) errors.email = invalid.email;
    if (!password) errors.password = 'Enter your password.';
    const first = firstInvalidField(errors);
    if (first) {
      setError(
        first === 'email'
          ? (errors.email ?? 'Enter a valid email address.')
          : (errors.password ?? 'Enter your password.'),
      );
      (first === 'email' ? emailRef : passwordRef).current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (cause) {
      setError(mapApiError(cause, 'sign-in').message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Layout>
      <ScreenTitle>Sign in</ScreenTitle>
      {error ? <StatusBanner error message={error} /> : null}
      <Field
        autoCapitalize="none"
        autoComplete="email"
        inputMode="email"
        inputRef={emailRef}
        label="Email"
        onChangeText={setEmail}
        onSubmitEditing={() => passwordRef.current?.focus()}
        returnKeyType="next"
        value={email}
      />
      <PasswordField
        autoComplete="current-password"
        inputRef={passwordRef}
        label="Password"
        onChangeText={setPassword}
        value={password}
      />
      <LinkButton
        label="Forgot password?"
        onPress={() => navigation.navigate('ForgotPassword')}
      />
      <Button
        busy={busy}
        label={busy ? 'Signing in…' : 'Sign in'}
        onPress={() => void submit()}
      />
      <ProviderPresentation />
      <LinkButton
        label="Create an account"
        onPress={() => navigation.navigate('SignUp')}
      />
    </Layout>
  );
}

export function SignUpScreen({ navigation }: Props<'SignUp'>) {
  const { signUp } = useAppState();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>(
    {},
  );
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const submit = async () => {
    const invalid = validate(email, password);
    setErrors(invalid);
    const first = firstInvalidField(invalid);
    if (first) {
      setSummary('Check the highlighted fields.');
      (first === 'email' ? emailRef : passwordRef).current?.focus();
      return;
    }
    setBusy(true);
    setSummary(null);
    try {
      await signUp(email.trim(), password);
      navigation.navigate('VerifyEmail');
    } catch (cause) {
      setSummary(mapApiError(cause, 'sign-up').message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Layout>
      <ScreenTitle>Create account</ScreenTitle>
      {summary ? <StatusBanner error message={summary} /> : null}
      <Field
        autoCapitalize="none"
        autoComplete="email"
        error={errors.email}
        inputMode="email"
        inputRef={emailRef}
        label="Email"
        onChangeText={setEmail}
        onSubmitEditing={() => passwordRef.current?.focus()}
        returnKeyType="next"
        value={email}
      />
      <PasswordField
        autoComplete="new-password"
        error={errors.password}
        inputRef={passwordRef}
        label="Password"
        onChangeText={setPassword}
        value={password}
      />
      <Body secondary>Use at least 8 characters.</Body>
      <Button
        busy={busy}
        label={busy ? 'Creating account…' : 'Create account'}
        onPress={() => void submit()}
      />
      <ProviderPresentation />
      <LinkButton
        label="Already have an account? Sign in"
        onPress={() => navigation.navigate('SignIn')}
      />
    </Layout>
  );
}

export function VerifyEmailScreen({ navigation }: Props<'VerifyEmail'>) {
  const { confirmSignUp } = useAppState();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef<TextInput>(null);
  const submit = async () => {
    if (token.trim().length < 32) {
      setError('Paste the complete email verification token.');
      tokenRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await confirmSignUp(token.trim());
    } catch {
      setError(
        'We couldn’t verify that token. Check it and try again, or request a new email.',
      );
      tokenRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Layout>
      <ScreenTitle>Verify your email</ScreenTitle>
      <StatusBanner message="If that email can be registered, we sent an email verification token." />
      {error ? (
        <StatusBanner
          error
          message={error}
          action="Try again"
          onAction={() => void submit()}
        />
      ) : null}
      <Field
        autoCapitalize="none"
        autoCorrect={false}
        inputRef={tokenRef}
        label="Email verification token"
        onChangeText={setToken}
        returnKeyType="done"
        value={token}
      />
      <Button
        busy={busy}
        label={busy ? 'Verifying…' : 'Verify email'}
        onPress={() => void submit()}
      />
      <LinkButton
        label="Request a new verification email"
        onPress={() => navigation.goBack()}
      />
      <LinkButton
        label="Back to sign in"
        onPress={() => navigation.navigate('SignIn')}
      />
    </Layout>
  );
}

export function ForgotPasswordScreen({ navigation }: Props<'ForgotPassword'>) {
  const { api } = useAppState();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setRequestError(null);
    try {
      await api.requestPasswordReset(email.trim());
      setSent(true);
    } catch (cause) {
      setRequestError(mapApiError(cause).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Layout>
      <ScreenTitle>Reset password</ScreenTitle>
      {sent ? (
        <StatusBanner message="If an account matches that email, we’ll send a password reset token." />
      ) : null}
      {requestError ? <StatusBanner error message={requestError} /> : null}
      <Field
        autoCapitalize="none"
        autoComplete="email"
        inputMode="email"
        label="Email"
        onChangeText={setEmail}
        value={email}
      />
      <Button
        busy={busy}
        disabled={!email}
        label={busy ? 'Sending…' : 'Send reset link'}
        onPress={() => void submit()}
      />
      {sent ? (
        <>
          <Button
            label="Enter reset token"
            onPress={() => navigation.navigate('ResetPassword')}
          />
          <LinkButton
            label="Return to sign in"
            onPress={() => navigation.navigate('SignIn')}
          />
        </>
      ) : null}
    </Layout>
  );
}

export function ResetPasswordScreen({ navigation }: Props<'ResetPassword'>) {
  const { api } = useAppState();
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{
    token?: string;
    password?: string;
    confirm?: string;
  }>({});
  const [summary, setSummary] = useState<string | null>(null);
  const tokenRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);
  const submit = async () => {
    const invalid: { token?: string; password?: string; confirm?: string } = {};
    if (token.trim().length < 32)
      invalid.token = 'Paste the complete reset token.';
    if (password.length < 8) invalid.password = 'Use at least 8 characters.';
    if (password !== confirm) invalid.confirm = 'Passwords must match.';
    setErrors(invalid);
    const first = firstInvalidField(invalid);
    if (first) {
      setSummary('Check the highlighted fields.');
      if (first === 'token') tokenRef.current?.focus();
      else if (first === 'password') passwordRef.current?.focus();
      else confirmRef.current?.focus();
      return;
    }
    setBusy(true);
    setSummary(null);
    try {
      await api.confirmPasswordReset(token.trim(), password);
      navigation.replace('ResetComplete');
    } catch {
      setSummary('This reset token is no longer valid.');
      tokenRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Layout>
      <ScreenTitle>Choose a new password</ScreenTitle>
      {summary ? (
        <StatusBanner
          error
          message={summary}
          action={
            summary.includes('no longer valid')
              ? 'Request a new token'
              : undefined
          }
          onAction={
            summary.includes('no longer valid')
              ? () => navigation.replace('ForgotPassword')
              : undefined
          }
        />
      ) : null}
      <Field
        autoCapitalize="none"
        autoCorrect={false}
        error={errors.token}
        inputRef={tokenRef}
        label="Reset token"
        onChangeText={setToken}
        onSubmitEditing={() => passwordRef.current?.focus()}
        returnKeyType="next"
        value={token}
      />
      <PasswordField
        autoComplete="new-password"
        error={errors.password}
        inputRef={passwordRef}
        label="New password"
        onChangeText={setPassword}
        onSubmitEditing={() => confirmRef.current?.focus()}
        returnKeyType="next"
        value={password}
      />
      <Body secondary>Use at least 8 characters.</Body>
      <PasswordField
        autoComplete="new-password"
        error={errors.confirm}
        inputRef={confirmRef}
        label="Confirm password"
        onChangeText={setConfirm}
        returnKeyType="done"
        value={confirm}
      />
      <Button
        busy={busy}
        label={busy ? 'Resetting password…' : 'Reset password'}
        onPress={() => void submit()}
      />
    </Layout>
  );
}
export function ResetCompleteScreen({ navigation }: Props<'ResetComplete'>) {
  return (
    <Layout>
      <ScreenTitle>Password reset.</ScreenTitle>
      <Body>Your password has been changed.</Body>
      <Button
        label="Return to sign in"
        onPress={() => navigation.popTo('SignIn')}
      />
    </Layout>
  );
}

const styles = StyleSheet.create({
  display: { fontSize: 32, fontWeight: '700', lineHeight: 40 },
  flex: { flex: 1 },
  form: {
    alignSelf: 'center',
    gap: spacing.space4,
    maxWidth: 520,
    width: '100%',
  },
  group: { gap: spacing.space3, marginTop: spacing.space2 },
  link: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: 48 },
  linkText: { fontSize: 17, fontWeight: '600', lineHeight: 24 },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
    paddingVertical: spacing.space6,
  },
  wordmark: { fontSize: 20, fontWeight: '700', lineHeight: 28 },
});
