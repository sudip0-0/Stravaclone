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
