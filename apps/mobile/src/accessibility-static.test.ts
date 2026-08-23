import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (relative: string) =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

describe('static React Native accessibility contracts', () => {
  it('keeps accessible roles, states, live regions, and 48dp targets in shared controls', () => {
    const ui = source('./components/ui.tsx');
    expect(ui).toContain('accessibilityRole="button"');
    expect(ui).toContain('accessibilityState={{ disabled: blocked, busy }}');
    expect(ui).toContain('accessibilityLiveRegion');
    expect(ui).toContain('minHeight: 48');
  });
  it('keeps Record controls text-labelled, stateful, and attribution visible', () => {
    const record = source('./features/record/record-screen.tsx');
    const map = source('./features/record/recording-map.tsx');
    const attribution = source('./components/map-attribution.tsx');
    expect(record).toContain('accessibilityRole="radiogroup"');
    expect(record).toContain('accessibilityRole="radio"');
    expect(record).toContain('accessibilityLiveRegion="polite"');
    expect(record).toContain('accessibilityLabel={`${label}: ${value}`}');
    expect(map).toContain(
      '<MapAttribution provider={environment.mapProvider} />',
    );
    expect(attribution).toContain('accessibilityRole="link"');
    expect(attribution).toContain("flexWrap: 'wrap'");
    expect(attribution).toContain('minHeight: 48');
    expect(map).toContain('Map unavailable in this build');
    expect(map).toContain('Map network is off');
    expect(map).toContain('Load map with network');
    expect(map).toContain('Turn map network off');
    expect(map).toContain('IP address and requested map area');
  });
  it('exposes the blocking cleanup-required state and retry action', () => {
    const navigation = source('./navigation/root-navigation.tsx');
    expect(navigation).toContain('Local cleanup required');
    expect(navigation).toContain('Retry local cleanup');
    expect(navigation).toContain("phase === 'cleanup-required'");
  });
  it('wires keyboard next actions and invalid password/token refs', () => {
    const auth = source('./features/auth/auth-screens.tsx');
    expect(auth).toContain(
      'onSubmitEditing={() => passwordRef.current?.focus()}',
    );
    expect(auth).toContain('firstInvalidField(invalid)');
    expect(auth).toContain('label="Reset token"');
    expect(auth).toContain('inputRef={confirmRef}');
  });
  it('covers activity, photo, route, stats, profile, and destructive-action contracts', () => {
    const activity = source('./features/activities/activity-screens.tsx');
    const activityMap = source('./features/activities/activity-map.tsx');
    const attribution = source('./components/map-attribution.tsx');
    const photos = source('./features/photos/photo-gallery.tsx');
    const routes = source('./features/routes/route-screens.tsx');
    const routeMap = source('./features/routes/route-map.tsx');
    const stats = source('./features/stats/stats-screen.tsx');
    const profile = source('./features/profile/profile-screens.tsx');
    expect(activity).toContain('accessibilityState={{ disabled: local }}');
    expect(activity).toContain('variant="danger"');
    expect(activityMap).toContain(
      '<MapAttribution provider={environment.mapProvider} />',
    );
    expect(attribution).toContain('accessibilityLabel="Map attribution"');
    expect(attribution).toContain('minHeight: 48');
    expect(photos.match(/variant="danger"/g)?.length).toBeGreaterThanOrEqual(3);
    expect(routes).toContain('accessibilityLabel="Sport hint"');
    expect(routeMap).toContain('Map unavailable in this build');
    expect(routeMap).toContain(
      '<MapAttribution provider={environment.mapProvider} />',
    );
    expect(stats).toContain('formatCalendarDate(cell.date, locale)');
    expect(stats).toContain('horizontal');
    expect(stats).toContain('width: CALENDAR_CELL_SIZE');
    expect(stats).toContain('disabled: !cell.inMonth');
    expect(stats).not.toContain('minHeight: 44');
    expect(profile).toContain('inputRef={deletePasswordRef}');
    expect(profile).toContain('variant="danger"');
  });
  it('keeps locale and profile-unit formatting at every distance/date presentation boundary', () => {
    const activity = source('./features/activities/activity-screens.tsx');
    const activityModel = source('./features/activities/activity-model.ts');
    const record = source('./features/record/record-screen.tsx');
    const routes = source('./features/routes/route-screens.tsx');
    const stats = source('./features/stats/stats-screen.tsx');
    expect(activity).toContain("dateStyle: 'medium'");
    expect(activityModel).toContain('new Intl.NumberFormat(locale');
    expect(record).toContain(
      'formatAccuracy(session.latestRawAccuracyM, units)',
    );
    expect(record).toContain("units === 'imperial' ? '164 feet' : '50 metres'");
    expect(
      routes.match(/formatDisplayDistance\(/g)?.length,
    ).toBeGreaterThanOrEqual(3);
    expect(stats).toContain('formatCalendarDate(state.selectedDate, locale)');
  });
});
