import { describe, expect, it } from 'vitest';
import { firstInvalidField } from './form-focus';

describe('auth form focus order', () => {
  it('uses visual order and focuses password when email is valid', () => {
    expect(firstInvalidField({ password: 'Required' })).toBe('password');
    expect(firstInvalidField({ email: 'Invalid', password: 'Required' })).toBe(
      'email',
    );
  });
  it('orders reset token, new password, then confirmation', () => {
    expect(
      firstInvalidField({
        token: 'Required',
        password: 'Short',
        confirm: 'Mismatch',
      }),
    ).toBe('token');
    expect(firstInvalidField({ confirm: 'Mismatch' })).toBe('confirm');
    expect(firstInvalidField({})).toBeNull();
  });
});
