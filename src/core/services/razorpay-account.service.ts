import crypto from 'crypto'
import axios, { isAxiosError } from 'axios'
import { env } from '@/config/env'
import { BadRequestError, InternalError } from '@/core/errors'

// Base + version come from env (RAZORPAY_API_ENDPOINT / RAZORPAY_API_VERSION_2)
// instead of being hardcoded, so switching Razorpay API versions/hosts
// doesn't need a code change.
const RAZORPAY_ACCOUNTS_URL = `${env.RAZORPAY_API_ENDPOINT}/${env.RAZORPAY_API_VERSION_2}/accounts`

// Razorpay caps reference_id at 20 characters, so a raw UUID (36 chars) or
// full ISO timestamp doesn't fit. "ast_YYMMDD_xxxx" (15 chars) stays under
// that cap, reads as a creation date on Razorpay's own dashboard, and the
// 4-char random suffix (16 bits) keeps two accounts made the same day from
// colliding. Generate this ONCE per profile and persist it — idempotency
// against double-registration comes from the caller checking
// profile.razorpayAccountId before ever calling this, not from this id
// being deterministic.
export function generateRazorpayReferenceId(): string {
  const now = new Date()
  const yy = String(now.getUTCFullYear()).slice(2)
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(now.getUTCDate()).padStart(2, '0')
  const suffix = crypto.randomBytes(2).toString('hex')
  return `ast_${yy}${mm}${dd}_${suffix}`
}

export interface RazorpayAccountAddress {
  street1: string
  street2?: string
  city: string
  state: string
  postal_code: string
  country: string
}

export interface CreateRazorpayAccountPayload {
  email: string
  phone: string
  legal_business_name: string
  business_type: string
  contact_name: string
  reference_id: string
  profile: {
    category: string
    subcategory: string
    addresses: {
      registered: RazorpayAccountAddress
    }
  }
}

export interface RazorpayAccountResponse {
  id: string
  type: string
  status: string
  email: string
  phone: string
  contact_name: string
  reference_id: string
  business_type: string
  legal_business_name: string
  customer_facing_business_name?: string
  profile: CreateRazorpayAccountPayload['profile']
  notes: unknown[]
  created_at: number
}

// Route "linked account" creation — separate from the orders/payments API
// (see payment.service.ts), so it doesn't go through the `razorpay` SDK,
// which doesn't cover the v2 Accounts endpoints. Same key_id/key_secret,
// just plain Basic Auth over axios instead.
export async function createRazorpayAccount(
  payload: CreateRazorpayAccountPayload,
): Promise<RazorpayAccountResponse> {
  try {
    const { data } = await axios.post<RazorpayAccountResponse>(
      RAZORPAY_ACCOUNTS_URL,
      {
        email: payload.email,
        phone: payload.phone,
        type: 'route',
        reference_id: payload.reference_id,
        legal_business_name: payload.legal_business_name,
        business_type: payload.business_type,
        contact_name: payload.contact_name,
        profile: payload.profile,
      },
      {
        auth: {
          username: env.RAZORPAY_KEY_ID,
          password: env.RAZORPAY_KEY_SECRET,
        },
        headers: { 'Content-Type': 'application/json' },
      },
    )
    return data
  } catch (err) {
    if (isAxiosError(err)) {
      const razorpayMessage = err.response?.data?.error?.description
      if (err.response && err.response.status < 500) {
        throw BadRequestError(razorpayMessage ?? 'Razorpay account creation failed')
      }
      throw InternalError(razorpayMessage ?? 'Razorpay is unreachable right now')
    }
    throw err
  }
}

export interface RazorpayProductRequirement {
  field_reference: string
  resolution_url: string
  reason_code: string
  status: string
}

export interface RazorpayProductResponse {
  id: string
  account_id: string
  product_name: string
  activation_status: string
  requested_configuration: unknown[]
  active_configuration: {
    settlements?: {
      account_number: string | null
      beneficiary_name: string | null
      ifsc_code: string | null
    }
  }
  requirements: RazorpayProductRequirement[]
  tnc: { id: string; accepted: boolean; accepted_at: number }
  requested_at: number
}

// Razorpay's fraud heuristic (SPAM_DETECTED_ERROR) fires on account/product
// requests that look synthetic — "test"/"demo" in the email domain or
// business name being the most common trigger. It's evaluated entirely on
// Razorpay's side, so this is a hint surfaced back to the caller, not
// something retried automatically.
function isSpamDetectedError(err: unknown): boolean {
  return (
    isAxiosError(err) &&
    (err.response?.data?.error?.code === 'SPAM_DETECTED_ERROR' ||
      err.response?.data?.error?.reason === 'SPAM_DETECTED_ERROR')
  )
}

// POST /v2/accounts/:id/products — second step of Route onboarding, always
// called right after account creation. Response comes back with
// activation_status: 'needs_clarification' and a requirements[] list (here,
// the settlements.* fields) until submitBankDetails below fills them in.
export async function requestRouteProduct(accountId: string): Promise<RazorpayProductResponse> {
  try {
    const { data } = await axios.post<RazorpayProductResponse>(
      `${RAZORPAY_ACCOUNTS_URL}/${accountId}/products`,
      { product_name: 'route', tnc_accepted: true },
      {
        auth: {
          username: env.RAZORPAY_KEY_ID,
          password: env.RAZORPAY_KEY_SECRET,
        },
        headers: { 'Content-Type': 'application/json' },
      },
    )
    return data
  } catch (err) {
    if (isSpamDetectedError(err)) {
      throw BadRequestError(
        'Razorpay flagged this account as spam — this usually happens with obviously-fake test data (e.g. a "test.com" email or a business name containing "test"). Use realistic-looking details and try again.',
      )
    }
    if (isAxiosError(err)) {
      const razorpayMessage = err.response?.data?.error?.description
      if (err.response && err.response.status < 500) {
        throw BadRequestError(razorpayMessage ?? 'Failed to set up Razorpay Route product')
      }
      throw InternalError(razorpayMessage ?? 'Razorpay is unreachable right now')
    }
    throw err
  }
}

// PATCH /v2/accounts/:id/products/:productId — submits bank account details
// (settlements) against the product created above. On success,
// activation_status moves toward 'activated' (may still show other
// requirements depending on account type/category).
export async function updateRouteProductSettlements(
  accountId: string,
  productId: string,
  settlements: { account_number: string; ifsc_code: string; beneficiary_name: string },
): Promise<RazorpayProductResponse> {
  try {
    const { data } = await axios.patch<RazorpayProductResponse>(
      `${RAZORPAY_ACCOUNTS_URL}/${accountId}/products/${productId}`,
      { settlements, tnc_accepted: true },
      {
        auth: {
          username: env.RAZORPAY_KEY_ID,
          password: env.RAZORPAY_KEY_SECRET,
        },
        headers: { 'Content-Type': 'application/json' },
      },
    )
    return data
  } catch (err) {
    if (isSpamDetectedError(err)) {
      throw BadRequestError(
        'Razorpay flagged this account as spam — this usually happens with obviously-fake test data. Use realistic-looking details and try again.',
      )
    }
    if (isAxiosError(err)) {
      const razorpayMessage = err.response?.data?.error?.description
      if (err.response && err.response.status < 500) {
        throw BadRequestError(razorpayMessage ?? 'Failed to save bank account details')
      }
      throw InternalError(razorpayMessage ?? 'Razorpay is unreachable right now')
    }
    throw err
  }
}

export interface RazorpayStakeholderPayload {
  name: string
  email: string
  percentage_ownership?: number
  relationship?: { director?: boolean; executive?: boolean }
  phone?: { primary?: number; secondary?: number }
  addresses?: {
    residential?: {
      street: string
      city: string
      state: string
      postal_code: string
      country: string
    }
  }
  kyc?: { pan?: string }
}

export interface RazorpayStakeholderResponse {
  id: string
  entity: string
  name: string
  email: string
  percentage_ownership?: number
  relationship?: { director?: boolean; executive?: boolean }
  phone?: { primary?: number; secondary?: number }
  addresses?: unknown
  kyc?: { pan?: string }
}

// POST /v2/accounts/:id/stakeholders — Route allows exactly one stakeholder
// per account. Carries the individual's KYC (PAN) + contact/address, which
// account creation itself doesn't collect.
export async function createStakeholder(
  accountId: string,
  payload: RazorpayStakeholderPayload,
): Promise<RazorpayStakeholderResponse> {
  try {
    const { data } = await axios.post<RazorpayStakeholderResponse>(
      `${RAZORPAY_ACCOUNTS_URL}/${accountId}/stakeholders`,
      payload,
      {
        auth: {
          username: env.RAZORPAY_KEY_ID,
          password: env.RAZORPAY_KEY_SECRET,
        },
        headers: { 'Content-Type': 'application/json' },
      },
    )
    return data
  } catch (err) {
    if (isSpamDetectedError(err)) {
      throw BadRequestError(
        'Razorpay flagged this account as spam — this usually happens with obviously-fake test data. Use realistic-looking details and try again.',
      )
    }
    if (isAxiosError(err)) {
      const razorpayMessage = err.response?.data?.error?.description
      if (err.response && err.response.status < 500) {
        throw BadRequestError(razorpayMessage ?? 'Failed to create stakeholder')
      }
      throw InternalError(razorpayMessage ?? 'Razorpay is unreachable right now')
    }
    throw err
  }
}

// Valid document_type values Razorpay accepts on the upload endpoint below —
// narrowed to what an individual astrologer's onboarding actually needs
// (business/PAN proof + bank proof). Extend if a requirement asks for one
// of the business-entity-only types (gst_certificate, msme_certificate, etc).
export type RazorpayDocumentType =
  | 'business_proof_url'
  | 'business_pan_url'
  | 'cancelled_cheque'
  | 'shop_establishment_certificate'
  | 'gst_certificate'
  | 'msme_certificate'
  | 'form_12_a_url'
  | 'form_80g_url'

// POST /v2/accounts/:id/documents — multipart/form-data. We don't accept
// raw file uploads on our own API (this project's convention is client
// uploads to ImageKit first and hands us a URL — see posts.service.ts), so
// this downloads the file from that URL and re-uploads the bytes to
// Razorpay as the multipart body.
export async function uploadAccountDocument(
  accountId: string,
  documentType: RazorpayDocumentType,
  fileUrl: string,
): Promise<unknown> {
  let fileBuffer: ArrayBuffer
  let contentType: string
  try {
    const fileRes = await axios.get<ArrayBuffer>(fileUrl, { responseType: 'arraybuffer' })
    fileBuffer = fileRes.data
    contentType = String(fileRes.headers['content-type'] ?? 'application/octet-stream')
  } catch {
    throw BadRequestError(`Could not download document from the provided URL for ${documentType}`)
  }

  const filename = fileUrl.split('/').pop()?.split('?')[0] || `${documentType}.pdf`
  const form = new FormData()
  form.append('file', new Blob([fileBuffer], { type: contentType }), filename)
  form.append('document_type', documentType)

  try {
    const { data } = await axios.post(`${RAZORPAY_ACCOUNTS_URL}/${accountId}/documents`, form, {
      auth: {
        username: env.RAZORPAY_KEY_ID,
        password: env.RAZORPAY_KEY_SECRET,
      },
    })
    return data
  } catch (err) {
    if (isAxiosError(err)) {
      const razorpayMessage = err.response?.data?.error?.description
      if (err.response && err.response.status < 500) {
        throw BadRequestError(razorpayMessage ?? `Failed to upload document (${documentType})`)
      }
      throw InternalError(razorpayMessage ?? 'Razorpay is unreachable right now')
    }
    throw err
  }
}

// GET /v2/accounts/:id — live account details (status, KYC progress, etc.)
// for an account already created via createRazorpayAccount above. Same
// Basic Auth, no request body.
export async function getRazorpayAccount(accountId: string): Promise<RazorpayAccountResponse> {
  try {
    const { data } = await axios.get<RazorpayAccountResponse>(
      `${RAZORPAY_ACCOUNTS_URL}/${accountId}`,
      {
        auth: {
          username: env.RAZORPAY_KEY_ID,
          password: env.RAZORPAY_KEY_SECRET,
        },
      },
    )
    return data
  } catch (err) {
    if (isAxiosError(err)) {
      const razorpayMessage = err.response?.data?.error?.description
      if (err.response?.status === 404) {
        throw BadRequestError('No Razorpay account found for this id')
      }
      if (err.response && err.response.status < 500) {
        throw BadRequestError(razorpayMessage ?? 'Failed to fetch Razorpay account')
      }
      throw InternalError(razorpayMessage ?? 'Razorpay is unreachable right now')
    }
    throw err
  }
}
