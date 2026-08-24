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
