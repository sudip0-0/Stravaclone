import { useColorScheme } from 'react-native';

const light = {
  background: '#FFFFFF',
  surface: '#F5F7F4',
  textPrimary: '#172018',
  textSecondary: '#536158',
  border: '#737D75',
  action: '#146C43',
  onAction: '#FFFFFF',
  danger: '#B42318',
  onDanger: '#FFFFFF',
  warning: '#8A4B00',
  link: '#0B62A4',
} as const;
const dark = {
  background: '#101512',
  surface: '#18201B',
  textPrimary: '#F4F7F4',
  textSecondary: '#BCC7BE',
  border: '#89958C',
  action: '#65D39A',
  onAction: '#092416',
  danger: '#FFB4AB',
  onDanger: '#101512',
  warning: '#FFDDB3',
  link: '#65D39A',
} as const;
export type Theme = { [K in keyof typeof light]: string };
export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
export const spacing = {
  space1: 4,
  space2: 8,
  space3: 12,
  space4: 16,
  space5: 24,
  space6: 32,
  space7: 48,
} as const;
