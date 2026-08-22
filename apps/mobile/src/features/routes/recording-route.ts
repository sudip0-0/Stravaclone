import type { CreateActivityRequest } from '@trail/contracts';
import type { RecordingSession } from '../record/recording-types';

export function recordingRoutePayload(
  session: Pick<RecordingSession, 'routeId'>,
): Pick<CreateActivityRequest, 'route_id'> {
  return { route_id: session.routeId ?? null };
}
