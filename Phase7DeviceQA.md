# Phase 7 device QA — training stats and calendar

Phase 7 automated coverage is necessary but not sufficient. Run this script on one supported iOS device and one supported Android device before accepting `STA-1`–`STA-4`. Record device/OS/app build, locale, timezone, profile units, API build, date, tester, and actual result. Do not mark the phase device gate complete until evidence is attached.

## Setup

1. Use a private test account with no unrelated activities. Set the device to a Sunday-first locale (for example `en-US`) and an IANA timezone that observes DST (for example `America/New_York`).
2. Save and fully synchronize one Run and one Ride whose local start dates are in the current week. Record each source activity's distance, moving time, and elevation gain.
3. Keep a third saved activity locally pending by disabling network before save.

## Week/year totals and sync truth

1. Open **You**. Confirm loading is announced and the pending-sync banner says the pending activity is excluded.
2. For **All**, independently sum the two synchronized source activities. Confirm week and year distance, moving time, count, and elevation match. Confirm the pending local activity changes neither total.
3. Select Run, Ride, Walk, and Hike. Confirm each total contains only the selected canonical server activities and empty sports have an understandable zero/empty state.
4. Restore network and wait for the pending activity to synchronize. Retry/reopen You and confirm totals now include it naturally.
5. Delete one synchronized activity. Retry/reopen You and confirm it disappears from totals and calendar without a stale-rollup delay.
6. Switch profile units between Metric and Imperial. Confirm the same SI source values render with correct km/mi and m/ft conversion; counts and moving time do not change.

## Calendar and navigation

1. Confirm weekday headers and column alignment use the locale's first weekday. Change to a Monday-first locale (for example `en-GB`), restart, and confirm alignment changes without changing activity local dates.
2. Confirm the month title and weekday labels are localized. Navigate over December/January and a short/long month; confirm all dates appear once and marks/counts match synchronized activities.
3. Tap a marked day. Confirm only activities whose **start instant** falls on that local date appear; tap an item and confirm its Activity detail opens.
4. Navigate previous/next week and year. Future navigation must stop at the current period. Confirm labels/totals update and no arbitrary date-range request is possible from the UI.

## DST, offline, and recovery

1. With a DST-observing test timezone and seeded boundary fixtures, verify activities at local midnight around spring-forward and fall-back appear in the correct week/day. Also verify Dec 31/Jan 1 local dates where UTC date/year differs.
2. Disable network and reopen You. Confirm the shell offline banner plus stats connection/error state and retry action are visible. Previously fetched totals must not be presented as newly refreshed truth.
3. Restore network and tap **Try again**. Confirm week, year, month marks, and selected-day list recover together.
4. Check VoiceOver/TalkBack: sport filters expose selected radio state; days announce date and activity count; navigation and activity rows are buttons; loading/errors are understandable without color.

## Evidence / status

- iOS: **Not run — physical device required.**
- Android: **Not run — physical device required.**
- Automated temporal/API/model evidence: recorded in the Phase 7 test suites; it does not replace this device matrix.
