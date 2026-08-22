CREATE TABLE "trail"."email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"reset_token_id" uuid,
	"registration_verification_id" uuid,
	"purpose" text NOT NULL,
	"should_deliver" boolean NOT NULL,
	"payload_ciphertext" text NOT NULL,
	"payload_iv" text NOT NULL,
	"payload_tag" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_outbox_status_check" CHECK ("trail"."email_outbox"."status" in ('pending', 'delivered', 'dead')),
	CONSTRAINT "email_outbox_purpose_check" CHECK ("trail"."email_outbox"."purpose" in ('registration', 'password_reset', 'tombstone')),
	CONSTRAINT "email_outbox_attempt_count_check" CHECK ("trail"."email_outbox"."attempt_count" between 0 and 5),
	CONSTRAINT "email_outbox_delivery_shape_check" CHECK (("trail"."email_outbox"."should_deliver" and "trail"."email_outbox"."purpose" = 'password_reset' and "trail"."email_outbox"."user_id" is not null and "trail"."email_outbox"."reset_token_id" is not null and "trail"."email_outbox"."registration_verification_id" is null) or ("trail"."email_outbox"."should_deliver" and "trail"."email_outbox"."purpose" = 'registration' and "trail"."email_outbox"."user_id" is null and "trail"."email_outbox"."reset_token_id" is null and "trail"."email_outbox"."registration_verification_id" is not null) or (not "trail"."email_outbox"."should_deliver" and "trail"."email_outbox"."purpose" = 'tombstone' and "trail"."email_outbox"."user_id" is null and "trail"."email_outbox"."reset_token_id" is null and "trail"."email_outbox"."registration_verification_id" is null))
);
--> statement-breakpoint
CREATE TABLE "trail"."password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "password_reset_tokens_hash_format_check" CHECK ("trail"."password_reset_tokens"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "password_reset_tokens_expiry_check" CHECK ("trail"."password_reset_tokens"."expires_at" > "trail"."password_reset_tokens"."created_at"),
	CONSTRAINT "password_reset_tokens_consumed_check" CHECK ("trail"."password_reset_tokens"."consumed_at" is null or "trail"."password_reset_tokens"."consumed_at" >= "trail"."password_reset_tokens"."created_at")
);
--> statement-breakpoint
CREATE TABLE "trail"."registration_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registration_verifications_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "registration_verifications_email_check" CHECK (length(trim("trail"."registration_verifications"."email")) between 1 and 320 and "trail"."registration_verifications"."email" = lower("trail"."registration_verifications"."email")),
	CONSTRAINT "registration_verifications_password_hash_check" CHECK ("trail"."registration_verifications"."password_hash" ~ '^\$argon2id\$v=19\$m=[0-9]+,t=[0-9]+,p=[0-9]+\$[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]+={0,2}$'),
	CONSTRAINT "registration_verifications_display_name_check" CHECK (length(trim("trail"."registration_verifications"."display_name")) between 1 and 100),
	CONSTRAINT "registration_verifications_token_hash_check" CHECK ("trail"."registration_verifications"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "registration_verifications_expiry_check" CHECK ("trail"."registration_verifications"."expires_at" > "trail"."registration_verifications"."created_at")
);
--> statement-breakpoint
ALTER TABLE "trail"."refresh_tokens" ADD COLUMN "rotation_request_hash" text;--> statement-breakpoint
ALTER TABLE "trail"."refresh_tokens" ADD COLUMN "successor_ciphertext" text;--> statement-breakpoint
ALTER TABLE "trail"."refresh_tokens" ADD COLUMN "successor_iv" text;--> statement-breakpoint
ALTER TABLE "trail"."refresh_tokens" ADD COLUMN "successor_tag" text;--> statement-breakpoint
ALTER TABLE "trail"."refresh_tokens" ADD COLUMN "successor_token_id" uuid;--> statement-breakpoint
ALTER TABLE "trail"."users" ADD COLUMN "auth_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "trail"."email_outbox" ADD CONSTRAINT "email_outbox_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "trail"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trail"."email_outbox" ADD CONSTRAINT "email_outbox_reset_token_id_password_reset_tokens_id_fk" FOREIGN KEY ("reset_token_id") REFERENCES "trail"."password_reset_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trail"."email_outbox" ADD CONSTRAINT "email_outbox_registration_verification_fk" FOREIGN KEY ("registration_verification_id") REFERENCES "trail"."registration_verifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trail"."password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "trail"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_outbox_pending_idx" ON "trail"."email_outbox" USING btree ("next_attempt_at") WHERE "trail"."email_outbox"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_id_idx" ON "trail"."password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_expiry_idx" ON "trail"."password_reset_tokens" USING btree ("expires_at") WHERE "trail"."password_reset_tokens"."consumed_at" is null;--> statement-breakpoint
CREATE INDEX "registration_verifications_email_idx" ON "trail"."registration_verifications" USING btree ("email");--> statement-breakpoint
ALTER TABLE "trail"."refresh_tokens" ADD CONSTRAINT "refresh_tokens_successor_token_id_fk" FOREIGN KEY ("successor_token_id") REFERENCES "trail"."refresh_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trail"."refresh_tokens" ADD CONSTRAINT "refresh_tokens_successor_token_unique" UNIQUE("successor_token_id");--> statement-breakpoint
ALTER TABLE "trail"."refresh_tokens" ADD CONSTRAINT "refresh_tokens_rotation_hash_format_check" CHECK ("trail"."refresh_tokens"."rotation_request_hash" is null or "trail"."refresh_tokens"."rotation_request_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "trail"."refresh_tokens" ADD CONSTRAINT "refresh_tokens_recovery_bundle_check" CHECK (("trail"."refresh_tokens"."rotation_request_hash" is null and "trail"."refresh_tokens"."successor_ciphertext" is null and "trail"."refresh_tokens"."successor_iv" is null and "trail"."refresh_tokens"."successor_tag" is null and "trail"."refresh_tokens"."successor_token_id" is null) or ("trail"."refresh_tokens"."rotation_request_hash" is not null and "trail"."refresh_tokens"."successor_ciphertext" is not null and "trail"."refresh_tokens"."successor_iv" is not null and "trail"."refresh_tokens"."successor_tag" is not null and "trail"."refresh_tokens"."successor_token_id" is not null));--> statement-breakpoint
ALTER TABLE "trail"."users" ADD CONSTRAINT "users_auth_version_check" CHECK ("trail"."users"."auth_version" >= 0);