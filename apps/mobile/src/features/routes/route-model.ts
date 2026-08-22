import { trackDistanceM } from '@trail/domain';
import type { Coordinate, Sport } from '@trail/contracts';

export interface RouteBuilderState {
  readonly name: string;
  readonly sportHint: Sport | null;
  readonly waypoints: readonly Coordinate[];
}
export const emptyRouteBuilder: RouteBuilderState = {
  name: '',
  sportHint: null,
  waypoints: [],
};
export function addWaypoint(
  state: RouteBuilderState,
  point: Coordinate,
): RouteBuilderState {
  if (state.waypoints.length >= 1000) return state;
  return { ...state, waypoints: [...state.waypoints, point] };
}
export function undoWaypoint(state: RouteBuilderState): RouteBuilderState {
  return { ...state, waypoints: state.waypoints.slice(0, -1) };
}
export function clearWaypoints(state: RouteBuilderState): RouteBuilderState {
  return { ...state, waypoints: [] };
}
export function routeDistanceM(
  state: Pick<RouteBuilderState, 'waypoints'>,
): number {
  return trackDistanceM(state.waypoints);
}
export function canSaveRoute(state: RouteBuilderState): boolean {
  return (
    state.name.trim().length >= 1 &&
    state.name.trim().length <= 200 &&
    state.waypoints.length >= 2 &&
    state.waypoints.length <= 1000
  );
}
