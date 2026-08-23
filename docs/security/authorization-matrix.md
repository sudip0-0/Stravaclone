# API authorization matrix

Verified against `apps/api/src/**/routes.ts` and ownership predicates in the corresponding services on 2026-08-23. `docs/security/authorization-matrix.json` is the canonical route inventory; the detailed YAML below records ownership controls. `opaque_not_found` means another owner receives the same 404 as a nonexistent resource. Collection and aggregate operations derive `user_id` only from the verified access-token principal.

<!-- GENERATED AUTHORIZATION ROUTES: START -->

## Registered route index (generated)

Source: `docs/security/authorization-matrix.json`. Regenerate with `node scripts/security/generate-authorization-docs.mjs`.

| Operation                     | Method   | Registered path                                         | Principal       |
| ----------------------------- | -------- | ------------------------------------------------------- | --------------- |
| `auth.register`               | `POST`   | `/v1/auth/register`                                     | `anonymous`     |
| `auth.register_confirm`       | `POST`   | `/v1/auth/register/confirm`                             | `anonymous`     |
| `auth.login`                  | `POST`   | `/v1/auth/login`                                        | `anonymous`     |
| `auth.refresh`                | `POST`   | `/v1/auth/refresh`                                      | `refresh_token` |
| `auth.logout`                 | `POST`   | `/v1/auth/logout`                                       | `refresh_token` |
| `auth.password_reset_request` | `POST`   | `/v1/auth/password-reset/request`                       | `anonymous`     |
| `auth.password_reset_confirm` | `POST`   | `/v1/auth/password-reset/confirm`                       | `reset_token`   |
| `user.read`                   | `GET`    | `/v1/me`                                                | `access_token`  |
| `user.update`                 | `PATCH`  | `/v1/me`                                                | `access_token`  |
| `user.delete`                 | `DELETE` | `/v1/me`                                                | `access_token`  |
| `activity.create`             | `POST`   | `/v1/activities`                                        | `access_token`  |
| `activity.list`               | `GET`    | `/v1/activities`                                        | `access_token`  |
| `activity.read`               | `GET`    | `/v1/activities/:id`                                    | `access_token`  |
| `activity.update`             | `PATCH`  | `/v1/activities/:id`                                    | `access_token`  |
| `activity.delete`             | `DELETE` | `/v1/activities/:id`                                    | `access_token`  |
| `photo.initiate`              | `POST`   | `/v1/activities/:activity_id/photos/initiate`           | `access_token`  |
| `photo.reissue`               | `POST`   | `/v1/activities/:activity_id/photos/:photo_id/reissue`  | `access_token`  |
| `photo.complete`              | `POST`   | `/v1/activities/:activity_id/photos/:photo_id/complete` | `access_token`  |
| `photo.list`                  | `GET`    | `/v1/activities/:activity_id/photos`                    | `access_token`  |
| `photo.download`              | `GET`    | `/v1/activities/:activity_id/photos/:photo_id/download` | `access_token`  |
| `photo.delete`                | `DELETE` | `/v1/activities/:activity_id/photos/:photo_id`          | `access_token`  |
| `route.create`                | `POST`   | `/v1/routes`                                            | `access_token`  |
| `route.list`                  | `GET`    | `/v1/routes`                                            | `access_token`  |
| `route.read`                  | `GET`    | `/v1/routes/:id`                                        | `access_token`  |
| `route.update`                | `PATCH`  | `/v1/routes/:id`                                        | `access_token`  |
| `route.delete`                | `DELETE` | `/v1/routes/:id`                                        | `access_token`  |
| `stats.read`                  | `GET`    | `/v1/stats`                                             | `access_token`  |
| `calendar.read`               | `GET`    | `/v1/calendar`                                          | `access_token`  |
| `calendar.day_read`           | `GET`    | `/v1/calendar/day`                                      | `access_token`  |

<!-- GENERATED AUTHORIZATION ROUTES: END -->

```yaml
schema_version: 1
base_path: /v1
defaults:
  transport: bearer_access_token
  access_token_ttl_minutes: 15
  cross_owner_resource_result: opaque_not_found
operations:
  - {
      id: auth.register,
      method: POST,
      path: /auth/register,
      principal: anonymous,
      owner_scope: none,
      controls: [ip_rate_limit, email_rate_limit, strict_body],
    }
  - {
      id: auth.register_confirm,
      method: POST,
      path: /auth/register/confirm,
      principal: anonymous,
      owner_scope: token_subject,
      controls: [ip_rate_limit, token_rate_limit, one_time_token],
    }
  - {
      id: auth.login,
      method: POST,
      path: /auth/login,
      principal: anonymous,
      owner_scope: credential_subject,
      controls: [ip_rate_limit, email_rate_limit, argon_queue_bound],
    }
  - {
      id: auth.refresh,
      method: POST,
      path: /auth/refresh,
      principal: refresh_token,
      owner_scope: token_family,
      controls:
        [ip_rate_limit, token_rate_limit, rotation, reuse_revokes_family],
    }
  - {
      id: auth.logout,
      method: POST,
      path: /auth/logout,
      principal: refresh_token,
      owner_scope: token_family,
      controls: [ip_rate_limit, token_rate_limit, family_revoke],
    }
  - {
      id: auth.password_reset_request,
      method: POST,
      path: /auth/password-reset/request,
      principal: anonymous,
      owner_scope: normalized_email,
      controls: [ip_rate_limit, email_rate_limit, enumeration_resistant],
    }
  - {
      id: auth.password_reset_confirm,
      method: POST,
      path: /auth/password-reset/confirm,
      principal: reset_token,
      owner_scope: token_subject,
      controls: [ip_rate_limit, token_rate_limit, one_time_token],
    }
  - {
      id: user.read,
      method: GET,
      path: /me,
      principal: access_token,
      owner_scope: principal_user_id,
      cross_owner: impossible_no_user_parameter,
    }
  - {
      id: user.update,
      method: PATCH,
      path: /me,
      principal: access_token,
      owner_scope: principal_user_id,
      cross_owner: impossible_no_user_parameter,
    }
  - {
      id: user.delete,
      method: DELETE,
      path: /me,
      principal: access_token,
      owner_scope: principal_user_id,
      controls:
        [password_step_up, ip_rate_limit, user_rate_limit, cascade_cleanup],
    }
  - {
      id: activity.create,
      method: POST,
      path: /activities,
      principal: access_token,
      owner_scope: principal_user_id,
      controls:
        [
          client_uuid_idempotency,
          route_owner_check,
          point_limit,
          owner_concurrency_limit,
        ],
    }
  - {
      id: activity.list,
      method: GET,
      path: /activities,
      principal: access_token,
      owner_scope: principal_user_id,
      cross_owner: empty_collection,
    }
  - {
      id: activity.read,
      method: GET,
      path: '/activities/:id',
      principal: access_token,
      owner_scope: principal_user_id,
      cross_owner: opaque_not_found,
    }
  - {
      id: activity.update,
      method: PATCH,
      path: '/activities/:id',
      principal: access_token,
      owner_scope: principal_user_id,
      cross_owner: opaque_not_found,
    }
  - {
      id: activity.delete,
      method: DELETE,
      path: '/activities/:id',
      principal: access_token,
      owner_scope: principal_user_id,
      cross_owner: opaque_not_found,
      controls: [explicit_confirmation, object_deletion_outbox],
    }
  - {
      id: photo.initiate,
      method: POST,
      path: '/activities/:activity_id/photos/initiate',
      principal: access_token,
      owner_scope: principal_user_id_and_activity,
      cross_owner: opaque_not_found,
      signed_object_operation: presign_post,
      controls:
        [
          private_owner_key,
          exact_size_policy,
          mime_policy,
          15_minute_expiry,
          10_photo_atomic_limit,
        ],
    }
  - {
      id: photo.reissue,
      method: POST,
      path: '/activities/:activity_id/photos/:photo_id/reissue',
      principal: access_token,
      owner_scope: principal_user_id_activity_photo,
      cross_owner: opaque_not_found,
      signed_object_operation: presign_post,
      controls: [same_reservation, attempt_limit, 15_minute_expiry],
    }
  - {
      id: photo.complete,
      method: POST,
      path: '/activities/:activity_id/photos/:photo_id/complete',
      principal: access_token,
      owner_scope: principal_user_id_activity_photo,
      cross_owner: opaque_not_found,
      signed_object_operation: consume_staged_upload,
      controls: [head_size_mime_check, byte_signature_check, metadata_strip],
    }
  - {
      id: photo.list,
      method: GET,
      path: '/activities/:activity_id/photos',
      principal: access_token,
      owner_scope: principal_user_id_and_activity,
      cross_owner: opaque_not_found,
      signed_object_operation: presign_get_ready_items,
    }
  - {
      id: photo.download,
      method: GET,
      path: '/activities/:activity_id/photos/:photo_id/download',
      principal: access_token,
      owner_scope: principal_user_id_activity_photo,
      cross_owner: opaque_not_found,
      signed_object_operation: presign_get,
      controls: [15_minute_expiry, ready_only],
    }
  - {
      id: photo.delete,
      method: DELETE,
      path: '/activities/:activity_id/photos/:photo_id',
      principal: access_token,
      owner_scope: principal_user_id_activity_photo,
      cross_owner: opaque_not_found,
      controls: [idempotent_outbox_cleanup],
    }
  - {
      id: route.create,
      method: POST,
      path: /routes,
      principal: access_token,
      owner_scope: principal_user_id,
      controls: [client_uuid_idempotency, server_recompute, no_demo_router],
    }
  - {
      id: route.list,
      method: GET,
      path: /routes,
      principal: access_token,
      owner_scope: principal_user_id,
      cross_owner: empty_collection,
    }
  - {
      id: route.read,
      method: GET,
      path: '/routes/:id',
      principal: access_token,
      owner_scope: principal_user_id,
      cross_owner: opaque_not_found,
    }
  - {
      id: route.update,
      method: PATCH,
      path: '/routes/:id',
      principal: access_token,
      owner_scope: principal_user_id,
      cross_owner: opaque_not_found,
    }
  - {
      id: route.delete,
      method: DELETE,
      path: '/routes/:id',
      principal: access_token,
      owner_scope: principal_user_id,
      cross_owner: opaque_not_found,
    }
  - {
      id: stats.read,
      method: GET,
      path: /stats,
      principal: access_token,
      owner_scope: principal_user_id,
      cross_owner: zero_aggregate,
      controls: [bounded_week_or_year],
    }
  - {
      id: calendar.read,
      method: GET,
      path: /calendar,
      principal: access_token,
      owner_scope: principal_user_id,
      cross_owner: empty_collection,
      controls: [bounded_month],
    }
  - {
      id: calendar.day_read,
      method: GET,
      path: /calendar/day,
      principal: access_token,
      owner_scope: principal_user_id,
      cross_owner: empty_collection,
      controls: [bounded_day],
    }
```

## Verification evidence

- Cross-owner activity CRUD/list: `apps/api/test/activities.integration.test.ts`.
- Cross-owner route CRUD/list and activity route reference: `apps/api/test/routes.integration.test.ts`.
- Cross-owner photo initiate/reissue/complete/list/download/delete: `apps/api/test/photos.integration.test.ts`.
- Cross-owner stats/calendar/day: `apps/api/test/stats.integration.test.ts`.
- Authentication rotation/reuse, profile ownership, account deletion and rate limits: `apps/api/test/auth.integration.test.ts`.
- Signed object keys are constrained to `users/{owner}/activities/{activity}/photos/{photo}/{variant}` in `0004_phase5_photos.sql`; the bucket is not directly public through this API.

## Limitations

- Rate-limit state is process-local. It bounds local abuse but is not a global quota across horizontally scaled instances; an external gateway/shared limiter is a beta deployment requirement.
- PostgreSQL row-level security is not enabled. Isolation is enforced by API service predicates and tested with two owners; database credentials therefore remain a high-value secret.
- Signed URLs are capabilities until their 15-minute expiry. Deletion queues staging cleanup no earlier than the upload capability expiry to avoid key reuse races.
