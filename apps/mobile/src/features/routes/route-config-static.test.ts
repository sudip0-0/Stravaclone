import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sources = [
  'route-map.tsx',
  'route-screens.tsx',
  'route-sync-runtime.tsx',
  '../../config/environment.ts',
]
  .map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'))
  .join('\n');
describe('Phase 6 provider/privacy configuration', () => {
  it('contains no public demo routing/elevation endpoint or Snap control', () => {
    expect(sources).not.toMatch(
      /router\.project-osrm|openrouteservice|graphhopper|opentopodata/i,
    );
    expect(sources).not.toMatch(/label=["']Snap/i);
  });
  it('wires route retries to foreground, connectivity, and persisted deadlines', () => {
    expect(sources).toContain("state === 'active'");
    expect(sources).toContain('state.isConnected');
    expect(sources).toContain('nextRouteAttemptAt');
    expect(sources).toContain('setTimeout');
  });
  it('keeps explicit map disclosure and attribution', () => {
    expect(sources).toContain('Map network is off');
    expect(sources).toContain('OpenStreetMap');
    expect(sources).toContain('OpenFreeMap');
  });
});
