-- Migration: add transaction/reconciliation fields to payments table
-- New columns: user_id, astrologer_id (denormalized), currency, method,
--              captured_at, failure_code, failure_reason

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "astrologer_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "currency" varchar(8) NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS "method" varchar(32),
  ADD COLUMN IF NOT EXISTS "captured_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "failure_code" varchar(64),
  ADD COLUMN IF NOT EXISTS "failure_reason" text;

CREATE INDEX IF NOT EXISTS "payments_user_id_idx" ON "payments" ("user_id");
CREATE INDEX IF NOT EXISTS "payments_astrologer_id_idx" ON "payments" ("astrologer_id");
