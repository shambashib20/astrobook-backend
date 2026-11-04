import { z } from 'zod'

// ─── Save Birth Details ────────────────────────────────────────────────────────
// Edit Profile → "Birth Details" section — user ye fill karta hai

export const SaveBirthDetailsSchema = z.object({
  birthDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format: YYYY-MM-DD'),
  birthTime:  z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Format: HH:MM ya HH:MM:SS'),
  birthPlace: z.string().min(2).max(255),
  birthLat:   z.number().min(-90).max(90).optional(),
  birthLng:   z.number().min(-180).max(180).optional(),
})
export type SaveBirthDetailsDto = z.infer<typeof SaveBirthDetailsSchema>

// ─── Generate Kundli ───────────────────────────────────────────────────────────
// Internally used — ya same as birth details agar user seedha generate karna
// chahta hai without separate save step

export const GenerateKundliSchema = SaveBirthDetailsSchema
export type GenerateKundliDto = z.infer<typeof GenerateKundliSchema>

// ─── Kundli Response ──────────────────────────────────────────────────────────

export const KundliResponseSchema = z.object({
  id:         z.string().uuid(),
  userId:     z.string().uuid(),

  // Core identity
  lagna:          z.string().nullable(),
  lagnaLord:      z.string().nullable(),
  rashi:          z.string().nullable(),
  rashiLord:      z.string().nullable(),
  sunSign:        z.string().nullable(),
  nakshatra:      z.string().nullable(),
  nakshatraPada:  z.number().nullable(),

  // Dasha
  currentMahadasha:  z.string().nullable(),
  currentAntardasha: z.string().nullable(),
  currentPratyantar: z.string().nullable(),
  mahadashaEndDate:  z.string().nullable(),
  antardashaEndDate: z.string().nullable(),

  // Doshas
  isManglik:      z.boolean(),
  manglikType:    z.string().nullable(),
  hasKaalSarp:    z.boolean(),
  kaalSarpType:   z.string().nullable(),
  sadeSatiActive: z.boolean(),
  sadeSatiEndDate:z.string().nullable(),
  sadeSatiPhase:  z.string().nullable(),

  // Full data
  planetsData:    z.record(z.any()).nullable(),
  housesData:     z.record(z.any()).nullable(),
  dashaTimeline:  z.array(z.any()).nullable(),

  // Sharing
  isPublic:   z.boolean(),
  shareToken: z.string().nullable(),

  // Birth snapshot
  birthDate:  z.string().nullable(),
  birthTime:  z.string().nullable(),
  birthPlace: z.string().nullable(),

  generatedAt: z.string().nullable(),
  updatedAt:   z.string(),
})
export type KundliResponse = z.infer<typeof KundliResponseSchema>

// ─── Update Visibility ─────────────────────────────────────────────────────────

export const UpdateKundliVisibilitySchema = z.object({
  isPublic: z.boolean(),
})
export type UpdateKundliVisibilityDto = z.infer<typeof UpdateKundliVisibilitySchema>
