import { useSyncExternalStore } from 'react';
import type { Sport } from '@trail/contracts';

export interface RouteHandoff {
  readonly ownerUserId: string;
  readonly routeId: string;
  readonly sport: Sport;
  readonly polyline: string;
  readonly waypoints: readonly { latitude: number; longitude: number }[];
}
let value: RouteHandoff | null = null;
const listeners = new Set<() => void>();
function emit() {
  for (const listener of listeners) listener();
}
export function setRouteHandoff(next: RouteHandoff): void {
  value = next;
  emit();
}
export function clearRouteHandoff(): void {
  value = null;
  emit();
}
export function consumeRouteHandoff(ownerUserId: string): RouteHandoff | null {
  if (!value || value.ownerUserId !== ownerUserId) return null;
  const consumed = value;
  value = null;
  emit();
  return consumed;
}
export function getRouteHandoff(
  ownerUserId: string | null,
): RouteHandoff | null {
  if (value && value.ownerUserId !== ownerUserId) value = null;
  return value;
}
export function useRouteHandoff(
  ownerUserId: string | null,
): RouteHandoff | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => getRouteHandoff(ownerUserId),
    () => null,
  );
}
