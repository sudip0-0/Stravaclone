# Phase 5 Device and R2 QA

Phase 5 automated coverage does not replace these release gates. Keep every item unchecked until observed on the named physical device/provider account; simulator, local MinIO, and mocked permission results are not sufficient evidence.

## iOS physical device

- [ ] On a supported iPhone, open an already-synced activity and tap **Add photos**. Confirm the photo-library permission appears only after the tap and uses the configured privacy text.
- [ ] Deny permission. Confirm the activity remains usable, no photo row is queued, and Settings recovery guidance is understandable.
- [ ] Grant limited-library access and select three JPEG/HEIC/WebP photos. Include one rotated HEIC and one photo with GPS EXIF. Confirm all three show independent waiting/uploading/processing/ready states and correct visual orientation.
- [ ] Put the app in the background during upload, return it to foreground, and confirm retry resumes without duplicating the activity or photo.
- [ ] Remove connectivity after one of three uploads succeeds. Confirm partial success remains visible and only failed items offer retry.
- [ ] Confirm displayed/downloaded normalized objects contain no EXIF GPS, capture timestamp, device, artist, or orientation fields.
- [ ] Confirm the eleventh selection is unavailable, a file over 10 MiB is skipped, and the activity can still be viewed/edited.
- [ ] Confirm photo deletion requires confirmation, disappears from the gallery, and is later absent from object storage.
- [ ] Sign out or switch accounts with pending photos. Confirm the next account cannot see or continue the prior owner's queue.

Device/build/date/evidence: **Not run — physical iOS device required.**

## Android physical device

- [ ] Repeat the iOS scenarios on a supported API 26+ Android phone, including deny, limited/selected-photo access where supported, process death, foreground retry, and account switching.
- [ ] Verify each picker asset is immediately copied to the owner/photo app-private document directory, remains readable through background/foreground and process restart, and is removed after ready/delete/cancel/account purge.
- [ ] Verify TalkBack announces photo status changes and all add/retry/remove controls have clear labels and 48 dp targets.

Device/build/date/evidence: **Not run — physical Android device required.**

## Cloudflare R2 compatibility and security

- [ ] Create a private beta bucket and least-privilege API credential restricted to that bucket's object read/write/delete operations.
- [ ] Configure allowed mobile origins/methods/headers for signed PUT/GET only; do not make the bucket or custom domain public.
- [ ] Run initiate, direct PUT, completion, normalized download, photo delete, activity delete, and account delete against R2.
- [ ] Verify anonymous bucket listing and anonymous object reads fail.
- [ ] Verify exact-key/MIME/1-byte-to-10-MiB presigned POST and signed download work before expiry and fail after 15 minutes; wrong MIME and 11 MiB must be rejected by R2 before completion.
- [ ] Verify a credential cannot access an unrelated bucket and that the API provider exposes no list operation.
- [ ] Compare HEAD metadata, content type, URL encoding, retry behavior, and idempotent missing-object deletion with local MinIO.
- [ ] Review R2 retention, lifecycle, egress, free-tier, CORS, and incident-revocation settings before beta approval.

Account/date/evidence: **Not run — Cloudflare R2 account and credentials required.**

## HEIC legal gate

- [ ] Counsel approves LGPL-3.0 source/relinking distribution and applicable HEVC patent obligations for every release territory/store, with packaging evidence matching `THIRD_PARTY_NOTICES.md`.
- [ ] If approval is denied or incomplete, remove HEIC from the shared contract, mobile picker acceptance, API detector, decoder dependency, and release claims before shipping.

Evidence: **Not approved — HEIC is technically tested but release-blocked.**
