ALTER TABLE "trail"."activities" ADD COLUMN "ingest_hash" text;
--> statement-breakpoint
ALTER TABLE "trail"."activities" ADD COLUMN "polylines" jsonb;
--> statement-breakpoint
UPDATE "trail"."activities" SET "polylines" = jsonb_build_array("polyline") WHERE "polylines" IS NULL;
--> statement-breakpoint
ALTER TABLE "trail"."activities" ALTER COLUMN "polylines" SET NOT NULL;
--> statement-breakpoint
UPDATE "trail"."activities" SET "ingest_hash" = md5("id"::text || ':' || "user_id"::text) || md5("user_id"::text || ':' || "id"::text) WHERE "ingest_hash" IS NULL;
--> statement-breakpoint
ALTER TABLE "trail"."activities" ALTER COLUMN "ingest_hash" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "trail"."activities" ADD CONSTRAINT "activities_ingest_hash_check" CHECK ("trail"."activities"."ingest_hash" ~ '^[0-9a-f]{64}$');
--> statement-breakpoint
CREATE TABLE "trail"."activity_pauses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "activity_id" uuid NOT NULL,
  "seq" integer NOT NULL,
  "started_at" timestamp with time zone NOT NULL,
  "ended_at" timestamp with time zone NOT NULL,
  CONSTRAINT "activity_pauses_activity_seq_unique" UNIQUE("activity_id","seq"),
  CONSTRAINT "activity_pauses_seq_check" CHECK ("trail"."activity_pauses"."seq" >= 0),
  CONSTRAINT "activity_pauses_time_check" CHECK ("trail"."activity_pauses"."ended_at" > "trail"."activity_pauses"."started_at")
);
--> statement-breakpoint
ALTER TABLE "trail"."activity_pauses" ADD CONSTRAINT "activity_pauses_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "trail"."activities"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "activity_pauses_activity_id_idx" ON "trail"."activity_pauses" ("activity_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION trail.enqueue_activity_object_deletions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO trail.object_deletion_outbox (owner_user_id, source_activity_id, source_photo_id, object_key)
  SELECT OLD.user_id, OLD.id, photo.id, photo.object_key
  FROM trail.activity_photos photo
  WHERE photo.activity_id = OLD.id AND photo.user_id = OLD.user_id
  ON CONFLICT (source_photo_id) DO NOTHING;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER activities_object_deletion_outbox_before_delete
BEFORE DELETE ON trail.activities
FOR EACH ROW EXECUTE FUNCTION trail.enqueue_activity_object_deletions();
