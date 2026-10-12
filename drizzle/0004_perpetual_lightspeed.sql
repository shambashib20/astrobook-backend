DO $$ BEGIN
 CREATE TYPE "public"."cancellation_initiated_by" AS ENUM('astrologer', 'user');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

ALTER TYPE "public"."cancellation_request_status" ADD VALUE 'timing_changed';

ALTER TABLE "appointments" ADD COLUMN "rescheduled_count" smallint DEFAULT 0 NOT NULL;

ALTER TABLE "cancellation_requests" ADD COLUMN "initiated_by" "cancellation_initiated_by" DEFAULT 'astrologer' NOT NULL;