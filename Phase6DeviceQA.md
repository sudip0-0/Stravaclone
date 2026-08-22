# Phase 6 device QA

This is a release-gate script for `RTE-1`, `RTE-3`, `RTE-4`, `RTE-5`, `RTE-8`, and journey 5.2. Automated tests do not replace these checks. Record device/OS/build, date, tester, result, and screenshots (without personal locations) for both supported iOS and Android devices.

## Privacy-default and five-waypoint route

1. Sign in and open **Routes**. Confirm the empty state and **Build a route** CTA.
2. Open the builder. Confirm no tile request occurs and **Map network is off** is shown by default.
3. Read the disclosure, choose **Load map with network**, and confirm OpenStreetMap/OpenFreeMap attribution remains visible.
4. Tap five distinct locations in order. Confirm the raw line follows all five taps, waypoint count increments in order, and live distance changes. Confirm there is no **Snap** control.
5. Use **Undo**, add the fifth point again, then **Clear**. Re-add five points.
6. Enter a name and optional sport hint. Confirm Save is unavailable below two points or with a blank name.
7. Save, reopen from the list, paginate a seeded list if available, and compare detail distance/line with the builder. Confirm the unsnapped/no-routing disclosure.
8. Disable network, create another route, and confirm Save immediately opens its cached detail with a pending status. Force-close/reopen and confirm list/detail remain usable.
9. Reconnect and foreground Trail. Confirm the pending route becomes synced. Rename and delete while offline; confirm local state changes immediately and a deleted route never reappears from stale list responses, including after restart. Confirm the retained tombstone is bounded to the documented 30-day safety window.
10. Confirm no routing/elevation request occurs throughout.

## Route-to-record handoff

1. On route detail choose **Record this route**.
2. Confirm Record opens with the route sport and overlay but recording has **not** started.
3. Choose **Clear route overlay** before Start and confirm both overlay and pending association clear. Repeat the handoff and start recording explicitly.
4. Confirm the handoff is consumed only after the local session is created. Simulate native start failure or force-close during paused recovery; confirm that session retains its route ID and cached overlay, while a later new recording does not inherit it.
5. Record past the normal save threshold, stop, save locally, force-close/reopen before sync, then sync.
6. Confirm the local session/sync payload and resulting activity retain the owned route ID.
7. Sign out or switch owners during a fresh handoff. Confirm the next owner cannot see or use the previous owner's handoff.

## Delete and ownership

1. Record/save an activity from a route, then delete the route using the destructive confirmation.
2. Confirm the activity remains and no longer references the deleted route.
3. Using two test accounts, confirm route list/detail/update/delete are owner-only and an activity cannot be created with the other account's route ID.

## Evidence

- Local automated evidence: API 82/82, mobile 145/145, API/mobile coverage, Postgres/MinIO/Mailpit/HEIC integrations, lint/typecheck/build, Expo Doctor, audit, and drift checks passed. This does not satisfy device QA.
- iOS: **Not run**
- Android: **Not run**
- Physical-device release gate: **OPEN**
- Approved v1 exception: routes are encoded straight-line raw waypoints; snap-to-roads and route elevation are intentionally unavailable, with no routing/elevation network provider calls.
