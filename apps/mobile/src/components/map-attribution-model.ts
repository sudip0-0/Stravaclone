import type { MapProviderConfig } from '../config/environment';

export const MAP_ATTRIBUTION_MIN_TARGET_SIZE = 48;
export const MAP_ATTRIBUTION_MAX_TEST_FONT_SCALE = 2;
export const OPENSTREETMAP_ATTRIBUTION = {
  label: '© OpenStreetMap',
  url: 'https://www.openstreetmap.org/copyright',
} as const;

export function mapAttributionLinks(provider: MapProviderConfig) {
  return [
    OPENSTREETMAP_ATTRIBUTION,
    { label: provider.name, url: provider.url },
  ] as const;
}

const attributionHorizontalPadding = 16;
const attributionGap = 4;
const estimatedGlyphWidth = 7;

export type AttributionLayoutModel = {
  rowCount: number;
  rows: readonly (readonly number[])[];
  targetHeight: number;
  targetWidths: readonly number[];
};

/**
 * Conservative evidence model for narrow-width and enlarged-text checks. Native
 * font metrics still require physical-device validation.
 */
export function mapAttributionLayoutModel(
  provider: MapProviderConfig,
  containerWidth: number,
  fontScale: number,
): AttributionLayoutModel {
  const usableWidth = Math.max(1, containerWidth - 8);
  const targetWidths = mapAttributionLinks(provider).map(({ label }) =>
    Math.max(
      MAP_ATTRIBUTION_MIN_TARGET_SIZE,
      Math.min(
        usableWidth,
        Math.ceil(label.length * estimatedGlyphWidth * fontScale) +
          attributionHorizontalPadding,
      ),
    ),
  );
  const rows: number[][] = [[]];
  let occupied = 0;
  for (const width of targetWidths) {
    const required = occupied === 0 ? width : attributionGap + width;
    if (occupied > 0 && occupied + attributionGap + width > usableWidth) {
      rows.push([width]);
      occupied = width;
    } else {
      rows[rows.length - 1]!.push(width);
      occupied += required;
    }
  }
  return {
    rowCount: rows.length,
    rows,
    targetHeight: MAP_ATTRIBUTION_MIN_TARGET_SIZE,
    targetWidths,
  };
}
