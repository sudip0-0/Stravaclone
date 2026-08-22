export type AuthField = 'email' | 'token' | 'password' | 'confirm';
export function firstInvalidField(
  errors: Partial<Record<AuthField, string>>,
): AuthField | null {
  return (
    (['email', 'token', 'password', 'confirm'] as const).find((field) =>
      Boolean(errors[field]),
    ) ?? null
  );
}
