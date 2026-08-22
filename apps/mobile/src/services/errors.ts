export type SafeErrorKind =
  | 'credentials'
  | 'validation'
  | 'rate-limit'
  | 'offline'
  | 'session'
  | 'server';

export interface SafeAppError {
  kind: SafeErrorKind;
  message: string;
  retryable: boolean;
}

interface ErrorLike {
  code?: unknown;
  status?: unknown;
}

export function mapApiError(
  error: unknown,
  context: 'sign-in' | 'sign-up' | 'reset' | 'profile' | 'general' = 'general',
): SafeAppError {
  if (error instanceof TypeError)
    return {
      kind: 'offline',
      message: 'You appear to be offline. Check your connection and try again.',
      retryable: true,
    };
  const value = typeof error === 'object' && error ? (error as ErrorLike) : {};
  const code = typeof value.code === 'string' ? value.code : '';
  const status = typeof value.status === 'number' ? value.status : 0;
  if (context === 'sign-in' && (status === 401 || code === 'unauthorized'))
    return {
      kind: 'credentials',
      message: 'Email or password is incorrect.',
      retryable: false,
    };
  if (context === 'reset')
    return {
      kind: 'server',
      message:
        'If an account matches that email, we’ll send a password reset link.',
      retryable: false,
    };
  if (code === 'rate_limited' || status === 429)
    return {
      kind: 'rate-limit',
      message: 'Too many attempts. Wait a moment and try again.',
      retryable: true,
    };
  if (code === 'validation_error' || status === 400)
    return {
      kind: 'validation',
      message: 'Check the information you entered and try again.',
      retryable: false,
    };
  if (
    code === 'service_unavailable' ||
    code === 'provider_unavailable' ||
    status >= 500
  )
    return {
      kind: 'server',
      message: 'Trail is unavailable right now. Try again.',
      retryable: true,
    };
  return {
    kind: 'server',
    message:
      context === 'profile'
        ? 'Couldn’t save your profile. Try again.'
        : 'Something went wrong. Try again.',
    retryable: true,
  };
}

export class ApiResponseError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super('Request failed');
    this.name = 'ApiResponseError';
  }
}
