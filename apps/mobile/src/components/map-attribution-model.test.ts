import { describe, expect, it } from 'vitest';
import type { MapProviderConfig } from '../config/environment';
import {
  MAP_ATTRIBUTION_MAX_TEST_FONT_SCALE,
  MAP_ATTRIBUTION_MIN_TARGET_SIZE,
  mapAttributionLayoutModel,
  mapAttributionLinks,
} from './map-attribution-model';

const protomapsProvider: MapProviderConfig = {
  name: 'Protomaps Community Edition',
  url: 'https://protomaps.com',
};

describe('Phase 8 map attribution layout evidence model', () => {
  it('keeps custom provider links at least 48dp and wraps inside 320dp at maximum test font scale', () => {
    const layout = mapAttributionLayoutModel(
      protomapsProvider,
      320,
      MAP_ATTRIBUTION_MAX_TEST_FONT_SCALE,
    );
    expect(layout.targetHeight).toBeGreaterThanOrEqual(48);
    expect(layout.targetWidths).toHaveLength(
      mapAttributionLinks(protomapsProvider).length,
    );
    expect(
      layout.targetWidths.every((width) => width >= 48 && width <= 312),
    ).toBe(true);
    expect(layout.rowCount).toBeGreaterThan(1);
    expect(
      layout.rows.every(
        (row) => row.reduce((total, width) => total + width, 0) <= 312,
      ),
    ).toBe(true);
    expect(MAP_ATTRIBUTION_MIN_TARGET_SIZE).toBe(48);
  });

  it('always preserves OpenStreetMap attribution beside the configured provider', () => {
    expect(mapAttributionLinks(protomapsProvider)).toEqual([
      {
        label: '© OpenStreetMap',
        url: 'https://www.openstreetmap.org/copyright',
      },
      { label: protomapsProvider.name, url: protomapsProvider.url },
    ]);
  });
});
