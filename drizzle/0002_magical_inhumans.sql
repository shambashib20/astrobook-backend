CREATE TABLE IF NOT EXISTS "recurring_availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"astrologer_id" uuid NOT NULL,
	"day_of_week" smallint NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"timezone" varchar(64) DEFAULT 'Asia/Kolkata' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_availability_astrologer_id_day_of_week_start_time_end_time_unique" UNIQUE("astrologer_id","day_of_week","start_time","end_time")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "slot_locks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"astrologer_id" uuid NOT NULL,
	"slot_start" timestamp with time zone NOT NULL,
	"locked_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slot_locks_astrologer_id_slot_start_unique" UNIQUE("astrologer_id","slot_start")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "category_media" (
	"id" text PRIMARY KEY NOT NULL,
	"hero_video_url" text,
	"hero_image_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recurring_availability" ADD CONSTRAINT "recurring_availability_astrologer_id_users_id_fk" FOREIGN KEY ("astrologer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "slot_locks" ADD CONSTRAINT "slot_locks_astrologer_id_users_id_fk" FOREIGN KEY ("astrologer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "slot_locks" ADD CONSTRAINT "slot_locks_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
