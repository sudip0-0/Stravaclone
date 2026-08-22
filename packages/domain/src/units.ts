export const METERS_PER_KILOMETER = 1000;
export const METERS_PER_MILE = 1609.344;
export const FEET_PER_METER = 3.280_839_895_013_123;

export function metersToKilometers(meters: number): number {
  return meters / METERS_PER_KILOMETER;
}

export function kilometersToMeters(kilometers: number): number {
  return kilometers * METERS_PER_KILOMETER;
}

export function metersToMiles(meters: number): number {
  return meters / METERS_PER_MILE;
}

export function milesToMeters(miles: number): number {
  return miles * METERS_PER_MILE;
}

export function metersToFeet(meters: number): number {
  return meters * FEET_PER_METER;
}

export function feetToMeters(feet: number): number {
  return feet / FEET_PER_METER;
}
