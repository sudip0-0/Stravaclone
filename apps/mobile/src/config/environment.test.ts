import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAP_PROVIDER_NAME,
  DEFAULT_MAP_PROVIDER_URL,
  DEFAULT_MAP_STYLE_URL,
  MAP_PROVIDER_NAME_MAX_LENGTH,
  validateApiUrl,
  validateMapProvider,
  validateMapProviderName,
  validateMapProviderUrl,
  validateMapStyleUrl,
} from './environment';

describe('validateApiUrl', () => {
  it('accepts HTTPS and explicit development loopback URLs', () => {
    expect(validateApiUrl('https://api.example.com/')).toBe(
      'https://api.example.com',
    );
    expect(validateApiUrl('http://10.0.2.2:3000')).toBe('http://10.0.2.2:3000');
  });
  it('rejects insecure remote and malformed values', () => {
    expect(() => validateApiUrl('http://api.example.com')).toThrow(/HTTPS/);
    expect(() => validateApiUrl('not a url')).toThrow(/absolute/);
    expect(() => validateApiUrl(undefined)).toThrow(/required/);
  });
});

describe('validateMapProvider', () => {
  it('defaults both disclosure fields to OpenFreeMap', () => {
    expect(validateMapProvider(undefined, undefined)).toEqual({
      name: DEFAULT_MAP_PROVIDER_NAME,
      url: DEFAULT_MAP_PROVIDER_URL,
    });
  });

  it('accepts a custom Protomaps-style provider configured at build time', () => {
    expect(
      validateMapProvider('Protomaps', 'https://maps.example.com/provider/'),
    ).toEqual({
      name: 'Protomaps',
      url: 'https://maps.example.com/provider',
    });
  });

  it.each([
    '',
    ' Protomaps',
    'Protomaps\nMaps',
    '<Protomaps>',
    'x'.repeat(MAP_PROVIDER_NAME_MAX_LENGTH + 1),
  ])('rejects unsafe or unbounded provider label %j', (name) => {
    expect(() => validateMapProviderName(name)).toThrow(/safe label/);
  });

  it('requires a credential-free HTTPS provider URL without query or fragment', () => {
    expect(() => validateMapProviderUrl('http://protomaps.com')).toThrow(
      /HTTPS/,
    );
    const credentialUrl = new URL('https://protomaps.com');
    credentialUrl.username = 'user';
    credentialUrl.password = 'pass';
    expect(() => validateMapProviderUrl(credentialUrl.toString())).toThrow(
      /credentials/,
    );
    expect(() =>
      validateMapProviderUrl('https://protomaps.com?source=trail'),
    ).toThrow(/query/);
    expect(() => validateMapProviderUrl('https://protomaps.com#terms')).toThrow(
      /fragment/,
    );
    expect(() => validateMapProviderUrl('not a url')).toThrow(/absolute/);
  });
});

describe('validateMapStyleUrl', () => {
  it('defaults to the OpenFreeMap HTTPS style and accepts approved HTTPS styles', () => {
    expect(validateMapStyleUrl(undefined, true)).toBe(DEFAULT_MAP_STYLE_URL);
    expect(
      validateMapStyleUrl('https://maps.example.com/style.json/', true),
    ).toBe('https://maps.example.com/style.json');
  });

  it('permits HTTP loopback only outside production', () => {
    expect(validateMapStyleUrl('http://localhost:8080/style.json', false)).toBe(
      'http://localhost:8080/style.json',
    );
    expect(() =>
      validateMapStyleUrl('http://localhost:8080/style.json', true),
    ).toThrow(/HTTPS in production/);
    expect(() =>
      validateMapStyleUrl('http://maps.example.com/style.json', false),
    ).toThrow(/local-development only/);
  });

  it.each([
    'tile.openstreetmap.org',
    'a.tile.openstreetmap.org',
    'b.tile.openstreetmap.org',
    'c.tile.openstreetmap.org',
  ])('rejects OSM Foundation public tile host %s', (host) => {
    expect(() =>
      validateMapStyleUrl(`https://${host}/style.json`, true),
    ).toThrow(/OpenStreetMap Foundation public tile hosts/);
  });

  it('rejects malformed URLs, credentials, queries, and fragments', () => {
    expect(() => validateMapStyleUrl('not a url', true)).toThrow(/absolute/);
    const credentialUrl = new URL('https://maps.example.com/style.json');
    credentialUrl.username = 'user';
    credentialUrl.password = 'pass';
    expect(() => validateMapStyleUrl(credentialUrl.toString(), true)).toThrow(
      /credentials/,
    );
    expect(() =>
      validateMapStyleUrl(
        'https://maps.example.com/style.json?token=public',
        true,
      ),
    ).toThrow(/query/);
    expect(() =>
      validateMapStyleUrl('https://maps.example.com/style.json#fragment', true),
    ).toThrow(/fragment/);
  });
});

describe('map component environment wiring', () => {
  const mapSources = [
    '../features/record/recording-map.tsx',
    '../features/activities/activity-map.tsx',
    '../features/routes/route-map.tsx',
  ].map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'));

  it('uses the same validated style and provider for every mobile map', () => {
    for (const source of mapSources) {
      expect(source).toContain("from '../../config/environment'");
      expect(source).toContain('mapStyle={environment.mapStyleUrl}');
      expect(source).toContain(
        '<MapAttribution provider={environment.mapProvider} />',
      );
      expect(source).not.toContain('tiles.openfreemap.org/styles');
      expect(source).not.toContain('OpenFreeMap');
    }
  });

  it('dynamically wires disclosure and settings to the configured provider', () => {
    const activity = readFileSync(
      new URL('../features/activities/activity-screens.tsx', import.meta.url),
      'utf8',
    );
    const settings = readFileSync(
      new URL('../features/profile/profile-screens.tsx', import.meta.url),
      'utf8',
    );
    expect(activity).toContain('environment.mapProvider.name');
    expect(settings).toContain('value={environment.mapProvider.name}');
    expect(settings).toContain('Linking.openURL(environment.mapProvider.url)');
    expect(activity).not.toContain('OpenFreeMap');
    expect(settings).not.toContain('OpenFreeMap');
  });
});
