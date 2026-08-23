CREATE INDEX "activities_user_sport_started_at_idx" ON "trail"."activities" USING btree ("user_id", "sport", "started_at" DESC NULLS LAST);
