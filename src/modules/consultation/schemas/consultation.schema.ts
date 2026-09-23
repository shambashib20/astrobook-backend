import { z } from 'zod'

// ─── Consultation Service ─────────────────────────────────────────────────────
// Koi Premium/Elite tier nahi hai — sirf ek auto-created "Basic" consultancy
// (platform banata hai, koi image nahi) + astrologer ki apni "normal"
// services (name, price, duration, image, about, tags ke saath).

// Explore ke categories jaisi hi tags — kam se kam 1, max 5
export const ServiceTagsSchema = z.array(z.string().min(1)).min(1).max(5)

// Naya "normal" service banate waqt (astrologer khud) — cover image zaroori.
// Duration/price ab is level pe nahi liya jaata — service create hote hi
// 5 fixed duration variants (10/30/45/60/90 min) auto-create ho jaate hain
// default prices ke saath; astrologer baad mein har variant ka price alag
// se edit kar sakta hai (UpdateServiceVariantSchema se).
export const CreateServiceSchema = z.object({
  title: z.string().min(3).max(255),
  shortDescription: z.string().min(10).max(500),
  coverImage: z.string().url('Cover image must be a valid URL'),
  about: z.string().min(20),
  tags: ServiceTagsSchema,
})

// Existing service edit karte waqt (Basic ho ya normal) — sab fields optional
export const UpdateServiceSchema = CreateServiceSchema.partial()

// Backward-compat alias (purane imports ke liye)
export const UpsertServiceSchema = CreateServiceSchema

// ─── Service Variant ───────────────────────────────────────────────────────
// Har service ke 5 fixed duration variants hote hain — sirf price editable
// hai, duration fixed rehta hai (isliye schema mein duration nahi hai).

export const UpdateServiceVariantSchema = z.object({
  price: z.number().positive(),
})

// ─── Availability Window ──────────────────────────────────────────────────────

const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/

export const CreateAvailabilitySchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
    startTime: z.string().regex(timeRegex, 'Start time must be HH:MM (24h)'),
    endTime: z.string().regex(timeRegex, 'End time must be HH:MM (24h)'),
    timezone: z.string().default('Asia/Kolkata'),
  })
  .refine(
    (d) => {
      const [sh = 0, sm = 0] = d.startTime.split(':').map(Number)
      const [eh = 0, em = 0] = d.endTime.split(':').map(Number)
      return sh * 60 + sm < eh * 60 + em
    },
    { message: 'End time must be after start time', path: ['endTime'] },
  )
  .refine(
    (d) => {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      return new Date(d.date) >= today
    },
    { message: 'Availability date cannot be in the past', path: ['date'] },
  )

// ─── Slots Query ──────────────────────────────────────────────────────────────

export const GetSlotsQuerySchema = z.object({
  astrologerId: z.string().uuid(),
  serviceId: z.string().uuid(),
  // Konsa duration variant — slot length isi se decide hoti hai. Optional
  // (backward-compat), default (30-min) variant use ho jaata hai agar diya na ho.
  variantId: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
})

// Explore category detail page — kisi bhi astrologer ki tag wali services
export const BrowseServicesQuerySchema = z.object({
  tag: z.string().min(1),
  limit: z.coerce.number().min(1).max(50).default(20),
  offset: z.coerce.number().min(0).default(0),
})

// ─── Booking ──────────────────────────────────────────────────────────────────

export const CreateBookingSchema = z.object({
  astrologerId: z.string().uuid(),
  serviceId: z.string().uuid(),
  // Kaunsa duration/price variant (10/30/45/60/90 min) book karna hai —
  // optional rakha hai backward-compat ke liye, par booking flow ab hamesha
  // ise bhejta hai (frontend pe default 30-min pre-selected rehta hai).
  variantId: z.string().uuid().optional(),
  scheduledAt: z.string().datetime({ message: 'Must be a valid ISO datetime', offset: true }),
  notes: z.string().max(500).optional(),
})

// ─── Cancel Appointment ───────────────────────────────────────────────────────

export const CancelAppointmentSchema = z.object({
  reason: z.string().max(500).optional(),
})

// ─── Payment ──────────────────────────────────────────────────────────────────

export const CreatePaymentOrderSchema = z.object({
  appointmentId: z.string().uuid(),
})

export const VerifyPaymentSchema = z.object({
  appointmentId: z.string().uuid(),
  razorpayOrderId: z.string(),
  razorpayPaymentId: z.string(),
  razorpaySignature: z.string(),
})

// ─── Session ──────────────────────────────────────────────────────────────────

export const JoinSessionSchema = z.object({
  appointmentId: z.string().uuid(),
})

// ─── Service Request ──────────────────────────────────────────────────────────

export const CreateServiceRequestSchema = z.object({
  parentAppointmentId: z.string().uuid(),
  serviceId: z.string().uuid(),
  proposedSlot: z.string().datetime({ message: 'Must be a valid ISO datetime' }),
})

export const RespondServiceRequestSchema = z.object({
  status: z.enum(['accepted', 'rejected']),
})

// ─── Enums ────────────────────────────────────────────────────────────────────

export const APPOINTMENT_STATUS = [
  'pending', // payment nahi hua
  'confirmed', // payment ho gaya
  'ongoing', // session chal raha hai
  'completed', // session khatam
  'cancelled', // cancel hua
] as const

export const BUNDLE_STATUS = [
  'in_progress', // koi child session ongoing hai
  'paused', // saare current complete, future child pending
  'completed', // sab khatam
] as const

export const SERVICE_REQUEST_STATUS = ['pending', 'accepted', 'rejected', 'expired'] as const
export const PAYMENT_STATUS = ['pending', 'success', 'failed'] as const

// ─── Types ────────────────────────────────────────────────────────────────────

export type CreateServiceDto = z.infer<typeof CreateServiceSchema>
export type UpsertServiceDto = z.infer<typeof CreateServiceSchema>
export type UpdateServiceDto = z.infer<typeof UpdateServiceSchema>
export type UpdateServiceVariantDto = z.infer<typeof UpdateServiceVariantSchema>
export type CreateAvailabilityDto = z.infer<typeof CreateAvailabilitySchema>
export type GetSlotsQueryDto = z.infer<typeof GetSlotsQuerySchema>
export type BrowseServicesQueryDto = z.infer<typeof BrowseServicesQuerySchema>
export type CreateBookingDto = z.infer<typeof CreateBookingSchema>
export type CancelAppointmentDto = z.infer<typeof CancelAppointmentSchema>
export type CreatePaymentOrderDto = z.infer<typeof CreatePaymentOrderSchema>
export type VerifyPaymentDto = z.infer<typeof VerifyPaymentSchema>
export type CreateServiceRequestDto = z.infer<typeof CreateServiceRequestSchema>
export type RespondServiceRequestDto = z.infer<typeof RespondServiceRequestSchema>
export type AppointmentStatus = (typeof APPOINTMENT_STATUS)[number]
export type BundleStatus = (typeof BUNDLE_STATUS)[number]
export type ServiceRequestStatus = (typeof SERVICE_REQUEST_STATUS)[number]
export type PaymentStatus = (typeof PAYMENT_STATUS)[number]
