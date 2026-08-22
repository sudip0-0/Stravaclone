import type { Coordinate } from './types.js';

/** Provider-neutral request; result positions correspond one-to-one with input positions. */
export interface ElevationProviderRequest {
  readonly points: readonly Coordinate[];
}

export interface ElevationProviderResult {
  readonly elevationsM: readonly (number | null)[];
}

/** Domain port only. Concrete providers such as OpenTopoData belong in an adapter package. */
export interface ElevationProvider {
  getElevations(
    request: ElevationProviderRequest,
  ): Promise<ElevationProviderResult>;
}
