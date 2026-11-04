CREATE TABLE IF NOT EXISTS "user_kundlis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"lagna" varchar(50),
	"lagna_lord" varchar(50),
	"lagna_degree" numeric(6, 3),
	"rashi" varchar(50),
	"rashi_lord" varchar(50),
	"sun_sign" varchar(50),
	"nakshatra" varchar(50),
	"nakshatra_pada" smallint,
	"current_mahadasha" varchar(50),
	"current_antardasha" varchar(50),
	"current_pratyantar" varchar(50),
	"mahadasha_end_date" date,
	"antardasha_end_date" date,
	"is_manglik" boolean DEFAULT false NOT NULL,
	"manglik_type" varchar(20),
	"has_kaal_sarp" boolean DEFAULT false NOT NULL,
	"kaal_sarp_type" varchar(50),
	"sade_sati_active" boolean DEFAULT false NOT NULL,
	"sade_sati_end_date" date,
	"sade_sati_phase" varchar(20),
	"planets_data" jsonb,
	"houses_data" jsonb,
	"dasha_timeline" jsonb,
	"full_kundli_data" jsonb,
	"is_public" boolean DEFAULT false NOT NULL,
	"share_token" varchar(64) DEFAULT gen_random_uuid()::text,
	"birth_date" date,
	"birth_time" time,
	"birth_place" varchar(255),
	"birth_lat" numeric(9, 6),
	"birth_lng" numeric(9, 6),
	"generated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_kundlis_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "user_kundlis_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "birth_time" time;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "birth_place" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "birth_lat" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "birth_lng" numeric(9, 6);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_kundlis" ADD CONSTRAINT "user_kundlis_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_kundlis_user_id_idx" ON "user_kundlis" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_kundlis_sade_sati_active_idx" ON "user_kundlis" USING btree ("sade_sati_active") WHERE "user_kundlis"."sade_sati_active" = true;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_kundlis_mahadasha_end_date_idx" ON "user_kundlis" USING btree ("mahadasha_end_date");