import type { FastifyReply, FastifyRequest } from 'fastify'
import {
  SaveBirthDetailsSchema,
  GenerateKundliSchema,
  UpdateKundliVisibilitySchema,
} from '../schemas/kundli.schema'
import type { KundliService } from '../services/kundli.service'

export class KundliController {
  constructor(private readonly kundliService: KundliService) {}

  // ─── POST /kundli/birth-details ──────────────────────────────────────────────
  // Edit Profile se birth info save karne ke liye — Kundli generate nahi hota
  saveBirthDetails = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string }
    const dto = SaveBirthDetailsSchema.parse(request.body)
    const result = await this.kundliService.saveBirthDetails(userId, dto)
    return reply.status(200).send(result)
  }

  // ─── POST /kundli/generate ───────────────────────────────────────────────────
  // "Generate My Kundli" button — Kundlit API call + DB save
  // Body optional: agar DB mein pehle se birth details hain toh body ki zarurat nahi
  generateKundli = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string }

    // Body optional — sirf validate karo agar kuch bheja hai
    const dto = Object.keys(request.body as object ?? {}).length > 0
      ? GenerateKundliSchema.parse(request.body)
      : undefined

    const kundli = await this.kundliService.generateKundli(userId, dto)
    return reply.status(200).send({ success: true, kundli })
  }

  // ─── GET /kundli/me ──────────────────────────────────────────────────────────
  // User ka apna kundli fetch karo
  getMyKundli = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string }
    const kundli = await this.kundliService.getMyKundli(userId)

    if (!kundli) {
      return reply.status(404).send({
        error:   'Kundli nahi mili',
        message: 'Pehle "Generate My Kundli" use karo',
        code:    'KUNDLI_NOT_FOUND',
      })
    }
    return reply.status(200).send({ kundli })
  }

  // ─── GET /kundli/share/:token ────────────────────────────────────────────────
  // Public share link — auth required nahi
  getPublicKundli = async (request: FastifyRequest, reply: FastifyReply) => {
    const { token } = request.params as { token: string }
    const kundli = await this.kundliService.getPublicKundli(token)

    if (!kundli) {
      return reply.status(404).send({
        error: 'Kundli nahi mili ya private hai',
        code:  'KUNDLI_NOT_FOUND_OR_PRIVATE',
      })
    }
    return reply.status(200).send({ kundli })
  }

  // ─── PATCH /kundli/visibility ─────────────────────────────────────────────────
  // Kundli public/private toggle
  updateVisibility = async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string }
    const { isPublic } = UpdateKundliVisibilitySchema.parse(request.body)

    const result = await this.kundliService.updateVisibility(userId, isPublic)
    return reply.status(200).send({
      message:   isPublic ? 'Kundli ab public hai' : 'Kundli private kar diya',
      ...result,
    })
  }
}
