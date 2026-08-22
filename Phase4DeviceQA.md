# Phase 4 device and network QA

## Status

Local implementation and automated tests are complete for the Phase 4 activity API, durable sync state machine, and activity list/detail models. The following release evidence is intentionally **not claimed** because it requires signed iOS/Android development builds, real network transitions, and a representative mid-range device:

- airplane-mode save followed by reconnect and exactly-one visible server activity;
- foreground/background and auth-recovery sync triggers on both platforms;
- 200-row list pagination and a five-hour activity map on a mid-range phone;
- MapLibre fit-to-bounds, attribution, VoiceOver/TalkBack order, dynamic text, and opt-in network privacy copy on physical devices.

Do not mark the Phase 4 exit gate or the remaining `Tasks.md` device item complete until evidence is recorded below.

## Required setup

Use synthetic tracks only. Never copy production GPS, credentials, access tokens, request bodies, or photos into this document. Record app commit/build identifier, OS/device, API environment, and timestamps. Start from the committed Phase 2 database, apply the single squashed Phase 4 schema/outbox migration (`0003_phase4_activities.sql`), and confirm the API readiness endpoint before each run.

## Airplane/reconnect and unknown-commit script

1. Sign in, start a valid recording, enable airplane mode, stop, and choose **Save locally**.
2. Confirm a pending local row and pending banner appear after app restart; verify the local points still exist.
3. Restore connectivity. Confirm one upload enters flight and eventually becomes one server list row with the same client UUID.
4. Repeat while terminating the client after request transmission but before its response. Relaunch and reconnect. Confirm idempotent replay returns the same activity and retained point count, with no second activity.
5. Exercise a 503/429 response and verify backoff rather than tight retries. Exercise terminal validation and UUID conflict fixtures and verify **Needs attention** plus manual retry without deleting local source.
6. Expire the access token before reconnect. Confirm the Phase 2 session coordinator performs one refresh flight and sync resumes; terminal auth loss must preserve owner-scoped local data.

## Activity review and performance script

1. Seed 200 synthetic activities across multiple dates and verify reverse chronology, 50-row cursor loading, no duplicates, loading/error/offline/empty states, and responsive scrolling.
2. Open a synthetic five-hour track with more than 1,000 canonical points. Confirm display geometry is at most 1,000 points, preserves endpoints, and fits the route after explicitly selecting **Load network map**.
3. Confirm no tile request occurs before map opt-in, attribution remains visible, and the privacy copy is readable.
4. Change profile units after ingest. Reopen detail and verify headline/list values and server-provided splits use the current unit system, including the final partial split.
5. Verify the elevation heading and accessibility label say **GPS smoothed**, the chart region is announced meaningfully, and no DEM claim appears.
6. Edit title/notes, test offline/error recovery, cancel delete once, then confirm delete. If photos are seeded, verify an object-deletion outbox row is created before cascade.

## Evidence table

| Date    | Build         | Device / OS               | Scenario                          | Result  | Notes / issue                        |
| ------- | ------------- | ------------------------- | --------------------------------- | ------- | ------------------------------------ |
| Not run | Not available | Physical iOS required     | Airplane/reconnect/unknown commit | BLOCKED | Requires signed development build    |
| Not run | Not available | Physical Android required | Airplane/reconnect/unknown commit | BLOCKED | Requires signed development build    |
| Not run | Not available | Mid-range physical phone  | 200 rows / five-hour map          | BLOCKED | Device performance evidence required |
