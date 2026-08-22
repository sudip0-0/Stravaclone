ALTER TABLE "trail"."activity_photos" RENAME COLUMN "object_key" TO "legacy_object_key";
--> statement-breakpoint
ALTER TABLE "trail"."activity_photos" RENAME COLUMN "content_type" TO "mime";
--> statement-breakpoint
ALTER TABLE "trail"."activity_photos" RENAME COLUMN "byte_size" TO "size_bytes";
--> statement-breakpoint
ALTER TABLE "trail"."activity_photos" RENAME CONSTRAINT "activity_photos_object_key_unique" TO "activity_photos_legacy_object_key_unique";
--> statement-breakpoint
ALTER TABLE "trail"."activity_photos" DROP CONSTRAINT "activity_photos_object_key_owner_check";
--> statement-breakpoint
ALTER TABLE "trail"."activity_photos" ALTER COLUMN "legacy_object_key" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "trail"."activity_photos" ADD COLUMN "staging_object_key" text;
--> statement-breakpoint
ALTER TABLE "trail"."activity_photos" ADD COLUMN "normalized_object_key" text;
--> statement-breakpoint
ALTER TABLE "trail"."activity_photos" ADD COLUMN "input_mime" text;
--> statement-breakpoint
ALTER TABLE "trail"."activity_photos" ADD COLUMN "input_size_bytes" integer;
--> statement-breakpoint
ALTER TABLE "trail"."activity_photos" ADD COLUMN "error_code" text;
--> statement-breakpoint
ALTER TABLE "trail"."activity_photos" ADD COLUMN "upload_attempt_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "trail"."activity_photos" ADD COLUMN "processing_attempt_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "trail"."activity_photos" ADD COLUMN "next_processing_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "trail"."activity_photos" ADD COLUMN "processing_lease_token" uuid;
--> statement-breakpoint
ALTER TABLE "trail"."activity_photos" ADD COLUMN "processing_lease_expires_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "trail"."activity_photos" SET
  "input_mime" = "mime",
  "input_size_bytes" = "size_bytes",
  "status" = 'failed',
  "error_code" = 'legacy_reupload_required',
  "mime" = NULL,
  "size_bytes" = NULL,
  "width" = NULL,
  "height" = NULL;
--> statement-breakpoint
ALTER TABLE "trail"."activity_photos" DROP CONSTRAINT "activity_photos_status_check";
--> statement-breakpoint
ALTER TABLE "trail"."activity_photos" DROP CONSTRAINT "activity_photos_content_type_check";
--> statement-breakpoint
ALTER TABLE "trail"."activity_photos" DROP CONSTRAINT "activity_photos_byte_size_check";
--> statement-breakpoint
ALTER TABLE "trail"."activity_photos" ADD CONSTRAINT "activity_photos_staging_object_key_unique" UNIQUE("staging_object_key");
--> statement-breakpoint
ALTER TABLE "trail"."activity_photos" ADD CONSTRAINT "activity_photos_normalized_object_key_unique" UNIQUE("normalized_object_key");
--> statement-breakpoint
ALTER TABLE "trail"."activity_photos" ADD CONSTRAINT "activity_photos_legacy_key_owner_check" CHECK ("legacy_object_key" is null or (length("legacy_object_key") <= 1024 and "legacy_object_key" = 'users/' || "user_id"::text || '/activities/' || "activity_id"::text || '/photos/' || "id"::text));
--> statement-breakpoint
ALTER TABLE "trail"."activity_photos" ADD CONSTRAINT "activity_photos_staging_key_owner_check" CHECK ("staging_object_key" is null or (length("staging_object_key") <= 1024 and "staging_object_key" = 'users/' || "user_id"::text || '/activities/' || "activity_id"::text || '/photos/' || "id"::text || '/staging'));
--> statement-breakpoint
ALTER TABLE "trail"."activity_photos" ADD CONSTRAINT "activity_photos_normalized_key_owner_check" CHECK ("normalized_object_key" is null or (length("normalized_object_key") <= 1024 and "normalized_object_key" = 'users/' || "user_id"::text || '/activities/' || "activity_id"::text || '/photos/' || "id"::text || '/normalized'));
--> statement-breakpoint
ALTER TABLE "trail"."activity_photos" ADD CONSTRAINT "activity_photos_object_key_shape_check" CHECK (("legacy_object_key" is not null and "staging_object_key" is null and "normalized_object_key" is null and "status" = 'failed') or ("legacy_object_key" is null and "staging_object_key" is not null and "normalized_object_key" is not null));
--> statement-breakpoint
ALTER TABLE "trail"."activity_photos" ADD CONSTRAINT "activity_photos_status_check" CHECK ("status" in ('pending', 'processing', 'ready', 'failed'));
--> statement-breakpoint
ALTER TABLE "trail"."activity_photos" ADD CONSTRAINT "activity_photos_mime_check" CHECK ("mime" is null or "mime" in ('image/jpeg', 'image/webp'));
--> statement-breakpoint
ALTER TABLE "trail"."activity_photos" ADD CONSTRAINT "activity_photos_size_bytes_check" CHECK ("size_bytes" is null or ("size_bytes" > 0 and "size_bytes" <= 8388608));
--> statement-breakpoint
ALTER TABLE "trail"."activity_photos" ADD CONSTRAINT "activity_photos_input_mime_check" CHECK ("input_mime" is null or "input_mime" in ('image/jpeg', 'image/heic', 'image/webp'));
--> statement-breakpoint
ALTER TABLE "trail"."activity_photos" ADD CONSTRAINT "activity_photos_input_size_check" CHECK ("input_size_bytes" is null or ("input_size_bytes" > 0 and "input_size_bytes" <= 10485760));
--> statement-breakpoint
ALTER TABLE "trail"."activity_photos" ADD CONSTRAINT "activity_photos_error_code_check" CHECK ("error_code" is null or (length("error_code") between 1 and 64 and "error_code" ~ '^[a-z0-9_]+$'));
--> statement-breakpoint
ALTER TABLE "trail"."activity_photos" ADD CONSTRAINT "activity_photos_upload_attempt_count_check" CHECK ("upload_attempt_count" between 0 and 5);
--> statement-breakpoint
ALTER TABLE "trail"."activity_photos" ADD CONSTRAINT "activity_photos_attempt_count_check" CHECK ("processing_attempt_count" between 0 and 5);
--> statement-breakpoint
ALTER TABLE "trail"."activity_photos" ADD CONSTRAINT "activity_photos_processing_lease_check" CHECK (("processing_lease_token" is null) = ("processing_lease_expires_at" is null) and ("processing_lease_token" is null or "status" = 'processing'));
--> statement-breakpoint
CREATE INDEX "activity_photos_processing_idx" ON "trail"."activity_photos" ("next_processing_at") WHERE "status" = 'processing';
--> statement-breakpoint
ALTER TABLE "trail"."object_deletion_outbox" ADD COLUMN "lease_token" uuid;
--> statement-breakpoint
ALTER TABLE "trail"."object_deletion_outbox" ADD COLUMN "lease_expires_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "trail"."object_deletion_outbox" SET "attempt_count" = least(10, greatest(0, "attempt_count"));
--> statement-breakpoint
ALTER TABLE "trail"."object_deletion_outbox" DROP CONSTRAINT "object_deletion_outbox_source_photo_unique";
--> statement-breakpoint
ALTER TABLE "trail"."object_deletion_outbox" DROP CONSTRAINT "object_deletion_outbox_object_key_owner_check";
--> statement-breakpoint
ALTER TABLE "trail"."object_deletion_outbox" DROP CONSTRAINT "object_deletion_outbox_status_check";
--> statement-breakpoint
ALTER TABLE "trail"."object_deletion_outbox" DROP CONSTRAINT "object_deletion_outbox_attempt_count_check";
--> statement-breakpoint
ALTER TABLE "trail"."object_deletion_outbox" ADD CONSTRAINT "object_deletion_outbox_object_key_owner_check" CHECK (length("object_key") <= 1024 and "object_key" in ('users/' || "owner_user_id"::text || '/activities/' || "source_activity_id"::text || '/photos/' || "source_photo_id"::text, 'users/' || "owner_user_id"::text || '/activities/' || "source_activity_id"::text || '/photos/' || "source_photo_id"::text || '/staging', 'users/' || "owner_user_id"::text || '/activities/' || "source_activity_id"::text || '/photos/' || "source_photo_id"::text || '/normalized'));
--> statement-breakpoint
ALTER TABLE "trail"."object_deletion_outbox" ADD CONSTRAINT "object_deletion_outbox_status_check" CHECK ("status" in ('pending', 'retry', 'completed', 'failed'));
--> statement-breakpoint
ALTER TABLE "trail"."object_deletion_outbox" ADD CONSTRAINT "object_deletion_outbox_attempt_count_check" CHECK ("attempt_count" between 0 and 10);
--> statement-breakpoint
ALTER TABLE "trail"."object_deletion_outbox" ADD CONSTRAINT "object_deletion_outbox_lease_check" CHECK (("lease_token" is null) = ("lease_expires_at" is null) and ("lease_token" is null or "status" in ('pending', 'retry')));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION trail.enqueue_photo_object_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO trail.object_deletion_outbox (owner_user_id, source_activity_id, source_photo_id, object_key, next_attempt_at)
  SELECT OLD.user_id, OLD.activity_id, OLD.id, object.value, object.next_attempt_at
  FROM (VALUES
    (OLD.legacy_object_key, now()),
    (OLD.staging_object_key, GREATEST(now(), OLD.created_at + interval '15 minutes')),
    (OLD.normalized_object_key, now())
  ) AS object(value, next_attempt_at)
  WHERE object.value is not null
  ON CONFLICT (object_key) DO UPDATE SET
    status='pending',
    attempt_count=0,
    next_attempt_at=CASE WHEN excluded.object_key LIKE '%/staging' THEN greatest(trail.object_deletion_outbox.next_attempt_at,excluded.next_attempt_at) ELSE excluded.next_attempt_at END,
    completed_at=NULL,
    last_error_code=NULL,
    lease_token=NULL,
    lease_expires_at=NULL,
    updated_at=now();
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION trail.enqueue_activity_object_deletions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO trail.object_deletion_outbox (owner_user_id, source_activity_id, source_photo_id, object_key, next_attempt_at)
  SELECT OLD.user_id, OLD.id, photo.id, object.value, object.next_attempt_at
  FROM trail.activity_photos photo
  CROSS JOIN LATERAL (VALUES
    (photo.legacy_object_key, now()),
    (photo.staging_object_key, GREATEST(now(), photo.created_at + interval '15 minutes')),
    (photo.normalized_object_key, now())
  ) AS object(value, next_attempt_at)
  WHERE photo.activity_id = OLD.id AND photo.user_id = OLD.user_id AND object.value is not null
  ON CONFLICT (object_key) DO UPDATE SET
    status='pending',
    attempt_count=0,
    next_attempt_at=CASE WHEN excluded.object_key LIKE '%/staging' THEN greatest(trail.object_deletion_outbox.next_attempt_at,excluded.next_attempt_at) ELSE excluded.next_attempt_at END,
    completed_at=NULL,
    last_error_code=NULL,
    lease_token=NULL,
    lease_expires_at=NULL,
    updated_at=now();
  RETURN OLD;
END;
$$;
