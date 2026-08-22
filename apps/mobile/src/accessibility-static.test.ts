import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (relative: string) =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

describe('static React Native accessibility contracts', () => {
  it('keeps accessible roles, states, live regions, and 48dp targets in shared controls', () => {
    const ui = source('./components/ui.tsx');
    expect(ui).toContain('accessibilityRole="button"');
    expect(ui).toContain('accessibilityState={{ disabled: blocked, busy }}');
    expect(ui).toContain('accessibilityLiveRegion');
    expect(ui).toContain('minHeight: 48');
  });
  it('keeps Record controls text-labelled, stateful, and attribution visible', () => {
    const record = source('./features/record/record-screen.tsx');
    const map = source('./features/record/recording-map.tsx');
    expect(record).toContain('accessibilityRole="radiogroup"');
    expect(record).toContain('accessibilityRole="radio"');
    expect(record).toContain('accessibilityLiveRegion="polite"');
    expect(record).toContain('accessibilityLabel={`${label}: ${value}`}');
    expect(map).toContain('OpenStreetMap');
    expect(map).toContain('OpenFreeMap');
    expect(map).toContain('minHeight: 48');
    expect(map).toContain('Map unavailable in this build');
    expect(map).toContain('Map network is off');
    expect(map).toContain('Load map with network');
    expect(map).toContain('Turn map network off');
    expect(map).toContain('IP address and requested map area');
  });
  it('exposes the blocking cleanup-required state and retry action', () => {
    const navigation = source('./navigation/root-navigation.tsx');
    expect(navigation).toContain('Local cleanup required');
    expect(navigation).toContain('Retry local cleanup');
    expect(navigation).toContain("phase === 'cleanup-required'");
  });
  it('wires keyboard next actions and invalid password/token refs', () => {
    const auth = source('./features/auth/auth-screens.tsx');
    expect(auth).toContain(
      'onSubmitEditing={() => passwordRef.current?.focus()}',
    );
    expect(auth).toContain('firstInvalidField(invalid)');
    expect(auth).toContain('label="Reset token"');
    expect(auth).toContain('inputRef={confirmRef}');
  });
});
