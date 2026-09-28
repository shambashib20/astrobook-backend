-- Migration: create payment_transactions event log table
-- Append-only immutable ledger — one row per lifecycle event per payment.
-- Used for reconciliation and dispute resolution.

DO $$ BEGIN
  CREATE TYPE "public"."payment_transaction_event" AS ENUM(
    'order.created',
    'payment.captured',
    'payment.failed',
    'payment.refunded',
    'verify.success',
    'verify.failed'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "payment_transactions" (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "payment_id"           uuid REFERENCES "payments"("id") ON DELETE SET NULL,
  "appointment_id"       uuid REFERENCES "appointments"("id") ON DELETE SET NULL,
  "user_id"              uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "astrologer_id"        uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "razorpay_order_id"    varchar(255),
  "razorpay_payment_id"  varchar(255),
  "event"                "payment_transaction_event" NOT NULL,
  "amount"               numeric(10, 2) NOT NULL,
  "currency"             varchar(8) NOT NULL DEFAULT 'INR',
  "method"               varchar(32),
  "failure_code"         varchar(64),
  "failure_reason"       text,
  "razorpay_fee"         numeric(10, 2),
  "razorpay_tax"         numeric(10, 2),
  "captured_at"          timestamp with time zone,
  "raw_payload"          jsonb,
  "created_at"           timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "payment_transactions_order_id_idx"       ON "payment_transactions" ("razorpay_order_id");
CREATE INDEX IF NOT EXISTS "payment_transactions_user_id_idx"        ON "payment_transactions" ("user_id");
CREATE INDEX IF NOT EXISTS "payment_transactions_astrologer_id_idx"  ON "payment_transactions" ("astrologer_id");
CREATE INDEX IF NOT EXISTS "payment_transactions_appointment_id_idx" ON "payment_transactions" ("appointment_id");
