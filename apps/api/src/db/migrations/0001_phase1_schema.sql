-- Additive Phase 1 schema after the committed Phase 0 foundation.
CREATE SCHEMA IF NOT EXISTS "trail";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "trail"."valid_route_waypoints"(waypoints jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
DECLARE
	waypoint jsonb;
	latitude numeric;
	longitude numeric;
BEGIN
	IF jsonb_typeof(waypoints) <> 'array'
		OR jsonb_array_length(waypoints) NOT BETWEEN 2 AND 1000 THEN
		RETURN false;
	END IF;

	FOR waypoint IN SELECT value FROM jsonb_array_elements(waypoints)
	LOOP
		IF jsonb_typeof(waypoint) <> 'object'
			OR NOT (waypoint ? 'latitude' AND waypoint ? 'longitude')
			OR waypoint - 'latitude' - 'longitude' <> '{}'::jsonb
			OR jsonb_typeof(waypoint -> 'latitude') <> 'number'
			OR jsonb_typeof(waypoint -> 'longitude') <> 'number' THEN
			RETURN false;
		END IF;
		latitude := (waypoint ->> 'latitude')::numeric;
		longitude := (waypoint ->> 'longitude')::numeric;
		IF latitude NOT BETWEEN -90 AND 90 OR longitude NOT BETWEEN -180 AND 180 THEN
			RETURN false;
		END IF;
	END LOOP;
	RETURN true;
EXCEPTION WHEN numeric_value_out_of_range OR invalid_text_representation THEN
	RETURN false;
END;
$$;
--> statement-breakpoint
CREATE TABLE "trail"."activities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"route_id" uuid,
	"sport" text NOT NULL,
	"title" text,
	"notes" text,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"distance_m" double precision NOT NULL,
	"moving_time_s" integer NOT NULL,
	"elapsed_time_s" integer NOT NULL,
	"elevation_gain_m" double precision NOT NULL,
	"elevation_loss_m" double precision NOT NULL,
	"polyline" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activities_id_user_id_unique" UNIQUE("id","user_id"),
	CONSTRAINT "activities_sport_check" CHECK ("trail"."activities"."sport" in ('run', 'ride', 'walk', 'hike')),
	CONSTRAINT "activities_title_length_check" CHECK ("trail"."activities"."title" is null or length(trim("trail"."activities"."title")) between 1 and 200),
	CONSTRAINT "activities_notes_length_check" CHECK ("trail"."activities"."notes" is null or length("trail"."activities"."notes") <= 10000),
	CONSTRAINT "activities_time_bounds_check" CHECK ("trail"."activities"."ended_at" > "trail"."activities"."started_at" and "trail"."activities"."ended_at" - "trail"."activities"."started_at" <= interval '12 hours'),
	CONSTRAINT "activities_distance_check" CHECK ("trail"."activities"."distance_m" >= 0 and "trail"."activities"."distance_m" not in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)),
	CONSTRAINT "activities_elapsed_time_check" CHECK ("trail"."activities"."elapsed_time_s" >= 0 and "trail"."activities"."elapsed_time_s" <= 43200),
	CONSTRAINT "activities_moving_time_check" CHECK ("trail"."activities"."moving_time_s" >= 0 and "trail"."activities"."moving_time_s" <= "trail"."activities"."elapsed_time_s"),
	CONSTRAINT "activities_elevation_gain_check" CHECK ("trail"."activities"."elevation_gain_m" >= 0 and "trail"."activities"."elevation_gain_m" not in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)),
	CONSTRAINT "activities_elevation_loss_check" CHECK ("trail"."activities"."elevation_loss_m" >= 0 and "trail"."activities"."elevation_loss_m" not in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)),
	CONSTRAINT "activities_polyline_length_check" CHECK (length("trail"."activities"."polyline") between 1 and 1000000),
	CONSTRAINT "activities_updated_at_check" CHECK ("trail"."activities"."updated_at" >= "trail"."activities"."created_at")
);
--> statement-breakpoint
CREATE TABLE "trail"."activity_elevation_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"distance_m" double precision NOT NULL,
	"elapsed_time_s" double precision NOT NULL,
	"elevation_m" double precision NOT NULL,
	"source" text DEFAULT 'gps_smoothed' NOT NULL,
	CONSTRAINT "activity_elevation_activity_seq_unique" UNIQUE("activity_id","seq"),
	CONSTRAINT "activity_elevation_seq_check" CHECK ("trail"."activity_elevation_samples"."seq" >= 0),
	CONSTRAINT "activity_elevation_distance_check" CHECK ("trail"."activity_elevation_samples"."distance_m" >= 0 and "trail"."activity_elevation_samples"."distance_m" not in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)),
	CONSTRAINT "activity_elevation_time_check" CHECK ("trail"."activity_elevation_samples"."elapsed_time_s" >= 0 and "trail"."activity_elevation_samples"."elapsed_time_s" not in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)),
	CONSTRAINT "activity_elevation_value_check" CHECK ("trail"."activity_elevation_samples"."elevation_m" not in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)),
	CONSTRAINT "activity_elevation_source_check" CHECK ("trail"."activity_elevation_samples"."source" in ('gps_smoothed', 'dem'))
);
--> statement-breakpoint
CREATE TABLE "trail"."activity_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"content_type" text,
	"byte_size" integer,
	"width" integer,
	"height" integer,
	"latitude" double precision,
	"longitude" double precision,
	"captured_at" timestamp with time zone,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_photos_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "activity_photos_activity_sort_unique" UNIQUE("activity_id","sort_order"),
	CONSTRAINT "activity_photos_object_key_owner_check" CHECK (length("trail"."activity_photos"."object_key") <= 1024 and "trail"."activity_photos"."object_key" = 'users/' || "trail"."activity_photos"."user_id"::text || '/activities/' || "trail"."activity_photos"."activity_id"::text || '/photos/' || "trail"."activity_photos"."id"::text),
	CONSTRAINT "activity_photos_status_check" CHECK ("trail"."activity_photos"."status" in ('pending', 'uploading', 'ready', 'failed')),
	CONSTRAINT "activity_photos_content_type_check" CHECK ("trail"."activity_photos"."content_type" is null or "trail"."activity_photos"."content_type" in ('image/jpeg', 'image/heic', 'image/webp')),
	CONSTRAINT "activity_photos_byte_size_check" CHECK ("trail"."activity_photos"."byte_size" is null or ("trail"."activity_photos"."byte_size" > 0 and "trail"."activity_photos"."byte_size" <= 10485760)),
	CONSTRAINT "activity_photos_dimensions_check" CHECK (("trail"."activity_photos"."width" is null) = ("trail"."activity_photos"."height" is null) and ("trail"."activity_photos"."width" is null or ("trail"."activity_photos"."width" > 0 and "trail"."activity_photos"."height" > 0))),
	CONSTRAINT "activity_photos_location_check" CHECK (("trail"."activity_photos"."latitude" is null) = ("trail"."activity_photos"."longitude" is null) and ("trail"."activity_photos"."latitude" is null or ("trail"."activity_photos"."latitude" between -90 and 90 and "trail"."activity_photos"."longitude" between -180 and 180 and "trail"."activity_photos"."latitude" not in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision) and "trail"."activity_photos"."longitude" not in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)))),
	CONSTRAINT "activity_photos_sort_order_check" CHECK ("trail"."activity_photos"."sort_order" >= 0 and "trail"."activity_photos"."sort_order" < 10),
	CONSTRAINT "activity_photos_updated_at_check" CHECK ("trail"."activity_photos"."updated_at" >= "trail"."activity_photos"."created_at")
);
--> statement-breakpoint
CREATE TABLE "trail"."activity_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"elevation_m" double precision,
	"recorded_at" timestamp with time zone NOT NULL,
	"accuracy_m" double precision,
	CONSTRAINT "activity_points_activity_seq_unique" UNIQUE("activity_id","seq"),
	CONSTRAINT "activity_points_seq_check" CHECK ("trail"."activity_points"."seq" >= 0),
	CONSTRAINT "activity_points_latitude_check" CHECK ("trail"."activity_points"."latitude" between -90 and 90 and "trail"."activity_points"."latitude" not in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)),
	CONSTRAINT "activity_points_longitude_check" CHECK ("trail"."activity_points"."longitude" between -180 and 180 and "trail"."activity_points"."longitude" not in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)),
	CONSTRAINT "activity_points_elevation_check" CHECK ("trail"."activity_points"."elevation_m" is null or "trail"."activity_points"."elevation_m" not in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)),
	CONSTRAINT "activity_points_accuracy_check" CHECK ("trail"."activity_points"."accuracy_m" is null or ("trail"."activity_points"."accuracy_m" >= 0 and "trail"."activity_points"."accuracy_m" not in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)))
);
--> statement-breakpoint
CREATE TABLE "trail"."activity_splits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL,
	"unit_system" text NOT NULL,
	"split_index" integer NOT NULL,
	"boundary_distance_m" double precision NOT NULL,
	"distance_m" double precision NOT NULL,
	"duration_s" double precision NOT NULL,
	CONSTRAINT "activity_splits_activity_unit_index_unique" UNIQUE("activity_id","unit_system","split_index"),
	CONSTRAINT "activity_splits_unit_system_check" CHECK ("trail"."activity_splits"."unit_system" in ('metric', 'imperial')),
	CONSTRAINT "activity_splits_index_check" CHECK ("trail"."activity_splits"."split_index" >= 1),
	CONSTRAINT "activity_splits_boundary_check" CHECK ("trail"."activity_splits"."boundary_distance_m" > 0 and "trail"."activity_splits"."boundary_distance_m" not in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)),
	CONSTRAINT "activity_splits_distance_check" CHECK ("trail"."activity_splits"."distance_m" > 0 and "trail"."activity_splits"."distance_m" not in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)),
	CONSTRAINT "activity_splits_duration_check" CHECK ("trail"."activity_splits"."duration_s" >= 0 and "trail"."activity_splits"."duration_s" not in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision))
);
--> statement-breakpoint
CREATE TABLE "trail"."auth_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_subject" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_identities_provider_subject_unique" UNIQUE("provider","provider_subject"),
	CONSTRAINT "auth_identities_user_provider_unique" UNIQUE("user_id","provider"),
	CONSTRAINT "auth_identities_provider_check" CHECK ("trail"."auth_identities"."provider" in ('password', 'apple', 'google')),
	CONSTRAINT "auth_identities_subject_length_check" CHECK (length("trail"."auth_identities"."provider_subject") between 1 and 2048)
);
--> statement-breakpoint
CREATE TABLE "trail"."object_deletion_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"source_activity_id" uuid NOT NULL,
	"source_photo_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "object_deletion_outbox_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "object_deletion_outbox_source_photo_unique" UNIQUE("source_photo_id"),
	CONSTRAINT "object_deletion_outbox_object_key_owner_check" CHECK (length("trail"."object_deletion_outbox"."object_key") <= 1024 and "trail"."object_deletion_outbox"."object_key" = 'users/' || "trail"."object_deletion_outbox"."owner_user_id"::text || '/activities/' || "trail"."object_deletion_outbox"."source_activity_id"::text || '/photos/' || "trail"."object_deletion_outbox"."source_photo_id"::text),
	CONSTRAINT "object_deletion_outbox_status_check" CHECK ("trail"."object_deletion_outbox"."status" in ('pending', 'retry', 'completed')),
	CONSTRAINT "object_deletion_outbox_attempt_count_check" CHECK ("trail"."object_deletion_outbox"."attempt_count" between 0 and 2147483647),
	CONSTRAINT "object_deletion_outbox_error_code_check" CHECK ("trail"."object_deletion_outbox"."last_error_code" is null or (length("trail"."object_deletion_outbox"."last_error_code") between 1 and 100 and "trail"."object_deletion_outbox"."last_error_code" ~ '^[a-z0-9_]+$')),
	CONSTRAINT "object_deletion_outbox_completion_check" CHECK (("trail"."object_deletion_outbox"."status" = 'completed') = ("trail"."object_deletion_outbox"."completed_at" is not null)),
	CONSTRAINT "object_deletion_outbox_updated_at_check" CHECK ("trail"."object_deletion_outbox"."updated_at" >= "trail"."object_deletion_outbox"."created_at")
);
--> statement-breakpoint
CREATE TABLE "trail"."refresh_token_families" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_hint" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_token_families_expiry_check" CHECK ("trail"."refresh_token_families"."expires_at" > "trail"."refresh_token_families"."created_at"),
	CONSTRAINT "refresh_token_families_revocation_check" CHECK ("trail"."refresh_token_families"."revoked_at" is null or "trail"."refresh_token_families"."revoked_at" >= "trail"."refresh_token_families"."created_at"),
	CONSTRAINT "refresh_token_families_device_hint_check" CHECK ("trail"."refresh_token_families"."device_hint" is null or length(trim("trail"."refresh_token_families"."device_hint")) between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "trail"."refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "refresh_tokens_family_sequence_unique" UNIQUE("family_id","sequence"),
	CONSTRAINT "refresh_tokens_sequence_check" CHECK ("trail"."refresh_tokens"."sequence" >= 0),
	CONSTRAINT "refresh_tokens_hash_format_check" CHECK ("trail"."refresh_tokens"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "refresh_tokens_expiry_check" CHECK ("trail"."refresh_tokens"."expires_at" > "trail"."refresh_tokens"."created_at"),
	CONSTRAINT "refresh_tokens_consumed_check" CHECK ("trail"."refresh_tokens"."consumed_at" is null or "trail"."refresh_tokens"."consumed_at" >= "trail"."refresh_tokens"."created_at"),
	CONSTRAINT "refresh_tokens_revoked_check" CHECK ("trail"."refresh_tokens"."revoked_at" is null or "trail"."refresh_tokens"."revoked_at" >= "trail"."refresh_tokens"."created_at")
);
--> statement-breakpoint
CREATE TABLE "trail"."routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sport_hint" text,
	"waypoints" jsonb NOT NULL,
	"polyline" text NOT NULL,
	"distance_m" double precision NOT NULL,
	"elevation_gain_m" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "routes_id_user_id_unique" UNIQUE("id","user_id"),
	CONSTRAINT "routes_name_length_check" CHECK (length(trim("trail"."routes"."name")) between 1 and 200),
	CONSTRAINT "routes_sport_hint_check" CHECK ("trail"."routes"."sport_hint" is null or "trail"."routes"."sport_hint" in ('run', 'ride', 'walk', 'hike')),
	CONSTRAINT "routes_waypoints_check" CHECK (trail.valid_route_waypoints("trail"."routes"."waypoints")),
	CONSTRAINT "routes_polyline_length_check" CHECK (length("trail"."routes"."polyline") between 1 and 1000000),
	CONSTRAINT "routes_distance_check" CHECK ("trail"."routes"."distance_m" >= 0 and "trail"."routes"."distance_m" not in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)),
	CONSTRAINT "routes_elevation_gain_check" CHECK ("trail"."routes"."elevation_gain_m" is null or ("trail"."routes"."elevation_gain_m" >= 0 and "trail"."routes"."elevation_gain_m" not in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision))),
	CONSTRAINT "routes_updated_at_check" CHECK ("trail"."routes"."updated_at" >= "trail"."routes"."created_at")
);
--> statement-breakpoint
CREATE TABLE "trail"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text,
	"password_hash" text,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"units" text DEFAULT 'metric' NOT NULL,
	"default_sport" text DEFAULT 'run' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_length_check" CHECK ("trail"."users"."email" is null or length(trim("trail"."users"."email")) between 1 and 320),
	CONSTRAINT "users_password_hash_format_check" CHECK ("trail"."users"."password_hash" is null or (length("trail"."users"."password_hash") <= 512 and ("trail"."users"."password_hash" ~ '^\$argon2id\$v=19\$m=[0-9]+,t=[0-9]+,p=[0-9]+\$[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]+={0,2}$' or "trail"."users"."password_hash" ~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$'))),
	CONSTRAINT "users_display_name_length_check" CHECK (length(trim("trail"."users"."display_name")) between 1 and 100),
	CONSTRAINT "users_avatar_url_length_check" CHECK ("trail"."users"."avatar_url" is null or length("trail"."users"."avatar_url") between 1 and 2048),
	CONSTRAINT "users_units_check" CHECK ("trail"."users"."units" in ('metric', 'imperial')),
	CONSTRAINT "users_default_sport_check" CHECK ("trail"."users"."default_sport" in ('run', 'ride', 'walk', 'hike')),
	CONSTRAINT "users_updated_at_check" CHECK ("trail"."users"."updated_at" >= "trail"."users"."created_at")
);
--> statement-breakpoint
ALTER TABLE "trail"."activities" ADD CONSTRAINT "activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "trail"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trail"."activities" ADD CONSTRAINT "activities_route_owner_fk" FOREIGN KEY ("route_id","user_id") REFERENCES "trail"."routes"("id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trail"."activity_elevation_samples" ADD CONSTRAINT "activity_elevation_samples_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "trail"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trail"."activity_photos" ADD CONSTRAINT "activity_photos_activity_owner_fk" FOREIGN KEY ("activity_id","user_id") REFERENCES "trail"."activities"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trail"."activity_points" ADD CONSTRAINT "activity_points_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "trail"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trail"."activity_splits" ADD CONSTRAINT "activity_splits_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "trail"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trail"."auth_identities" ADD CONSTRAINT "auth_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "trail"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trail"."refresh_token_families" ADD CONSTRAINT "refresh_token_families_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "trail"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trail"."refresh_tokens" ADD CONSTRAINT "refresh_tokens_family_id_refresh_token_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "trail"."refresh_token_families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trail"."routes" ADD CONSTRAINT "routes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "trail"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_user_started_at_idx" ON "trail"."activities" USING btree ("user_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_elevation_activity_id_idx" ON "trail"."activity_elevation_samples" USING btree ("activity_id");--> statement-breakpoint
CREATE INDEX "activity_photos_activity_id_idx" ON "trail"."activity_photos" USING btree ("activity_id");--> statement-breakpoint
CREATE INDEX "activity_photos_user_id_idx" ON "trail"."activity_photos" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "activity_points_activity_recorded_at_idx" ON "trail"."activity_points" USING btree ("activity_id","recorded_at");--> statement-breakpoint
CREATE INDEX "activity_splits_activity_id_idx" ON "trail"."activity_splits" USING btree ("activity_id");--> statement-breakpoint
CREATE INDEX "auth_identities_user_id_idx" ON "trail"."auth_identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "object_deletion_outbox_pending_idx" ON "trail"."object_deletion_outbox" USING btree ("next_attempt_at") WHERE "trail"."object_deletion_outbox"."status" in ('pending', 'retry');--> statement-breakpoint
CREATE INDEX "object_deletion_outbox_owner_user_id_idx" ON "trail"."object_deletion_outbox" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "refresh_token_families_user_id_idx" ON "trail"."refresh_token_families" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_id_idx" ON "trail"."refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "routes_user_created_at_idx" ON "trail"."routes" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_normalized_unique" ON "trail"."users" USING btree (lower("email")) WHERE "trail"."users"."email" is not null;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "trail"."clear_deleted_route_reference"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	UPDATE "trail"."activities"
	SET "route_id" = NULL
	WHERE "route_id" = OLD."id" AND "user_id" = OLD."user_id";
	RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "routes_clear_activity_reference_before_delete"
BEFORE DELETE ON "trail"."routes"
FOR EACH ROW
EXECUTE FUNCTION "trail"."clear_deleted_route_reference"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "trail"."enqueue_photo_object_deletion"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	INSERT INTO "trail"."object_deletion_outbox" (
		"owner_user_id",
		"source_activity_id",
		"source_photo_id",
		"object_key"
	) VALUES (
		OLD."user_id",
		OLD."activity_id",
		OLD."id",
		OLD."object_key"
	)
	ON CONFLICT ("source_photo_id") DO NOTHING;

	IF NOT EXISTS (
		SELECT 1
		FROM "trail"."object_deletion_outbox"
		WHERE "source_photo_id" = OLD."id"
			AND "owner_user_id" = OLD."user_id"
			AND "source_activity_id" = OLD."activity_id"
			AND "object_key" = OLD."object_key"
	) THEN
		RAISE EXCEPTION 'photo deletion was not enqueued consistently'
			USING ERRCODE = 'integrity_constraint_violation';
	END IF;
	RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "activity_photos_enqueue_object_delete_before_delete"
BEFORE DELETE ON "trail"."activity_photos"
FOR EACH ROW
EXECUTE FUNCTION "trail"."enqueue_photo_object_deletion"();