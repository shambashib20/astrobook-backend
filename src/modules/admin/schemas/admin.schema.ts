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
