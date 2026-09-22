// Commented out during the Razorpay rollback (kept, not deleted, as a
// quick re-migration). env.CASHFREE_* no longer exist on `env` (see
// src/config/env.ts), so this whole file is block-commented to stay out
// of the TypeScript build until uncommented.
/*
import axios, { isAxiosError } from 'axios'
import { env } from '@/config/env'
import { BadRequestError, InternalError } from '@/core/errors'

// Easy Split vendor endpoints live under /pg/easy-split — separate base
// from the orders/refunds endpoints (see cashfree-order.service.ts), which
// live directly under /pg.
const CASHFREE_EASY_SPLIT_URL = `${env.CASHFREE_API_ENDPOINT}/pg/easy-split`

function cashfreeHeaders() {
  return {
    'x-client-id': env.CASHFREE_APP_ID,
    'x-client-secret': env.CASHFREE_SECRET_KEY,
    'x-api-version': env.CASHFREE_API_VERSION,
    'Content-Type': 'application/json',
  }
}

// Cashfree's vendor_id is caller-chosen (unlike Razorpay Route, which
// handed back its own account id) — deterministic per astrologer means no
// separate "reference_id" bookkeeping is needed to resume onboarding.
// Stripped of dashes + capped so it comfortably fits Cashfree's vendor_id
// length limit.
export function generateCashfreeVendorId(astrologerId: string): string {
  return `ast_${astrologerId.replace(/-/g, '').slice(0, 20)}`
}

export interface CashfreeVendorBank {
  account_number: string
  account_holder: string
  ifsc: string
}

export interface CashfreeVendorUpi {
  vpa: string
  account_holder: string
}

export interface CashfreeVendorKycDetails {
  account_type: string
  business_type: string
  pan?: string
  gst?: string
  uidai?: string
  cin?: string
  passport_number?: string
}

export interface CashfreeVendorPayload {
  vendor_id: string
  status: 'ACTIVE' | 'INACTIVE'
  name: string
  email: string
  phone: string
  verify_account?: boolean
  dashboard_access?: boolean
  schedule_option: number
  bank?: CashfreeVendorBank
  upi?: CashfreeVendorUpi
  kyc_details?: CashfreeVendorKycDetails
}

export interface CashfreeVendorRequirement {
  field_reference: string
  reason_code: string
  status: string
}

export interface CashfreeVendorResponse {
  vendor_id: string
  status: string
  name: string
  email: string
  phone: string
  kyc_details?: CashfreeVendorKycDetails
  requirements?: CashfreeVendorRequirement[]
  [key: string]: unknown
}

// The interval-based on-demand settlement API is a legacy endpoint that
// lives under a DIFFERENT host than the rest of Easy Split (test./api.
// rather than sandbox./api. + /pg/easy-split) — Cashfree hasn't migrated it
// onto the newer versioned host yet, confirmed against their own reference
// Postman collection.
function legacyEasySplitUrl(): string {
  return env.CASHFREE_ENVIRONMENT === 'PRODUCTION'
    ? 'https://api.cashfree.com/api/v2/easy-split'
    : 'https://test.cashfree.com/api/v2/easy-split'
}

export interface VendorSettleResponse {
  status: string
  utr?: string
  [key: string]: unknown
}

// POST .../vendor/:vendor_id/settle?start=...&end=... — pulls a vendor's
// accumulated split balance over [start, end] and pays it out immediately.
// Driven by our own monthly cron (server.ts, the 8th of every month), NOT
// by Cashfree's scheduled-cycle feature — we don't control that cycle's
// exact day-of-month, so we settle on demand ourselves instead.
export async function settleVendorInterval(
  vendorId: string,
  start: Date,
  end: Date,
): Promise<VendorSettleResponse> {
  try {
    const { data } = await axios.post<VendorSettleResponse>(
      `${legacyEasySplitUrl()}/vendor/${vendorId}/settle`,
      null,
      {
        params: { start: start.toISOString(), end: end.toISOString() },
        headers: cashfreeHeaders(),
      },
    )
    return data
  } catch (err) {
    handleCashfreeError(err, `Failed to settle vendor ${vendorId}`)
  }
}

function handleCashfreeError(err: unknown, fallbackMessage: string): never {
  if (isAxiosError(err)) {
    const message = err.response?.data?.message ?? err.response?.data?.error?.description
    if (err.response && err.response.status < 500) {
      throw BadRequestError(message ?? fallbackMessage)
    }
    throw InternalError(message ?? 'Cashfree is unreachable right now')
  }
  throw err
}

// POST /pg/easy-split/vendors — creates a vendor with bank-or-UPI details
// AND KYC in a single call. This is the one-call replacement for Razorpay
// Route's separate account + product + stakeholder steps.
export async function createVendor(payload: CashfreeVendorPayload): Promise<CashfreeVendorResponse> {
  try {
    const { data } = await axios.post<CashfreeVendorResponse>(
      `${CASHFREE_EASY_SPLIT_URL}/vendors`,
      payload,
      { headers: cashfreeHeaders() },
    )
    return data
  } catch (err) {
    handleCashfreeError(err, 'Cashfree vendor creation failed')
  }
}

// PATCH /pg/easy-split/vendors/:vendor_id — used to update bank/UPI/KYC on
// an already-created vendor (e.g. astrologer re-submitting after a
// document_missing requirement, or changing payout bank details).
export async function updateVendor(
  vendorId: string,
  payload: Partial<Omit<CashfreeVendorPayload, 'vendor_id'>>,
): Promise<CashfreeVendorResponse> {
  try {
    const { data } = await axios.patch<CashfreeVendorResponse>(
      `${CASHFREE_EASY_SPLIT_URL}/vendors/${vendorId}`,
      payload,
      { headers: cashfreeHeaders() },
    )
    return data
  } catch (err) {
    handleCashfreeError(err, 'Failed to update vendor details')
  }
}

// GET /pg/easy-split/vendors/:vendor_id — live status/requirements read.
export async function getVendor(vendorId: string): Promise<CashfreeVendorResponse> {
  try {
    const { data } = await axios.get<CashfreeVendorResponse>(
      `${CASHFREE_EASY_SPLIT_URL}/vendors/${vendorId}`,
      { headers: cashfreeHeaders() },
    )
    return data
  } catch (err) {
    if (isAxiosError(err) && err.response?.status === 404) {
      throw BadRequestError('No Cashfree vendor found for this id')
    }
    handleCashfreeError(err, 'Failed to fetch vendor')
  }
}

// POST /pg/easy-split/vendor-docs/:vendor_id — multipart/form-data. Same
// download-then-reupload pattern as the old Razorpay document upload: the
// client hands us an ImageKit URL (this project's convention — see
// posts.service.ts), we fetch the bytes and forward them as the file part.
export async function uploadVendorDocument(
  vendorId: string,
  docType: string,
  docCategory: string,
  fileUrl: string,
): Promise<unknown> {
  let fileBuffer: ArrayBuffer
  let contentType: string
  try {
    const fileRes = await axios.get<ArrayBuffer>(fileUrl, { responseType: 'arraybuffer' })
    fileBuffer = fileRes.data
    contentType = String(fileRes.headers['content-type'] ?? 'application/octet-stream')
  } catch {
    throw BadRequestError(`Could not download document from the provided URL for ${docType}`)
  }

  const filename = fileUrl.split('/').pop()?.split('?')[0] || `${docType}.pdf`
  const form = new FormData()
  form.append('doc_type', docType)
  form.append('doc_category', docCategory)
  form.append('file', new Blob([fileBuffer], { type: contentType }), filename)

  try {
    const { data } = await axios.post(`${CASHFREE_EASY_SPLIT_URL}/vendor-docs/${vendorId}`, form, {
      headers: {
        'x-client-id': env.CASHFREE_APP_ID,
        'x-client-secret': env.CASHFREE_SECRET_KEY,
        'x-api-version': env.CASHFREE_API_VERSION,
      },
    })
    return data
  } catch (err) {
    handleCashfreeError(err, `Failed to upload document (${docType})`)
  }
}

*/
