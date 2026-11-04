import { z } from 'zod'

// ─── Pagination (shared) ───────────────────────────────────────────────────

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

// ─── Users ──────────────────────────────────────────────────────────────────

export const ListUsersQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().optional(), // name / phone / email
  role: z.enum(['user', 'astrologer', 'admin']).optional(),
  isBanned: z.coerce.boolean().optional(),
})
export type ListUsersQueryDto = z.infer<typeof ListUsersQuerySchema>

export const BanUserSchema = z.object({
  isBanned: z.boolean(),
  reason: z.string().max(500).optional(),
})
export type BanUserDto = z.infer<typeof BanUserSchema>

export const UpdateUserRoleSchema = z.object({
  role: z.enum(['user', 'astrologer', 'admin']),
})
export type UpdateUserRoleDto = z.infer<typeof UpdateUserRoleSchema>

// ─── Astrologers / Verification ────────────────────────────────────────────

export const ListAstrologersQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().optional(),
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  // Cashfree Easy Split reconciliation filter — commented out during the
  // Razorpay rollback (kept, not deleted, for a quick re-migration).
  // cashfreeStatus: z.enum(['onboarded', 'not_onboarded']).optional(),
})
export type ListAstrologersQueryDto = z.infer<typeof ListAstrologersQuerySchema>

export const UpdateDocumentsSchema = z.object({
  document1Url: z.string().url().nullable().optional(),
  document2Url: z.string().url().nullable().optional(),
})
export type UpdateDocumentsDto = z.infer<typeof UpdateDocumentsSchema>

export const UpdateVerificationSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']),
  rejectionReason: z.string().max(500).optional(),
})
export type UpdateVerificationDto = z.infer<typeof UpdateVerificationSchema>

export const UpdateCommissionSchema = z.object({
  commissionPercentage: z.number().min(0).max(100),
})
export type UpdateCommissionDto = z.infer<typeof UpdateCommissionSchema>

// ─── Posts (moderation) ────────────────────────────────────────────────────

export const ListPostsQuerySchema = PaginationQuerySchema.extend({
  astrologerId: z.string().uuid().optional(),
  search: z.string().trim().optional(), // content match
})
export type ListPostsQueryDto = z.infer<typeof ListPostsQuerySchema>

export const UpdatePostSchema = z.object({
  content: z.string().min(1).max(2000),
})
export type UpdatePostDto = z.infer<typeof UpdatePostSchema>

// ─── Appointments (admin list) ─────────────────────────────────────────────

export const ListAppointmentsQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(['pending', 'confirmed', 'ongoing', 'completed', 'cancelled']).optional(),
  astrologerId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  dateFrom: z.string().optional(), // YYYY-MM-DD
  dateTo: z.string().optional(),   // YYYY-MM-DD
})
export type ListAppointmentsQueryDto = z.infer<typeof ListAppointmentsQuerySchema>

// ─── Earnings summary (per-astrologer revenue breakdown) ──────────────────

export const EarningsQuerySchema = z.object({
  dateFrom: z.string().optional(), // YYYY-MM-DD
  dateTo: z.string().optional(),   // YYYY-MM-DD
  astrologerId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})
export type EarningsQueryDto = z.infer<typeof EarningsQuerySchema>

// ─── Logs ──────────────────────────────────────────────────────────────────

export const ListLogsQuerySchema = z.object({
  service: z.string().optional(), // e.g. 'db' | 'cron' — omit for all
  level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})
export type ListLogsQueryDto = z.infer<typeof ListLogsQuerySchema>

// ─── Payouts ────────────────────────────────────────────────────────────────

export const ListPayoutsQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(['pending', 'paid', 'failed']).optional(),
  astrologerId: z.string().uuid().optional(),
})
export type ListPayoutsQueryDto = z.infer<typeof ListPayoutsQuerySchema>

export const CreatePayoutSchema = z.object({
  astrologerId: z.string().uuid(),
  amount: z.number().positive(),
  payoutMethod: z.enum(['bank', 'upi']).optional(),
  referenceId: z.string().max(255).optional(),
  notes: z.string().max(1000).optional(),
  periodFrom: z.string().optional(), // ISO date string
  periodTo: z.string().optional(),   // ISO date string
})
export type CreatePayoutDto = z.infer<typeof CreatePayoutSchema>

export const UpdatePayoutStatusSchema = z.object({
  status: z.enum(['paid', 'failed']),
  referenceId: z.string().max(255).optional(),
  notes: z.string().max(1000).optional(),
})
export type UpdatePayoutStatusDto = z.infer<typeof UpdatePayoutStatusSchema>
