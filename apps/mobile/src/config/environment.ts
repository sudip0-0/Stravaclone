const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '10.0.2.2']);
const OSM_FOUNDATION_TILE_HOSTS = new Set([
  'tile.openstreetmap.org',
  'a.tile.openstreetmap.org',
  'b.tile.openstreetmap.org',
  'c.tile.openstreetmap.org',
]);

export const DEFAULT_MAP_STYLE_URL =
  'https://tiles.openfreemap.org/styles/liberty';
export const DEFAULT_MAP_PROVIDER_NAME = 'OpenFreeMap';
export const DEFAULT_MAP_PROVIDER_URL = 'https://openfreemap.org';
export const MAP_PROVIDER_NAME_MAX_LENGTH = 40;

export type MapProviderConfig = {
  name: string;
  url: string;
};

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

export function validateMapProviderName(value: string | undefined): string {
  const candidate = value ?? DEFAULT_MAP_PROVIDER_NAME;
  if (
    candidate.length === 0 ||
    candidate.length > MAP_PROVIDER_NAME_MAX_LENGTH ||
    candidate.trim() !== candidate ||
    !/^[A-Za-z0-9][A-Za-z0-9 .&'()-]*$/.test(candidate)
  ) {
    throw new Error(
      `EXPO_PUBLIC_MAP_PROVIDER_NAME must be a safe label between 1 and ${MAP_PROVIDER_NAME_MAX_LENGTH} characters.`,
    );
  }
  return candidate;
}

export function validateMapProviderUrl(value: string | undefined): string {
  const candidate = value ?? DEFAULT_MAP_PROVIDER_URL;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(
      'EXPO_PUBLIC_MAP_PROVIDER_URL must be a valid absolute URL.',
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      'EXPO_PUBLIC_MAP_PROVIDER_URL must not include credentials, query, or fragment.',
    );
  }
  if (url.protocol !== 'https:') {
    throw new Error('EXPO_PUBLIC_MAP_PROVIDER_URL must use HTTPS.');
  }
  return url.toString().replace(/\/$/, '');
}

export function validateMapProvider(
  name: string | undefined,
  url: string | undefined,
): MapProviderConfig {
  return {
    name: validateMapProviderName(name),
    url: validateMapProviderUrl(url),
  };
}

export function validateMapStyleUrl(
  value: string | undefined,
  production = process.env.NODE_ENV === 'production',
): string {
  const candidate = value ?? DEFAULT_MAP_STYLE_URL;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('EXPO_PUBLIC_MAP_STYLE_URL must be a valid absolute URL.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      'EXPO_PUBLIC_MAP_STYLE_URL must not include credentials, query, or fragment.',
    );
  }
  const hostname = url.hostname.toLowerCase();
  if (
    OSM_FOUNDATION_TILE_HOSTS.has(hostname) ||
    hostname.endsWith('.tile.openstreetmap.org')
  ) {
    throw new Error(
      'EXPO_PUBLIC_MAP_STYLE_URL must not use OpenStreetMap Foundation public tile hosts.',
    );
  }
  if (
    url.protocol !== 'https:' &&
    (production ||
      !(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)))
  ) {
    throw new Error(
      'EXPO_PUBLIC_MAP_STYLE_URL must use HTTPS in production; HTTP is local-development only.',
    );
  }
  return url.toString().replace(/\/$/, '');
}

export const environment = {
  apiUrl: validateApiUrl(
    process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000',
  ),
  mapStyleUrl: validateMapStyleUrl(process.env.EXPO_PUBLIC_MAP_STYLE_URL),
  mapProvider: validateMapProvider(
    process.env.EXPO_PUBLIC_MAP_PROVIDER_NAME,
    process.env.EXPO_PUBLIC_MAP_PROVIDER_URL,
  ),
  appleClientId: process.env.EXPO_PUBLIC_APPLE_CLIENT_ID,
  googleClientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID,
};
