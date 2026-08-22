const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '10.0.2.2']);

export function validateApiUrl(value: string | undefined): string {
  if (!value) throw new Error('EXPO_PUBLIC_API_URL is required.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('EXPO_PUBLIC_API_URL must be a valid absolute URL.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      'EXPO_PUBLIC_API_URL must not include credentials, query, or fragment.',
    );
  }
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))
  ) {
    throw new Error(
      'EXPO_PUBLIC_API_URL must use HTTPS except for local development.',
    );
  }
  return url.toString().replace(/\/$/, '');
}

export const environment = {
  apiUrl: validateApiUrl(
    process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000',
  ),
  appleClientId: process.env.EXPO_PUBLIC_APPLE_CLIENT_ID,
  googleClientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID,
};
