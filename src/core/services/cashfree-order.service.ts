import crypto from 'crypto'
import axios, { isAxiosError } from 'axios'
import { env } from '@/config/env'
import { BadRequestError, InternalError } from '@/core/errors'

// Orders/refunds live directly under /pg (not /pg/easy-split — that prefix
// is only for vendor management, see cashfree-vendor.service.ts). Split
// instructions just ride along on the normal order-create/refund payload.
const CASHFREE_PG_URL = `${env.CASHFREE_API_ENDPOINT}/pg`

function cashfreeHeaders() {
  return {
    'x-client-id': env.CASHFREE_APP_ID,
    'x-client-secret': env.CASHFREE_SECRET_KEY,
    'x-api-version': env.CASHFREE_API_VERSION,
    'Content-Type': 'application/json',
  }
}

export interface CashfreeOrderSplit {
  vendor_id: string
  percentage: number
}

export interface CashfreeCustomerDetails {
  customer_id: string
  customer_email: string
  customer_phone: string
  customer_name: string
}

export interface CreateCashfreeOrderPayload {
  order_id: string
  order_amount: number
  order_currency: string
  customer_details: CashfreeCustomerDetails
  order_note?: string
  order_splits?: CashfreeOrderSplit[]
  order_meta?: {
    return_url?: string
    notify_url?: string
  }
}

export interface CashfreeOrderResponse {
  cf_order_id: string
  order_id: string
  order_status: string
  payment_session_id: string
  order_amount: number
  order_currency: string
  [key: string]: unknown
}

export interface CashfreeRefundSplit {
  vendor_id: string
  amount: number
}

export interface CreateCashfreeRefundPayload {
  refund_amount: number
  refund_id: string
  refund_note?: string
  refund_splits?: CashfreeRefundSplit[]
  refund_speed?: 'STANDARD' | 'INSTANT'
}

export interface CashfreeRefundResponse {
  refund_id: string
  cf_refund_id: string
  refund_status: string
  refund_amount: number
  [key: string]: unknown
}

function handleCashfreeError(err: unknown, fallbackMessage: string): never {
  if (isAxiosError(err)) {
    const message = err.response?.data?.message
    if (err.response && err.response.status < 500) {
      throw BadRequestError(message ?? fallbackMessage)
    }
    throw InternalError(message ?? 'Cashfree is unreachable right now')
  }
  throw err
}

// POST /pg/orders — order_splits here is what replaces Razorpay Route's
// separate transfers step: the split happens automatically at settlement,
// no second API call needed. Returns payment_session_id, which the mobile
// app's CFSession is built from (see react-native-cashfree-pg-sdk usage) —
// there's no client-facing "key_id" the way Razorpay Checkout needed.
export async function createOrder(payload: CreateCashfreeOrderPayload): Promise<CashfreeOrderResponse> {
  try {
    const { data } = await axios.post<CashfreeOrderResponse>(`${CASHFREE_PG_URL}/orders`, payload, {
      headers: cashfreeHeaders(),
    })
    return data
  } catch (err) {
    handleCashfreeError(err, 'Cashfree order creation failed')
  }
}

// GET /pg/orders/:order_id — server-to-server status read. Used as a
// fallback when the client asks "is this done yet" before our webhook has
// landed (webhooks can lag a few seconds behind the checkout SDK's
// onVerify callback).
export async function getOrder(orderId: string): Promise<CashfreeOrderResponse> {
  try {
    const { data } = await axios.get<CashfreeOrderResponse>(`${CASHFREE_PG_URL}/orders/${orderId}`, {
      headers: cashfreeHeaders(),
    })
    return data
  } catch (err) {
    if (isAxiosError(err) && err.response?.status === 404) {
      throw BadRequestError('No Cashfree order found for this id')
    }
    handleCashfreeError(err, 'Failed to fetch order status')
  }
}

// POST /pg/orders/:order_id/refunds — refund_splits mirrors the ORIGINAL
// order's split (pull platformCommissionPercentage/astrologerPayoutAmount
// off the payments row, not the astrologer's current commission — that may
// have changed since the order was placed).
export async function createRefund(
  orderId: string,
  payload: CreateCashfreeRefundPayload,
): Promise<CashfreeRefundResponse> {
  try {
    const { data } = await axios.post<CashfreeRefundResponse>(
      `${CASHFREE_PG_URL}/orders/${orderId}/refunds`,
      payload,
      { headers: cashfreeHeaders() },
    )
    return data
  } catch (err) {
    handleCashfreeError(err, 'Cashfree refund failed')
  }
}

// Cashfree webhook signature: base64(HMAC-SHA256(timestamp + rawBody,
// CASHFREE_SECRET_KEY)), compared against x-webhook-signature. MUST use the
// raw (unparsed) request body — reformatting JSON before hashing produces a
// mismatch even for a legitimate webhook.
export function verifyWebhookSignature(rawBody: string, timestamp: string, signature: string): boolean {
  const expected = crypto
    .createHmac('sha256', env.CASHFREE_SECRET_KEY)
    .update(timestamp + rawBody)
    .digest('base64')

  // Constant-time compare — a naive `===` here leaks timing information
  // about how many leading bytes matched, same reasoning as any HMAC check.
  const expectedBuf = Buffer.from(expected)
  const actualBuf = Buffer.from(signature)
  if (expectedBuf.length !== actualBuf.length) return false
  return crypto.timingSafeEqual(expectedBuf, actualBuf)
}
