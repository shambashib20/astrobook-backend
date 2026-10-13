-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Cancellation & Refund Revamp
-- Replace Razorpay-based refund flow with admin-managed manual refund flow
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. New enum values for cancellation_request_status
ALTER TYPE cancellation_request_status ADD VALUE IF NOT EXISTS 'admin_pending_money';
ALTER TYPE cancellation_request_status ADD VALUE IF NOT EXISTS 'admin_pending_wallet';
ALTER TYPE cancellation_request_status ADD VALUE IF NOT EXISTS 'admin_approved';
ALTER TYPE cancellation_request_status ADD VALUE IF NOT EXISTS 'admin_rejected';

-- 2. Make razorpay_payment_id nullable (no longer required for user-cancel)
ALTER TABLE cancellation_requests ALTER COLUMN razorpay_payment_id DROP NOT NULL;

-- 3. Add deduction_amount (0 = free window, 50 = after 10 min)
ALTER TABLE cancellation_requests ADD COLUMN IF NOT EXISTS deduction_amount integer NOT NULL DEFAULT 0;

-- 4. Add upi_id (filled when user chooses money refund)
ALTER TABLE cancellation_requests ADD COLUMN IF NOT EXISTS upi_id varchar(255);
