import { z } from 'zod'

export const AddCartItemSchema = z.object({
  astrologerId: z.string().uuid(),
  serviceId: z.string().uuid(),
  // Kaunsa duration/price variant cart mein add ho raha hai — optional
  // (backward-compat), agar nahi diya toh service ka default (30-min)
  // variant use ho jaata hai.
  variantId: z.string().uuid().optional(),
})

export const SetCartSlotSchema = z.object({
  scheduledAt: z.string().datetime({ offset: true }),
})

export const CartCheckoutCreateOrderSchema = z.object({
  cartItemIds: z.array(z.string().uuid()).min(1, 'Kam se kam ek item select karo'),
})

// Cashfree's hosted checkout doesn't hand the client a signed payment id
// (razorpayOrderId/PaymentId/Signature — commented out during the
// migration) — confirmation is webhook-driven server-side. The client just
// tells us which order to re-check the status of.
export const CartCheckoutVerifySchema = z.object({
  orderId: z.string(),
})

export type AddCartItemDto = z.infer<typeof AddCartItemSchema>
export type SetCartSlotDto = z.infer<typeof SetCartSlotSchema>
export type CartCheckoutCreateOrderDto = z.infer<typeof CartCheckoutCreateOrderSchema>
export type CartCheckoutVerifyDto = z.infer<typeof CartCheckoutVerifySchema>
