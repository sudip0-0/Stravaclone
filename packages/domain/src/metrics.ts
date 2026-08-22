export function paceSecondsPerUnit(
  movingTimeS: number,
  distanceM: number,
  unitDistanceM = 1000,
): number | null {
  if (movingTimeS < 0 || distanceM <= 0 || unitDistanceM <= 0) return null;
  return (movingTimeS * unitDistanceM) / distanceM;
}

export function speedMetersPerSecond(
  movingTimeS: number,
  distanceM: number,
): number | null {
  if (movingTimeS <= 0 || distanceM < 0) return null;
  return distanceM / movingTimeS;
}

export function metersPerSecondToKilometersPerHour(speedMps: number): number {
  return speedMps * 3.6;
}

export function metersPerSecondToMilesPerHour(speedMps: number): number {
  return speedMps * 2.236_936_292_054_4;
}
