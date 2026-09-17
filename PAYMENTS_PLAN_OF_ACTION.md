# Payments — Plan of Action

**Prepared:** 2026-09-15 · **Client deadline:** 2026-09-18 (3 days)

## Situation

Cashfree has refused production access to **Easy Split** (their marketplace vendor-split
feature) — this is the piece that would auto-split each payment between Astro Book and
the astrologer at the moment of payment. Plain payment collection (money lands in our
own account, no auto-split) is **not** blocked, but we don't have live production keys
for it yet, and Cashfree's approval timeline isn't something we control.

**Decision:** don't wait on Cashfree. Run two tracks in parallel.

## Track A — Manual UPI collection (ships for Sep 18)

Users pay Astro Book's own bank UPI ID directly (GPay/PhonePe/any UPI app), submit their
transaction reference number (UTR) as proof, and an admin verifies it against the bank
statement before the booking confirms. No payment gateway dependency at all — fully
within our control.

- Astrologer payouts are **not** split automatically. We track what each astrologer is
  owed internally (a ledger) and pay them out by bank transfer on our own schedule,
  using bank details collected manually (WhatsApp/email) for the first cohort.
- This is a deliberately manual, low-tech process for launch — not the long-term
  architecture. It's the fastest safe path to a working, fraud-resistant payment flow.

### Why not simpler alternatives
- A webhook that fires on "Pay Now" tap alone (no real payment check) can't tell
  whether money actually moved — anyone could tap through for a free booking.
- A plain static bank QR doesn't encode an amount — the payer has to type it in by
  hand, which is error-prone for a booking flow with variable prices.
- There is no Google-provided webhook API for arbitrary UPI transfers into a
  personal/current-account VPA. The real, zero-approval mechanism is the **universal
  UPI intent URI** (`upi://pay?pa=...&am=...&tr=...`), which every UPI app supports —
  not something specific to Google Pay.

### What's being built
- **Backend**: new `payments` table fields (`paymentMethod`, `utrNumber` with a unique
  constraint to block reuse, optional screenshot proof, admin verification fields), a
  user-facing submit endpoint, and admin approve/reject endpoints that reuse the same
  confirmation logic already proven working this week (Agora token issuance, push
  notifications) — just triggered by an admin action instead of a payment-gateway
  webhook.
- **Mobile app**: a UPI payment screen (deep-link/QR + UTR submission form) replacing
  the gateway checkout screen for this flow.
- **Admin panel**: a verification queue (approve/reject pending UPI payments),
  mirroring the existing refunds-pending queue already in the app.

See `.claude/plans/indexed-jumping-floyd.md` (Track A section) for full engineering detail.

## Track B — Cashfree, parked (not blocking the deadline)

All the Cashfree integration work already built and sandbox-tested this week (order
creation, webhook signature verification, payment confirmation) stays in the codebase,
switched off behind a config flag — **not deleted**. The moment Cashfree issues live
standard-PG keys, we flip back with no rework lost. An escalation email has been sent
to Cashfree pushing on this.

## Day-by-day

| Day | Focus |
|---|---|
| **Sep 15 (today)** | Escalation email sent to Cashfree. Backend: schema changes + submit/verify API endpoints for manual UPI payments. |
| **Sep 16** | Mobile app: UPI payment screen. Admin panel: verification queue. |
| **Sep 17** | End-to-end testing with a real test payment. Astrologer payout ledger wired up for admin visibility. Bug fixes. |
| **Sep 18** | Buffer day / delivery. |

## Key risk

Verification is manual — an admin checks each payment against the bank statement. This
doesn't scale past a small volume of daily bookings, but it's the right tradeoff to hit
Sep 18 safely. Cashfree activation (Track B) is the unblock for automating this
properly; the escalation email is the critical-path item outside engineering's control.
