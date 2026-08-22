import { describe, expect, it } from 'vitest';
import {
  addWaypoint,
  canSaveRoute,
  clearWaypoints,
  emptyRouteBuilder,
  routeDistanceM,
  undoWaypoint,
} from './route-model';
import { recordingRoutePayload } from './recording-route';
import {
  clearRouteHandoff,
  consumeRouteHandoff,
  getRouteHandoff,
  setRouteHandoff,
} from './route-handoff';

describe('Phase 6 route builder and record handoff', () => {
  it('keeps ordered waypoint state, supports undo/clear, and computes live haversine distance', () => {
    const one = addWaypoint(emptyRouteBuilder, { latitude: 0, longitude: 0 });
    const two = addWaypoint(one, { latitude: 0, longitude: 0.001 });
    expect(two.waypoints).toEqual([
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 0.001 },
    ]);
    expect(routeDistanceM(two)).toBeCloseTo(111.195, 2);
    expect(canSaveRoute({ ...two, name: 'Raw route' })).toBe(true);
    expect(undoWaypoint(two).waypoints).toEqual(one.waypoints);
    expect(clearWaypoints(two).waypoints).toEqual([]);
  });
  it('retains and clears route IDs in the eventual activity payload', () => {
    expect(recordingRoutePayload({ routeId: 'route-a' })).toEqual({
      route_id: 'route-a',
    });
    expect(recordingRoutePayload({ routeId: null })).toEqual({
      route_id: null,
    });
  });
  it('hands an owned route to Record without starting and clears it on owner switch', () => {
    setRouteHandoff({
      ownerUserId: 'owner-a',
      routeId: 'route-a',
      sport: 'ride',
      polyline: 'raw',
      waypoints: [
        { latitude: 1, longitude: 2 },
        { latitude: 2, longitude: 3 },
      ],
    });
    expect(getRouteHandoff('owner-a')).toMatchObject({
      routeId: 'route-a',
      sport: 'ride',
    });
    expect(consumeRouteHandoff('owner-a')).toMatchObject({
      routeId: 'route-a',
    });
    expect(consumeRouteHandoff('owner-a')).toBeNull();
    expect(getRouteHandoff('owner-a')).toBeNull();
    setRouteHandoff({
      ownerUserId: 'owner-a',
      routeId: 'route-b',
      sport: 'run',
      polyline: 'raw',
      waypoints: [],
    });
    expect(getRouteHandoff('owner-b')).toBeNull();
    setRouteHandoff({
      ownerUserId: 'owner-b',
      routeId: 'clear-before-start',
      sport: 'walk',
      polyline: 'raw',
      waypoints: [],
    });
    clearRouteHandoff();
    expect(consumeRouteHandoff('owner-b')).toBeNull();
  });
});
