/** Shared v1 product limits (REC-14, ACT-1, PHO-1). */
export const MAX_ACTIVITY_DURATION_SECONDS = 12 * 60 * 60;
export const SAVE_ELIGIBILITY_POLICY = 'duration_or_distance' as const;
export const MIN_SAVE_DURATION_SECONDS = 30;
export const MIN_SAVE_DISTANCE_METERS = 50;
export const MAX_ACTIVITY_POINTS = 100_000;
export const MAX_ACTIVITY_PHOTOS = 10;
export const MAX_PHOTO_INPUT_BYTES = 10 * 1024 * 1024;
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const SIGNED_UPLOAD_TTL_SECONDS = 15 * 60;
