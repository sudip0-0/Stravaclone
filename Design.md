# Trail Phase 2 — Mobile Foundations Design

**Status:** implementation-ready design specification  
**Scope:** onboarding, authentication, four-tab shell, You/profile/settings, shared states, and accessibility for iOS and Android  
**Authority:** `PRD.md` is canonical; this specification narrows `product.md` and `Architecture.md` into Phase 2 UI decisions. It adds no social, recording, route, or activity behavior.

## 1. Experience principles

1. **Trust before decoration.** Session, network, linked-account, and draft state use plain text; color is only reinforcement.
2. **Native and familiar.** Use React Native primitives, safe-area and keyboard handling, native text inputs, switches/pickers, alerts or bottom sheets, and native stack/tab navigation. Respect platform back behavior.
3. **Recording first.** A newly authenticated user lands on **Record**. Location is not requested during onboarding or authentication.
4. **Private and focused.** No feed, social counts, competition, paywall, or promotional carousel.
5. **No paid assets.** Use system fonts and free, platform-appropriate icons. Every icon has a text label or accessibility label; do not rely on custom illustrations.

## 2. Visual foundation

### 2.1 Semantic color tokens

Follow the device light/dark appearance. Components consume semantic names, never raw palette values. Status is always paired with text and, where useful, an icon.

| Token           |              Light |               Dark | Use                                                 |
| --------------- | -----------------: | -----------------: | --------------------------------------------------- |
| `background`    |          `#FFFFFF` |          `#101512` | Screen background                                   |
| `surface`       |          `#F5F7F4` |          `#18201B` | Cards, grouped rows, banners                        |
| `textPrimary`   |          `#172018` |          `#F4F7F4` | Titles and body                                     |
| `textSecondary` |          `#536158` |          `#BCC7BE` | Supporting text                                     |
| `border`        |          `#737D75` |          `#89958C` | Dividers, input outlines, focus/non-text boundaries |
| `action`        |          `#146C43` |          `#65D39A` | Links, selected tab, focus/accent                   |
| `onAction`      |          `#FFFFFF` |          `#092416` | Filled-action content                               |
| `danger`        |          `#B42318` |          `#FFB4AB` | Destructive text/icon                               |
| `onDanger`      |          `#FFFFFF` |          `#101512` | Filled destructive action                           |
| `warning`       |          `#8A4B00` |          `#FFDDB3` | Offline/attention content                           |
| `link`          |          `#0B62A4` |          `#65D39A` | Inline links                                        |
| `scrim`         | `rgba(0,0,0,0.48)` | `rgba(0,0,0,0.64)` | Modal backdrop                                      |

Contrast checks against the applicable background: primary text 16.72:1 light / 17.10:1 dark; secondary text 6.52:1 / 10.59:1; action 6.45:1 / 9.96:1; filled action content 6.45:1 / 8.89:1; danger 6.57:1 / 10.87:1; warning 6.80:1 / 14.28:1; border/non-text boundary 4.27:1 / 5.92:1. These exceed WCAG AA for normal text and the 3:1 non-text threshold. Disabled controls retain a readable label and communicate disabled state programmatically; opacity alone must not convey meaning.

### 2.2 Typography

Use the platform system font by omitting a custom `fontFamily`, with normal character spacing and platform-appropriate font padding. Use semantic text styles so Dynamic Type/font scaling works.

| Style          | Base size / line height | Weight | Use                                         |
| -------------- | ----------------------: | -----: | ------------------------------------------- |
| `display`      |                 32 / 40 |    700 | Welcome value statement only                |
| `title`        |                 28 / 36 |    700 | Screen title                                |
| `sectionTitle` |                 20 / 28 |    600 | Group heading                               |
| `body`         |                 17 / 24 |    400 | Primary copy and form values                |
| `bodyStrong`   |                 17 / 24 |    600 | Buttons and emphasized values               |
| `supporting`   |                 15 / 21 |    400 | Help and state text                         |
| `caption`      |                 13 / 18 |    500 | Metadata; never required instructions alone |

Do not use all caps. Allow wrapping and unlimited scaling on Phase 2 screens. Never encode hierarchy by size alone; preserve headings and accessibility roles.

### 2.3 Spacing, shape, and elevation

- Base grid: 4 dp. Tokens: `space1` 4, `space2` 8, `space3` 12, `space4` 16, `space5` 24, `space6` 32, `space7` 48.
- Screen horizontal inset: 20 dp compact phones; respect safe areas. Vertical section gap: 24 dp.
- Control minimum height: 48 dp. Input/button internal horizontal padding: 16 dp.
- Radii: input/button 12 dp; card/banner 16 dp; modal/sheet top corners 20 dp.
- Prefer 1 dp borders and spacing over shadows. If needed, use a subtle native elevation/shadow only to separate a modal or tab bar.
- Motion uses native navigation and modal transitions. Respect Reduce Motion; no required information depends on animation.

## 3. Shared components

- **Primary button:** filled `action`, `onAction` label, minimum 48 dp, full width in forms. Loading replaces the leading icon with `ActivityIndicator` but keeps the button label (for example, “Signing in…”), and blocks repeat activation.
- **Secondary button:** transparent or `surface`, 1 dp `border`, `textPrimary` label.
- **Destructive button:** text treatment by default; filled `danger` only in final destructive confirmation.
- **Text field:** persistent visible label above the field, 48 dp minimum, native selection/autofill, outline with text error below. Do not use placeholder as the only label. Email uses email keyboard, no auto-capitalization, and appropriate autofill/content type. Password uses secure entry, password autofill/content type, and a labelled Show/Hide control with a 48 dp target.
- **Form error summary:** near the form heading for submission errors; field errors remain adjacent. Announce the summary, then focus the first invalid field. Preserve entered values.
- **Status banner:** icon + short heading + body + optional action. Offline/attention banners remain until resolved; transient success may be announced and removed.
- **Grouped row:** 48 dp minimum, title, optional value/status, optional disclosure indicator. The full row is one accessible target.
- **Modal confirmation:** title describes the consequence, body states what is retained/deleted, safe action first, destructive action last. Android Back and tapping outside are equivalent to Cancel when dismissal is safe.

## 4. Navigation and shell

Use one unauthenticated native stack and one authenticated root containing four tab-owned stacks. Do not show the tab bar in auth. Preserve standard platform back gestures/buttons within a tab.

Tab order and labels are fixed:

1. **Record** — initial tab after successful sign-in/up.
2. **Activity**
3. **Routes**
4. **You**

The bottom tab bar respects the bottom safe area. Each item shows an icon and its persistent text label. Selected state uses `action`, a filled/selected icon treatment, and `accessibilityState={{ selected: true }}`; unselected items use `textSecondary`. Do not use color alone. Each target is at least 48 dp high and spans its equal quarter. At large text sizes, labels may wrap to two lines; they must not disappear.

Phase 2 feature placeholders for Record, Activity, and Routes use a screen title and factual “not available in this build” state only. They must not simulate recording, activity, or route behavior before those phases exist.

## 5. Onboarding and authentication

### 5.1 Welcome

One short, scrollable value screen:

- Trail wordmark rendered as text.
- Heading: **“Record your time outside.”**
- Supporting copy limited to the approved value: record reliably, review maps and stats, and track training.
- Primary **Create account** and secondary **Sign in**.

Do not request location, show permission education, or auto-advance. Decorative imagery is optional and must use free local vector/shape work; it is not required.

### 5.2 Sign up

Order: screen heading, email, password, password rule, **Create account**, SSO divider/actions, existing-account link. Display name, avatar, units, and default sport belong in Profile and are not signup blockers. Password helper says **“Use at least 8 characters.”** Validation is inline after blur and on submit. Duplicate-email responses follow the API’s safe message; do not reveal account details.

Show **Continue with Apple** on iOS when configured and **Continue with Google** on iOS/Android when configured. Use provider-compliant button naming and marks from free official assets. If Google is offered on iOS, Apple must also be offered. Never label an SSO action as linking on this initial screen.

### 5.3 Sign in

Order: heading, email, password, right-aligned **Forgot password?**, **Sign in**, SSO divider/actions, create-account link. Authentication failure uses one non-enumerating message such as **“Email or password is incorrect.”** Keep email populated, clear no fields automatically, and focus the error summary.

### 5.4 Password reset

- Request screen: email field and **Send reset link**.
- Success is identical whether or not an account exists: **“If an account matches that email, we’ll send a password reset link.”**
- The reset-link destination shows new password, confirm password, rule text, and **Reset password**.
- Expired/used/invalid token state: **“This reset link is no longer valid.”** with **Request a new link**.
- Successful reset: **“Password reset.”** and **Return to sign in**. Do not sign in automatically unless product requirements later specify it.

### 5.5 SSO unavailable and link-required

- If a provider is not configured, do not render its button; the corresponding API route is unavailable by architecture. Email remains available.
- If a configured provider fails before identity verification or is temporarily unavailable, keep the user on the same screen and show an inline recoverable message: **“[Provider] sign-in is unavailable. Try again or use email.”** Actions: **Try again** and the existing email path. A cancelled native provider sheet is not an error.
- On `account_link_required`, create no session and do not merge. Show a dedicated screen: **“Sign in to link [Provider]”** and explain that the user must authenticate the existing Trail account first. Primary **Sign in with email**; other already-supported existing-account methods may remain available.
- After existing-account authentication, require a separate confirmation screen: **“Link [Provider] to this Trail account?”** with **Link account** and **Not now**. Only a successful explicit link proceeds to the authenticated shell. Never display provider subject IDs or claim a link before API success.

## 6. You, profile, and settings

### 6.1 You root

Use a native scroll view with screen title **You**. Phase 2 contains navigation rows for **Profile** and **Settings**. Week/year totals and calendar remain factual unavailable placeholders until their product phase; do not invent zero totals or sample activity data.

### 6.2 Profile

Editable fields are limited to the approved profile model:

- Optional avatar: platform image picker entry only when implemented; always show display name fallback text.
- Display name.
- Default sport: Run, Ride, Walk, Hike in a native picker/menu.
- Units: Metric or Imperial in a radio group/segmented choice with an accessible group label.

Use **Save changes** only when values differ and are valid. During save, keep content visible. On success, update shell values globally and announce **“Profile updated.”** On failure, retain edits and offer retry.

### 6.3 Settings

Grouped, in this order:

1. **Preferences:** Units (Metric/Imperial). This mirrors Profile and updates the same value.
2. **Linked accounts:** Apple and Google rows only when supported on the platform/build; statuses are **Linked**, **Not linked**, or **Unavailable**. Row action is **Link** when allowed. `account_link_required` uses the flow in §5.5. Do not expose email/provider identifiers unnecessarily.
3. **About:** Privacy policy, Terms, Map attribution. Open via the OS browser or an accessible in-app web view. Map attribution remains available here in addition to required attribution on every future map.
4. **Account:** Sign out; Delete account entry when implemented. Delete account uses a final explicit destructive confirmation and does not imply immediate object deletion before server success.

## 7. Loading, error, empty, and offline states

| Context                   | Presentation                                                                               | Required action/behavior                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Cold session restore      | Centered native spinner + **“Opening Trail…”**                                             | Do not flash auth or tabs before state resolves; announce after a meaningful delay                |
| Screen load               | Keep title/navigation; show labelled inline spinner or skeleton shapes marked inaccessible | Replace with content without moving focus unexpectedly                                            |
| Button submit             | Keep label as progressive text (“Signing in…”, “Saving…”) + spinner                        | Disable repeat submission; announce busy state                                                    |
| Recoverable screen error  | Status banner with plain-language summary                                                  | **Try again**; retain prior content/form input                                                    |
| Terminal session failure  | Safe generic message, then Sign in screen                                                  | Never show token details                                                                          |
| Offline                   | Persistent top banner: **“Offline. Some changes may not sync.”**                           | Keep locally available shell content; auth/network-only actions explain they require a connection |
| Empty Phase 2 placeholder | Title + concise factual state                                                              | No fake data or unsupported CTA                                                                   |

Use `accessibilityLiveRegion="polite"` on Android and an equivalent accessibility announcement on iOS for async success/status changes. Errors that block completion use assertive announcement sparingly. Never use a toast as the only error or confirmation.

## 8. Secure sign-out draft guard

Before logout, query local recording/pending-sync state; UI must not infer it from the current screen.

- **No active or unsynced draft:** standard confirmation, **Cancel** then **Sign out**. On success clear secure credentials and return to Welcome.
- **Active recording or paused draft:** block logout. Modal title **“Recording in progress”**; body **“Finish or discard the recording before signing out. Trail won’t remove it here.”** Actions: **Stay signed in** and **Go to Record**. No destructive action exists in this guard.
- **Locally saved activity waiting to upload / needs attention:** block logout. Modal title **“Activity not uploaded”**; body explains that signing out is unavailable until the pending activity is resolved. Actions: **Stay signed in** and **Review activity**. Do not silently delete, reassign, or expose the draft to another account.
- **Logout API unavailable:** retain credentials and signed-in UI; show **“Couldn’t sign out. Try again.”** Do not present local token clearing as server logout.

This conservative Phase 2 policy satisfies the no-silent-loss requirement without defining cross-account ownership for retained drafts. Any later “sign out and keep draft” behavior requires an explicit product/security decision.

## 9. Accessibility implementation contract

### 9.1 Dynamic Type and layout

- Leave `allowFontScaling` enabled. Do not cap Phase 2 text with `maxFontSizeMultiplier`.
- Test at default and maximum platform text sizes. Forms and settings become vertically scrollable; controls expand, labels wrap, and no horizontal scrolling is required.
- Avoid fixed text/container heights. Use `KeyboardAvoidingView` plus `ScrollView`, safe-area insets, and scroll-to-focused-field behavior.
- Support portrait compact phones; tablet optimization is out of v1, but content should remain usable with a readable maximum form width of 520 dp.

### 9.2 Labels, roles, and states

| Element                          | Accessible contract                                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tab                              | Role `tab`; label “Record”, “Activity”, “Routes”, or “You”; selected state exposed; do not append the word “tab” if the platform already announces role |
| Screen title                     | Header role; first meaningful focus after navigation                                                                                                    |
| Text field                       | Visible label associated with input; required/invalid state and error exposed; helpful hint only where action is unclear                                |
| Password visibility              | Button label toggles “Show password” / “Hide password”; state announced                                                                                 |
| Submit/loading button            | Button role; disabled and busy state exposed; progressive label announced                                                                               |
| Linked-account row               | One target, e.g. “Google, Not linked, Link”; never status by icon/color alone                                                                           |
| Offline/error banner             | Summary text read before its action; live-region announcement when it appears                                                                           |
| Destructive action               | Consequence in confirmation title/body; button label names the action (“Delete account”, not “Yes”)                                                     |
| Decorative icon/spinner/skeleton | Hidden from accessibility when adjacent text provides meaning                                                                                           |

### 9.3 Focus order and restoration

- Follow visual reading order: back/title → explanatory/error content → fields → primary action → alternatives → footer links.
- On screen open, do not force focus into the first field; let the screen title be first. User-triggered validation focuses the first invalid field after announcing the summary.
- Modal focus starts on its title, remains within the modal, and returns to the invoking control on dismiss.
- After stack back, restore focus to the row/button that opened the screen. Tab changes move accessibility focus to the destination screen title, not the tab bar.
- Native provider sheets own focus while open; on cancellation return focus to the provider button.

### 9.4 Touch and input

- Every interactive target is at least **48 × 48 dp**, satisfying Android’s 48 dp recommendation and exceeding iOS’s 44 pt minimum. Maintain at least 8 dp separation when targets do not occupy distinct full-width rows.
- Do not place actions behind swipe-only gestures. Support hardware keyboard Next/Done and Android Back; visible controls remain available.
- Respect Bold Text, Increase Contrast where exposed by the platform, Reduce Motion, and screen-reader settings. Do not override user font family or text scaling.

## 10. Accessibility and design acceptance checks

Verify on a physical iOS and Android device before Phase 2 UI acceptance:

- [ ] Light/dark appearance uses semantic tokens; normal text and action content meet at least 4.5:1 contrast, focus/non-text indicators at least 3:1.
- [ ] Welcome never requests location; successful authentication lands on Record.
- [ ] Email sign-up/sign-in/reset work with autofill, keyboard navigation, retained values, safe errors, and non-enumerating reset success.
- [ ] Provider cancellation is silent; unavailable and `account_link_required` states are distinct; linking requires existing-account auth and explicit confirmation.
- [ ] Tab order and names are exactly Record, Activity, Routes, You; selected state is audible and not color-only.
- [ ] Profile supports only display name, optional avatar, default sport, and units; changing units updates shared shell state.
- [ ] VoiceOver and TalkBack read each screen in the focus order above with no duplicate, unlabeled, or unreachable controls.
- [ ] Maximum text size causes no clipped text, hidden action, overlapping tab label, or horizontal form scroll.
- [ ] Every target measures at least 48 × 48 dp; password reveal and row disclosure are single, unambiguous targets.
- [ ] Loading/busy, recoverable error, terminal session, and offline changes are announced once and remain understandable without color.
- [ ] Active and unsynced drafts block sign-out with a route to resolution; no guard offers silent deletion.
- [ ] Reduce Motion leaves navigation understandable; dark-mode status bar and keyboard appearance match the active theme.

## 11. Traceability and implementation boundary

- `AUTH-1`–`AUTH-6`: §§5, 7, 8.
- `PROF-1`–`PROF-3`: §6.
- `NAV-1`, `SET-1`, `SET-2`: §§4, 6.
- PRD §7.6 accessibility: §§2, 9, 10.
- Architecture mobile/auth/session boundaries: §§4, 7, 8.

This file specifies presentation and interaction only. Secure storage, refresh/replay, provider verification/linking, local draft queries, logout revocation, persistence, and API error mapping remain owned by the corresponding feature services; React components must not implement those rules directly.

## 12. Phase 3 Record interaction contract

**Status:** approved implementation contract; physical-device acceptance remains outstanding.

- Pre-start places the Record heading, persistent permission/error banner, sport radio group (Run, Ride, Walk, Hike), GPS icon plus text and accuracy, three-stat HUD, live map, and Start in reading order. Sport is not editable after Start.
- GPS states are Waiting, Good, Fair, Poor, and Stale. Icon, text, latest raw-fix accuracy metres, and semantic color are always combined. Fair/Poor/Stale warns without blocking recording; rejected fixes still update this status without entering the accepted route.
- The HUD labels elapsed, distance, and Current pace (run/walk/hike) or Current speed (ride), formats metric/imperial from the authenticated owner profile, and decays motion after a stale fix. Pause freezes elapsed immediately. Controls are text-labelled, at least 48 dp, and exposed with role/state.
- Map networking defaults **off**. The empty map panel explains that GPS recording still works locally and that enabling OpenFreeMap sends the device IP address plus requested tile/style area, which can approximate location, to provider infrastructure subject to OpenFreeMap/provider terms and retention practices. A clear Load map with network / Turn map network off control governs requests.
- When enabled, the map uses the OpenFreeMap Liberty style, native location puck, accepted-point polyline, and a stateful Follow control. A visible overlay links both OpenStreetMap copyright and OpenFreeMap. When the native MapLibre module is absent (including Expo Go), show “Map unavailable in this build” and explicitly say GPS recording still works; never render a fake map. Required attribution remains visible whenever map networking is enabled.
- Start first explains staged foreground/background location. Foreground denial blocks with retry/settings guidance. Background denial selects a true foreground-only watcher that suspends when Trail is not visible and explicitly says recording cannot continue locked; it never implies background capture. Android notification denial is separately warned. OEM battery guidance is informational and non-blocking.
- Recording shows Pause and Stop; Paused shows Resume and Stop. Stop requires confirmation and leads to Save locally/Discard. Save is disabled with the 30-second-or-50-metre rule stated. Discard has a second consequence confirmation.
- Relaunch with a durable recording/paused session presents Resume and Discard. Limit-triggered stops name the 12-hour or 100,000-point reason. A completed save says “Saved locally. Waiting to upload.” without claiming server upload.
- Real-device VoiceOver/TalkBack, maximum text, map attribution visibility, locked-screen recording, and permission sheets remain release evidence gates in `Phase3DeviceQA.md`; automated/static checks are not substitutes.
