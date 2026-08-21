# Trail Product Brief

**Working name:** Trail  
**Release:** v1  
**Status:** Definition based on `PRD.md` v1.0  
**Platforms:** iOS and Android via Expo  
**Business model:** Free closed beta; no ads, paywall, or in-app purchases in v1. Paid Apple/Google developer accounts remain an unavoidable distribution cost.

## 1. Product summary

Trail is a private, phone-first outdoor activity log for runners, cyclists, walkers, and hikers. It lets a person reliably record GPS in the background, save even when offline, and later review the path, timing, splits, elevation, photos, routes, and training volume.

Trail is deliberately not a social network in v1. Its value is confidence and clarity: press Start, put the phone away, return to a complete activity, and understand recent training without a feed competing for attention.

The product must not be named, marketed, or presented as Strava. “Trail” is the current working name and must be confirmed before store submission.

## 2. Problem and opportunity

Mainstream fitness products often combine recording with social discovery, competition, and wearable ecosystems. A meaningful group of phone-first athletes instead needs:

- Recording that survives a locked screen, app switches, weak signal, and temporary loss of network.
- A single useful activity page rather than a social post.
- Reusable routes without a complex desktop planning tool.
- Straightforward week/year totals and a calendar.
- Private-by-default tracks and photos.

The hardest product problem is trust. A beautiful dashboard cannot compensate for a lost or duplicated activity. Reliability, recovery, and transparent sync status therefore outrank optional polish.

## 3. Target users

### Maya — frequent runner

Runs three to five times per week, usually on familiar roads. She needs one-tap recording, dependable lock-screen behavior, pace splits, and weekly distance.

### Jordan — cyclist

Records longer 60–120 minute rides. He needs background GPS, a saved loop, a readable map, elevation, and yearly volume.

### Priya — weekend walker/hiker

May be offline or under poor GPS coverage. She values a resilient map record and photos more than competitive metrics.

### Not targeted in v1

Coaches, teams, social creators, wearable-first athletes, desktop route planners, clubs, and enterprise fleets are not primary users.

## 4. Product principles

1. **Recording comes first.** Never require network to record, pause, stop, or save locally.
2. **Make state obvious.** Users can tell whether GPS is weak, recording is paused, an activity is pending upload, or a photo failed.
3. **Recover rather than surprise.** Process death offers resume; destructive actions require confirmation; retries do not duplicate data.
4. **Private by default.** There are no public activity URLs. GPS and photos are owner-only.
5. **Show useful truth.** Filter GPS noise, label processing/fallback states, and do not imply precision the data cannot support.
6. **Stay focused.** Do not let social, hardware, subscription, or import features delay v1.
7. **Respect platforms and providers.** Ask permissions in context, explain background use, and show map attribution.

## 5. Core jobs and outcomes

| Job                       | Desired outcome                                                | Product proof                     |
| ------------------------- | -------------------------------------------------------------- | --------------------------------- |
| Record an activity        | A complete, accurate-enough track and stats                    | Locked-screen and offline QA pass |
| Recover from interruption | No in-progress work is silently lost                           | Resume after forced process death |
| Review an activity        | Map, headline stats, splits, elevation, and photos together    | Detail acceptance criteria pass   |
| Reuse a route             | Saved named path can seed recording                            | Route-to-record journey passes    |
| Track volume              | Current week/year and calendar reflect synchronized activities | Mixed-sport/timezone tests pass   |
| Control personal data     | User can edit/delete and data remains private                  | Ownership and deletion tests pass |

## 6. v1 experience

### 6.1 Onboarding and account

A new user sees a short value explanation, then creates an account with email/password, Apple, or Google. Location is not requested at signup. The app stores a secure session and lands on Record. Profile choices include display name, default sport, and metric/imperial units.

If multiple providers represent the same person, linking follows a documented, verified policy. Trail must not silently merge accounts from an unverified email match.

### 6.2 Recording

The Record tab opens with a live map and sport selector: run, ride, walk, or hike. Permission education occurs when the user demonstrates intent to record. Start is disabled with an explanation when location is denied.

During recording the user sees elapsed time, distance, pace for run/walk/hike or speed for ride, and GPS accuracy represented with both text/icon and color. Pause freezes activity time and point collection. The map follows the user until manually panned.

A recording persists through backgrounding and process death. Poor GPS produces a persistent warning but does not prohibit Start. Offline use is fully supported. At Stop, the user confirms Save or Discard. Save is available after at least 30 seconds or 50 metres. Recordings stop at 12 hours and prompt for save.

### 6.3 Saving and synchronization

Save first commits to the device. Network upload happens immediately when possible or queues for later. Status language is explicit: Waiting to upload, Uploading, Synced, or Needs attention. Activity UUIDs are stable so retries create exactly one server activity.

Unsynced activities do not contribute to server-derived week/year totals; the UI shows a pending banner so totals are not misleading. Sign-out cannot silently erase an active or pending draft.

### 6.4 Activity review

The Activity tab lists synchronized activities newest first with sport, date, distance, and time. Detail contains:

- Full route polyline fitted on a map.
- Distance, moving time, elapsed time, average pace/speed, and elevation gain.
- One-kilometre or one-mile splits based on profile units, including a partial final split.
- Elevation chart, with processing/fallback state when appropriate.
- Title, notes, and attached photo gallery.

Users can edit title/notes and delete an activity after confirmation. GPS track editing and calories are not in v1. An OS share image is desirable but not a launch blocker.

### 6.5 Photos

Users can attach up to ten private photos from the library, with a maximum input size of 10 MB each; camera capture is expected if schedule permits. Activity save does not wait for photo upload. Failed photos retry independently and remain visibly pending.

Supported inputs are normalized, EXIF is stripped, and only intentionally retained capture time/location may create a map marker. Deleting a photo removes its database record and private object.

### 6.6 Routes

The Routes tab lists named personal routes. A builder lets users tap ordered waypoints, undo, clear, see distance, name, and save. Tap-to-draw is required. Snap-to-roads is a documented v1 SHOULD cut and is deferred rather than connected to an unlicensed public demo API. Route elevation estimates are also not required; later providers must be licensed or self-hosted.

Route detail includes map, stats, and Record this route. That action opens Record with sport and route overlay prefilled but never starts location collection automatically. The saved activity records its route relationship.

### 6.7 Training view and settings

You shows current local-week totals, calendar-year totals, per-sport filters, and a month calendar whose active days open their activities. Metrics are distance, moving time, activity count, and elevation gain. Week start follows device locale, while stored instants remain UTC.

Settings includes units, linked account status, sign out, account deletion, legal links, and map attribution. English is the only v1 UI language, but date and number formatting follow locale.

## 7. Navigation and information architecture

| Tab      | Primary content                              | Key actions                               |
| -------- | -------------------------------------------- | ----------------------------------------- |
| Record   | Live map, sport, GPS state, HUD              | Start, pause, resume, stop, save/discard  |
| Activity | Reverse-chronological history                | Open, edit, attach photos, delete         |
| Routes   | Saved routes and planner                     | Create, view, delete, record route        |
| You      | Week/year totals, calendar, profile/settings | Filter, inspect day, change units/account |

Auth uses a separate welcome/sign-in/sign-up/reset flow. Record includes save and crash-resume surfaces. Activity includes edit and photo viewer. Routes includes builder/detail. Empty states always offer the next relevant action.

## 8. Scope

### Must ship

- Email/password, Apple, and Google authentication with secure renewable sessions.
- Profile, default sport, and global units.
- Foreground/background GPS with pause/resume, crash buffer, offline save, recovery, and permission UX.
- Idempotent sync and explicit upload status.
- Activity list/detail, canonical stats, splits, elevation, edit/delete.
- Private photo attach/storage/delete/retry.
- Tap-to-draw saved routes and record-from-route.
- Week/year totals, sport filters, and calendar.
- Accessibility basics, attribution, privacy/legal, and production-shaped services.

### Expected unless formally cut

- Password reset and account deletion.
- Camera capture and photo map markers.
- Route elevation estimate and pre-save waypoint adjustment.
- Previous week/year navigation.
- Share image and diagnostic export.

### Explicitly out of v1

- Feed, follows, kudos, comments, clubs, challenges, segments, leaderboards.
- Privacy zones and public activity pages.
- GPX/FIT import; GPX export is a later candidate.
- Garmin, Apple Health, Health Connect, watches, or other cloud sync.
- Web/tablet product, live tracking/SOS, coaching, nutrition, sleep, training zones.
- Ads, subscription, paywall, or in-app purchases.
- Downloadable offline map packs.
- Snap-to-roads (deferred from the v1 SHOULD scope by explicit planning decision).

## 9. Quality bar and release criteria

v1 is complete only when primary journeys pass on real devices, including a locked-screen recording of at least 20 minutes on supported iOS and Android targets.

| Measure                                                  | Target                                             |
| -------------------------------------------------------- | -------------------------------------------------- |
| Signup to first saved activity within 24 hours           | At least 40% of signups granting location          |
| Start-to-save completion for sessions at least 2 minutes | At least 70%                                       |
| Upload success within one hour once network is available | At least 99%                                       |
| Crash-free beta sessions                                 | At least 99.5%                                     |
| Locked-screen background recording                       | Pass current target iOS and Android device scripts |
| First-run happy path                                     | Under 10 minutes excluding the activity itself     |

Minimum release evidence includes all auth methods; refresh after cold start; locked-screen known-loop recording; airplane-mode record and exactly-once upload; process-kill recovery; photo add/delete and blob removal; raw route creation/record handoff plus the documented snap deferral; permission denial; and mixed-sport stats/calendar.

## 10. Privacy, safety, and compliance

Trail collects account identifiers, private GPS tracks, photos selected by the user, and limited device/session metadata needed for authentication and reliability. Data is retained until the user deletes an activity/account under the published policy. Location data is not sold and raw GPS is never sent to analytics.

The app asks for location in context and explains why background access is needed. Android shows a persistent recording notification. Apple review materials must connect Always/background use only to active fitness tracking. Camera/library requests occur only when adding photos.

All maps use MapLibre and visibly display OpenStreetMap and provider attribution. Local development and the controlled free beta use the OpenFreeMap public instance under its terms; OSM Foundation public tile servers are never used. Self-hosted Protomaps is the fallback if OpenFreeMap terms, quota, or reliability do not fit. This beta choice is not an availability or public-scale commitment.

## 11. Product decisions

The following defaults resolve PRD questions for planning and may be changed only through a documented decision:

| Topic                     | v1 default                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| Identity                  | Working name Trail; dev slug `trail`; temporary iOS/Android IDs `com.trailapp.mobile`               |
| External identity blocker | Final brand, domain, legal owner, and store IDs/accounts are not decided                            |
| Sports                    | Run, ride, walk, hike                                                                               |
| Language                  | English UI; locale-aware formatting                                                                 |
| Pricing/distribution      | Free closed beta only; paid store developer accounts are unavoidable                                |
| Calories                  | Hidden                                                                                              |
| Save eligibility          | At least 30 seconds or 50 metres                                                                    |
| Maximum activity          | 12 hours, then stop and prompt                                                                      |
| Activity payload          | Stable client UUID; maximum 100,000 filtered points; retain filtered points in v1                   |
| Unsynced stats            | Exclude and show pending banner                                                                     |
| Week start                | Device locale                                                                                       |
| Analytics                 | None or first-party aggregate counts only                                                           |
| Photo policy              | Maximum 10, 10 MB input each; strip EXIF and intentionally store selected location/time             |
| Route snapping            | Deferred from v1; raw tap-to-draw ships without a demo routing dependency                           |
| Elevation                 | Smoothed GPS fallback; self-hosted OpenTopoData adapter is later work                               |
| Beta maps                 | OpenFreeMap public instance with visible attribution; self-hosted Protomaps fallback                |
| Beta services             | Koyeb free API (no SLA, scale-to-zero), Neon free Postgres, private Cloudflare R2, Resend free SMTP |
| Recovery target           | Daily database backups and a documented/tested restore, subject to free-tier limitations            |
| Sessions                  | 15-minute access token; rotating 30-day refresh family with reuse detection                         |

## 12. Risks and product responses

| Risk                       | Product impact                      | Response                                                                         |
| -------------------------- | ----------------------------------- | -------------------------------------------------------------------------------- |
| OS kills background work   | Lost trust and activities           | Native background configuration, foreground service, durable checkpoints, OEM QA |
| Always-location rejection  | Store release blocked               | Contextual education, exact purpose strings, fitness-only use, review notes      |
| GPS/elevation noise        | Implausible stats                   | Accuracy/jump filters, smoothing, DEM enrichment, transparent fallback           |
| Offline/duplicate sync     | Missing or doubled totals           | Local-first save, stable UUID, idempotent API, visible status                    |
| Tile/routing terms or cost | Maps fail or launch is noncompliant | Provider abstraction, quotas, licensed production plan                           |
| SSO collision              | User loses access or data boundary  | Verified linking policy and tests                                                |
| Scope expands into social  | Reliability work delayed            | Keep social features in a separate v2 PRD                                        |

## 13. Roadmap after v1

**v1.1 hardening:** auto-pause, GPX export, share-card polish, possible selected-region offline maps, password reset if deferred, data export, and deletion polish.

**v2 social:** follows, feed, kudos, comments, visibility, and optional privacy zones.

**v3 graph/hardware:** segments, leaderboards, clubs/challenges, GPX/FIT import, health/wearable integrations, and watch applications.

**Later:** web dashboard, subscriptions, coaching/training plans, and safety live tracking. Each requires its own validation and PRD rather than assumptions added to v1.
