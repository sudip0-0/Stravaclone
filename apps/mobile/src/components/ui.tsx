import type { ReactNode, RefObject } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { spacing, useTheme } from '../theme/tokens';

export function ScreenTitle({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={[styles.title, { color: theme.textPrimary }]}
    >
      {children}
    </Text>
  );
}
export function Body({
  children,
  secondary = false,
}: {
  children: ReactNode;
  secondary?: boolean;
}) {
  const theme = useTheme();
  return (
    <Text
      style={[
        styles.body,
        { color: secondary ? theme.textSecondary : theme.textPrimary },
      ]}
    >
      {children}
    </Text>
  );
}
export function StatusBanner({
  message,
  action,
  onAction,
  error = false,
}: {
  message: string;
  action?: string | undefined;
  onAction?: (() => void) | undefined;
  error?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityLiveRegion={error ? 'assertive' : 'polite'}
      accessibilityRole="alert"
      style={[
        styles.banner,
        {
          backgroundColor: theme.surface,
          borderColor: error ? theme.danger : theme.border,
        },
      ]}
    >
      <Body>{message}</Body>
      {action && onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          style={styles.linkTarget}
        >
          <Text style={[styles.strong, { color: theme.link }]}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
export function Button({
  label,
  onPress,
  variant = 'primary',
  busy = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  busy?: boolean;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const blocked = busy || disabled;
  const backgroundColor =
    variant === 'primary'
      ? theme.action
      : variant === 'danger'
        ? theme.danger
        : theme.surface;
  const color =
    variant === 'primary'
      ? theme.onAction
      : variant === 'danger'
        ? theme.onDanger
        : theme.textPrimary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: blocked, busy }}
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor, borderColor: theme.border },
        blocked && styles.disabled,
        pressed && !blocked && styles.pressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator accessibilityElementsHidden color={color} />
      ) : null}
      <Text style={[styles.strong, { color }]}>{label}</Text>
    </Pressable>
  );
}
export function Field({
  label,
  error,
  inputRef,
  ...props
}: TextInputProps & {
  label: string;
  error?: string | undefined;
  inputRef?: RefObject<TextInput | null> | undefined;
}) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: theme.textPrimary }]}>{label}</Text>
      <TextInput
        ref={inputRef}
        accessibilityLabel={label}
        accessibilityState={{ disabled: props.editable === false }}
        style={[
          styles.input,
          {
            borderColor: error ? theme.danger : theme.border,
            color: theme.textPrimary,
            backgroundColor: theme.background,
          },
        ]}
        placeholderTextColor={theme.textSecondary}
        {...props}
      />
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.error, { color: theme.danger }]}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { borderRadius: 16, borderWidth: 1, gap: 8, padding: 16 },
  body: { fontSize: 17, lineHeight: 24 },
  button: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  disabled: { opacity: 0.55 },
  error: { fontSize: 15, lineHeight: 21 },
  field: { gap: 8 },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 17,
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  label: { fontSize: 17, fontWeight: '600', lineHeight: 24 },
  linkTarget: {
    alignSelf: 'flex-start',
    justifyContent: 'center',
    minHeight: 48,
  },
  pressed: { opacity: 0.75 },
  strong: { fontSize: 17, fontWeight: '600', lineHeight: 24 },
  title: {
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 36,
    marginBottom: spacing.space2,
  },
});
