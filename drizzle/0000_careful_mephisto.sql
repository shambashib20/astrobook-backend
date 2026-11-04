DO $$ BEGIN
 CREATE TYPE "public"."user_role" AS ENUM('user', 'astrologer', 'admin');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."verification_status" AS ENUM('pending', 'approved', 'rejected');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."appointment_status" AS ENUM('pending', 'confirmed', 'ongoing', 'completed', 'cancelled', 'missed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."bundle_status" AS ENUM('in_progress', 'paused', 'completed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."cancellation_initiated_by" AS ENUM('astrologer', 'user');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."cancellation_request_status" AS ENUM('pending', 'refunded', 'credited', 'timing_changed', 'admin_pending_money', 'admin_pending_wallet', 'admin_approved', 'admin_rejected');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."cancelled_by" AS ENUM('user', 'astrologer');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."payment_status" AS ENUM('pending', 'success', 'failed', 'refunded');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."payment_transaction_event" AS ENUM('order.created', 'payment.captured', 'payment.failed', 'payment.refunded', 'verify.success', 'verify.failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."service_request_status" AS ENUM('pending', 'accepted', 'rejected', 'expired');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."wallet_credit_source" AS ENUM('cancellation_refund', 'manual', 'booking_payment');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."wallet_credit_type" AS ENUM('credit', 'debit');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."media_type" AS ENUM('IMAGE', 'VIDEO', 'TEXT');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."notification_type" AS ENUM('new_follower', 'post_liked', 'post_commented');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "astrologer_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"bio" text,
	"experience" smallint DEFAULT 0,
	"languages" text[],
	"specializations" text[],
	"photo_url" text,
	"banner_url" text,
	"rating" numeric(3, 2) DEFAULT '0.00',
	"total_reviews" integer DEFAULT 0,
	"is_verified" boolean DEFAULT false NOT NULL,
	"is_online" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"verification_status" "verification_status" DEFAULT 'pending' NOT NULL,
	"video_url" text,
	"document_1_url" text,
	"document_2_url" text,
	"rejection_reason" text,
	"verified_at" timestamp with time zone,
	"verified_by" uuid,
	"base_price" numeric(10, 2),
	"payout_method" varchar(8),
	"payout_details" jsonb,
	"payout_details_updated_at" timestamp with time zone,
	"razorpay_account_id" varchar(64),
	"razorpay_account_status" varchar(32),
	"razorpay_reference_id" varchar(128),
	"razorpay_account_response" jsonb,
	"razorpay_account_created_at" timestamp with time zone,
	"razorpay_product_id" varchar(64),
	"razorpay_product_status" varchar(32),
	"razorpay_product_response" jsonb,
	"razorpay_stakeholder_id" varchar(64),
	"razorpay_stakeholder_response" jsonb,
	"razorpay_documents_response" jsonb,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "astrologer_profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "astrologer_profiles_razorpay_account_id_unique" UNIQUE("razorpay_account_id"),
	CONSTRAINT "astrologer_profiles_razorpay_product_id_unique" UNIQUE("razorpay_product_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "otp_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" varchar(20) NOT NULL,
	"otp_hash" varchar(255) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" varchar(20),
	"email" varchar(255),
	"name" varchar(255),
	"date_of_birth" date,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"interests" text[],
	"is_onboarded" boolean DEFAULT false NOT NULL,
	"is_astrologer" boolean DEFAULT false NOT NULL,
	"google_id" varchar(128),
	"avatar_url" text,
	"bio" text,
	"password_hash" varchar(255),
	"is_banned" boolean DEFAULT false NOT NULL,
	"ban_reason" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_phone_unique" UNIQUE("phone"),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_google_id_unique" UNIQUE("google_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"refresh_token" text NOT NULL,
	"device_info" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"meta" jsonb,
	CONSTRAINT "sessions_refresh_token_unique" UNIQUE("refresh_token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"astrologer_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"variant_id" uuid,
	"parent_id" uuid,
	"bundle_status" "bundle_status",
	"scheduled_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"duration_minutes" smallint NOT NULL,
	"price" numeric(10, 2),
	"agora_channel" text,
	"agora_token" text,
	"astrologer_joined_at" timestamp with time zone,
	"reminder_sent_at" timestamp with time zone,
	"status" "appointment_status" DEFAULT 'pending' NOT NULL,
	"cancelled_by" "cancelled_by",
	"rescheduled_count" smallint DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"meta" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "availability_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"astrologer_id" uuid NOT NULL,
	"date" date NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"timezone" varchar(64) DEFAULT 'Asia/Kolkata' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"meta" jsonb,
	CONSTRAINT "availability_windows_astrologer_id_date_start_time_end_time_unique" UNIQUE("astrologer_id","date","start_time","end_time")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cancellation_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"razorpay_payment_id" varchar(255),
	"razorpay_order_id" varchar(255),
	"deduction_amount" integer DEFAULT 0 NOT NULL,
	"upi_id" varchar(255),
	"status" "cancellation_request_status" DEFAULT 'pending' NOT NULL,
	"initiated_by" "cancellation_initiated_by" DEFAULT 'astrologer' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consultation_service_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"duration_minutes" smallint NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consultation_service_variants_service_id_duration_minutes_unique" UNIQUE("service_id","duration_minutes")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consultation_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"astrologer_id" uuid NOT NULL,
	"is_basic" boolean DEFAULT false NOT NULL,
	"title" varchar(255) NOT NULL,
	"short_description" varchar(500) NOT NULL,
	"cover_image" text,
	"about" text NOT NULL,
	"duration_minutes" smallint NOT NULL,
	"price" numeric(10, 2),
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"meta" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid,
	"appointment_id" uuid,
	"user_id" uuid,
	"astrologer_id" uuid,
	"razorpay_order_id" varchar(255),
	"razorpay_payment_id" varchar(255),
	"event" "payment_transaction_event" NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"currency" varchar(8) DEFAULT 'INR' NOT NULL,
	"method" varchar(32),
	"failure_code" varchar(64),
	"failure_reason" text,
	"razorpay_fee" numeric(10, 2),
	"razorpay_tax" numeric(10, 2),
	"captured_at" timestamp with time zone,
	"raw_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"user_id" uuid,
	"astrologer_id" uuid,
	"razorpay_order_id" varchar(255),
	"razorpay_payment_id" varchar(255),
	"razorpay_signature" varchar(512),
	"amount" numeric(10, 2) NOT NULL,
	"currency" varchar(8) DEFAULT 'INR' NOT NULL,
	"method" varchar(32),
	"captured_at" timestamp with time zone,
	"failure_code" varchar(64),
	"failure_reason" text,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE IF NOT EXISTS "service_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_appointment_id" uuid NOT NULL,
	"astrologer_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"variant_id" uuid,
	"proposed_slot" timestamp with time zone NOT NULL,
	"status" "service_request_status" DEFAULT 'pending' NOT NULL,
	"child_appointment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
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
CREATE TABLE IF NOT EXISTS "wallet_credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"type" "wallet_credit_type" NOT NULL,
	"source" "wallet_credit_source" NOT NULL,
	"cancellation_request_id" uuid,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cart_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"astrologer_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"variant_id" uuid,
	"scheduled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cart_items_user_service_unique" UNIQUE("user_id","service_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"expo_push_token" text NOT NULL,
	"platform" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_tokens_user_id_expo_push_token_unique" UNIQUE("user_id","expo_push_token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "post_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "post_likes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_likes_post_id_user_id_unique" UNIQUE("post_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"astrologer_id" uuid NOT NULL,
	"content" text NOT NULL,
	"media_url" text,
	"media_type" "media_type" DEFAULT 'TEXT',
	"bg_color" text,
	"text_color" text,
	"duration_seconds" integer,
	"sticker_text" text,
	"sticker_x" numeric(5, 4),
	"sticker_y" numeric(5, 4),
	"sticker_text_color" text,
	"sticker_bg_color" text,
	"linked_service_id" uuid,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "follows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"follower_id" uuid NOT NULL,
	"following_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_follower_id_following_id_unique" UNIQUE("follower_id","following_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"actor_id" uuid NOT NULL,
	"post_id" uuid,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "favorites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"item_type" varchar(32) NOT NULL,
	"item_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favorites_user_item_unique" UNIQUE("user_id","item_type","item_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"astrologer_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_appointment_id_unique" UNIQUE("appointment_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "category_media" (
	"id" text PRIMARY KEY NOT NULL,
	"hero_video_url" text,
	"hero_image_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payout_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"astrologer_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"status" varchar(10) DEFAULT 'pending' NOT NULL,
	"payout_method" varchar(8),
	"reference_id" varchar(255),
	"notes" text,
	"period_from" timestamp with time zone,
	"period_to" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "astrologer_profiles" ADD CONSTRAINT "astrologer_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "astrologer_profiles" ADD CONSTRAINT "astrologer_profiles_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointments" ADD CONSTRAINT "appointments_astrologer_id_users_id_fk" FOREIGN KEY ("astrologer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointments" ADD CONSTRAINT "appointments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_id_consultation_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."consultation_services"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointments" ADD CONSTRAINT "appointments_variant_id_consultation_service_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."consultation_service_variants"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointments" ADD CONSTRAINT "appointments_parent_id_appointments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "availability_windows" ADD CONSTRAINT "availability_windows_astrologer_id_users_id_fk" FOREIGN KEY ("astrologer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cancellation_requests" ADD CONSTRAINT "cancellation_requests_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cancellation_requests" ADD CONSTRAINT "cancellation_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "consultation_service_variants" ADD CONSTRAINT "consultation_service_variants_service_id_consultation_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."consultation_services"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "consultation_services" ADD CONSTRAINT "consultation_services_astrologer_id_users_id_fk" FOREIGN KEY ("astrologer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_astrologer_id_users_id_fk" FOREIGN KEY ("astrologer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_astrologer_id_users_id_fk" FOREIGN KEY ("astrologer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recurring_availability" ADD CONSTRAINT "recurring_availability_astrologer_id_users_id_fk" FOREIGN KEY ("astrologer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_parent_appointment_id_appointments_id_fk" FOREIGN KEY ("parent_appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_astrologer_id_users_id_fk" FOREIGN KEY ("astrologer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_service_id_consultation_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."consultation_services"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_variant_id_consultation_service_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."consultation_service_variants"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_child_appointment_id_appointments_id_fk" FOREIGN KEY ("child_appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;
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
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wallet_credits" ADD CONSTRAINT "wallet_credits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wallet_credits" ADD CONSTRAINT "wallet_credits_cancellation_request_id_cancellation_requests_id_fk" FOREIGN KEY ("cancellation_request_id") REFERENCES "public"."cancellation_requests"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_astrologer_id_users_id_fk" FOREIGN KEY ("astrologer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_service_id_consultation_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."consultation_services"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_consultation_service_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."consultation_service_variants"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "posts" ADD CONSTRAINT "posts_astrologer_id_users_id_fk" FOREIGN KEY ("astrologer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "follows" ADD CONSTRAINT "follows_following_id_users_id_fk" FOREIGN KEY ("following_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reviews" ADD CONSTRAINT "reviews_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reviews" ADD CONSTRAINT "reviews_astrologer_id_users_id_fk" FOREIGN KEY ("astrologer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payout_records" ADD CONSTRAINT "payout_records_astrologer_id_users_id_fk" FOREIGN KEY ("astrologer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payout_records" ADD CONSTRAINT "payout_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "otp_verifications_phone_idx" ON "otp_verifications" USING btree ("phone");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "otp_verifications_phone_created_at_idx" ON "otp_verifications" USING btree ("phone","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_is_astrologer_idx" ON "users" USING btree ("is_astrologer") WHERE "users"."is_astrologer" = true;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_user_id_created_at_idx" ON "sessions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointments_user_id_idx" ON "appointments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointments_astrologer_id_scheduled_at_idx" ON "appointments" USING btree ("astrologer_id","scheduled_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointments_service_id_idx" ON "appointments" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointments_parent_id_idx" ON "appointments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cancellation_requests_appointment_id_idx" ON "cancellation_requests" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cancellation_requests_user_id_idx" ON "cancellation_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cancellation_requests_status_expires_at_idx" ON "cancellation_requests" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consultation_services_astrologer_id_idx" ON "consultation_services" USING btree ("astrologer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consultation_services_tags_gin_idx" ON "consultation_services" USING gin ("tags");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_transactions_order_id_idx" ON "payment_transactions" USING btree ("razorpay_order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_transactions_user_id_idx" ON "payment_transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_transactions_astrologer_id_idx" ON "payment_transactions" USING btree ("astrologer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_transactions_appointment_id_idx" ON "payment_transactions" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_appointment_id_idx" ON "payments" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_user_id_idx" ON "payments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_astrologer_id_idx" ON "payments" USING btree ("astrologer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_requests_parent_appointment_id_idx" ON "service_requests" USING btree ("parent_appointment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_requests_astrologer_id_idx" ON "service_requests" USING btree ("astrologer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_requests_user_id_idx" ON "service_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wallet_credits_user_id_idx" ON "wallet_credits" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wallet_credits_cancellation_request_id_idx" ON "wallet_credits" USING btree ("cancellation_request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cart_items_user_id_idx" ON "cart_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "post_comments_post_id_created_at_idx" ON "post_comments" USING btree ("post_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "post_likes_user_id_idx" ON "post_likes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "posts_astrologer_id_created_at_idx" ON "posts" USING btree ("astrologer_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "posts_tags_gin_idx" ON "posts" USING gin ("tags");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "follows_following_id_idx" ON "follows" USING btree ("following_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_id_created_at_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_created_at_idx" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "favorites_user_created_at_idx" ON "favorites" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_astrologer_created_at_idx" ON "reviews" USING btree ("astrologer_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_user_id_idx" ON "reviews" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payout_records_astrologer_idx" ON "payout_records" USING btree ("astrologer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payout_records_status_idx" ON "payout_records" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payout_records_created_at_idx" ON "payout_records" USING btree ("created_at");