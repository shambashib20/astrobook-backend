DO $$ BEGIN
 CREATE TYPE "public"."cancellation_request_status" AS ENUM('pending', 'refunded', 'credited');
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
CREATE TABLE IF NOT EXISTS "cancellation_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"razorpay_payment_id" varchar(255) NOT NULL,
	"razorpay_order_id" varchar(255),
	"status" "cancellation_request_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
ALTER TABLE "appointments" ADD COLUMN "cancelled_by" "cancelled_by";--> statement-breakpoint
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
CREATE INDEX IF NOT EXISTS "cancellation_requests_appointment_id_idx" ON "cancellation_requests" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cancellation_requests_user_id_idx" ON "cancellation_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cancellation_requests_status_expires_at_idx" ON "cancellation_requests" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wallet_credits_user_id_idx" ON "wallet_credits" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wallet_credits_cancellation_request_id_idx" ON "wallet_credits" USING btree ("cancellation_request_id");