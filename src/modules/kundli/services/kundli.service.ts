// ─── Kundli Service ────────────────────────────────────────────────────────────
// Orchestrates: birth data save → Kundlit API call → parse → DB upsert
// Yahan business logic hai — API aur DB ke beech bridge.

import type { FastifyBaseLogger } from 'fastify'
import type { KundliRepository } from '../repositories/kundli.repository'
import type { UserRepository } from '../../users/repositories/user.repository'
import { fetchAllKundliData } from './kundlit-api.service'
import { parseKundliData } from './kundli-parser.service'
import type { SaveBirthDetailsDto, GenerateKundliDto } from '../schemas/kundli.schema'

export class KundliService {
  constructor(
    private readonly kundliRepo: KundliRepository,
    private readonly userRepo: UserRepository,
    private readonly log: FastifyBaseLogger,
  ) {}

  // ─── Save Birth Details ──────────────────────────────────────────────────────
  // Sirf birth info save karta hai users table mein — Kundli generate NAHI karta.
  // App pe "Save" button alag hoga "Generate Kundli" button se.

  async saveBirthDetails(userId: string, dto: SaveBirthDetailsDto) {
    const updated = await this.userRepo.updateProfile(userId, {
      dateOfBirth: dto.birthDate,
      birthTime:   dto.birthTime,
      birthPlace:  dto.birthPlace,
      birthLat:    dto.birthLat,
      birthLng:    dto.birthLng,
    } as any)

    if (!updated) throw new Error('User not found')
    return {
      message: 'Birth details saved',
      user: {
        dateOfBirth: updated.dateOfBirth,
        birthTime:   (updated as any).birthTime,
        birthPlace:  (updated as any).birthPlace,
      },
    }
  }

  // ─── Generate Kundli ─────────────────────────────────────────────────────────
  // 1. User ki birth info lo (DB ya request se)
  // 2. Kundlit API call karo (parallel — 5 tools)
  // 3. Parse karo text responses
  // 4. DB mein upsert karo
  // 5. Parsed data return karo

  async generateKundli(userId: string, dto?: GenerateKundliDto) {
    // Birth details: request se hai toh woh lo, warna user DB se
    let birthDate: string, birthTime: string, birthPlace: string
    let birthLat: number | undefined, birthLng: number | undefined

    if (dto?.birthDate && dto?.birthTime && dto?.birthPlace) {
      birthDate  = dto.birthDate
      birthTime  = dto.birthTime
      birthPlace = dto.birthPlace
      birthLat   = dto.birthLat
      birthLng   = dto.birthLng
    } else {
      const user = await this.userRepo.findById(userId)
      if (!user) throw new Error('User not found')

      if (!(user as any).birthTime || !(user as any).birthPlace || !user.dateOfBirth) {
        throw new Error('Pehle apni birth details save karo (DOB, time, aur place)')
      }

      birthDate  = typeof user.dateOfBirth === 'string'
        ? user.dateOfBirth
        : (user.dateOfBirth as Date).toISOString().split('T')[0]!
      birthTime  = (user as any).birthTime
      birthPlace = (user as any).birthPlace
      birthLat   = (user as any).birthLat ? parseFloat((user as any).birthLat) : undefined
      birthLng   = (user as any).birthLng ? parseFloat((user as any).birthLng) : undefined
    }

    this.log.info({ userId, birthDate, birthTime, birthPlace }, 'Kundli generate karna shuru')

    // ── API call (parallel 5 tools) ──────────────────────────────────────────
    // KundlitBirthArgs: { date: 'YYYY-MM-DD', time: 'HH:MM:SS', place: string }
    const timeNormalized = birthTime.length === 5 ? `${birthTime}:00` : birthTime
    const apiArgs = { date: birthDate, time: timeNormalized, place: birthPlace }
    const rawData = await fetchAllKundliData(apiArgs)

    this.log.info({
      userId,
      kundaliOk:  !!rawData.kundaliText,
      manglikOk:  !!rawData.manglikText,
      kaalSarpOk: !!rawData.kaalSarpText,
      sadeSatiOk: !!rawData.sadeSatiText,
      dashaOk:    !!rawData.dashaText,
    }, 'Kundlit API responses mili')

    // ── Parse ────────────────────────────────────────────────────────────────
    const parsed = parseKundliData(rawData)

    // ── Full raw data store karo ─────────────────────────────────────────────
    const fullKundliData = {
      kundali:  rawData.kundaliText,
      manglik:  rawData.manglikText,
      kaalSarp: rawData.kaalSarpText,
      sadeSati: rawData.sadeSatiText,
      dasha:    rawData.dashaText,
      rawTexts: rawData.rawTexts,
    }

    // ── DB upsert ────────────────────────────────────────────────────────────
    const kundli = await this.kundliRepo.upsert({
      userId,
      // Core identity
      lagna:          parsed.lagna,
      lagnaLord:      parsed.lagnaLord,
      lagnaDegree:    parsed.lagnaDegree,
      rashi:          parsed.rashi,
      rashiLord:      parsed.rashiLord,
      sunSign:        parsed.sunSign,
      nakshatra:      parsed.nakshatra,
      nakshatraPada:  parsed.nakshatraPada,
      // Dasha
      currentMahadasha:  parsed.currentMahadasha,
      currentAntardasha: parsed.currentAntardasha,
      currentPratyantar: parsed.currentPratyantar,
      mahadashaEndDate:  parsed.mahadashaEndDate,
      antardashaEndDate: parsed.antardashaEndDate,
      // Doshas
      isManglik:      parsed.isManglik,
      manglikType:    parsed.manglikType,
      hasKaalSarp:    parsed.hasKaalSarp,
      kaalSarpType:   parsed.kaalSarpType,
      sadeSatiActive: parsed.sadeSatiActive,
      sadeSatiEndDate:parsed.sadeSatiEndDate,
      sadeSatiPhase:  parsed.sadeSatiPhase,
      // Json blobs
      planetsData:    parsed.planetsData ?? undefined,
      housesData:     parsed.housesData ?? undefined,
      dashaTimeline:  parsed.dashaTimeline ?? undefined,
      fullKundliData,
      // Birth snapshot
      birthDate,
      birthTime,
      birthPlace,
      birthLat:    birthLat?.toString(),
      birthLng:    birthLng?.toString(),
      generatedAt: new Date(),
    })

    this.log.info({ userId, kundliId: kundli.id }, 'Kundli successfully generate hua')

    return this.formatKundliResponse(kundli)
  }

  // ─── Get My Kundli ───────────────────────────────────────────────────────────

  async getMyKundli(userId: string) {
    const kundli = await this.kundliRepo.findByUserId(userId)
    if (!kundli) return null
    return this.formatKundliResponse(kundli)
  }

  // ─── Get Public Kundli (share link) ─────────────────────────────────────────

  async getPublicKundli(shareToken: string) {
    const kundli = await this.kundliRepo.findByShareToken(shareToken)
    if (!kundli) return null
    return this.formatKundliResponse(kundli)
  }

  // ─── Toggle Visibility ───────────────────────────────────────────────────────

  async updateVisibility(userId: string, isPublic: boolean) {
    const kundli = await this.kundliRepo.updateVisibility(userId, isPublic)
    if (!kundli) throw new Error('Kundli nahi mili — pehle generate karo')
    return {
      isPublic: kundli.isPublic,
      shareToken: isPublic ? kundli.shareToken : null,
      shareUrl:   isPublic ? `/kundli/share/${kundli.shareToken}` : null,
    }
  }

  // ─── Format Response ─────────────────────────────────────────────────────────
  // Sensitive full JSON blob frontend pe directly nahi jaata except
  // planets/houses/dasha — woh UI ke liye useful hain.

  private formatKundliResponse(kundli: any) {
    // Doshas — jo relevant hain woh front-end pe concerns ke liye
    const doshas: Array<{ name: string; type?: string | null; active: boolean; detail?: string }> = []
    if (kundli.isManglik) {
      doshas.push({
        name:   'Manglik Dosha',
        type:   kundli.manglikType,
        active: true,
        detail: kundli.manglikType === 'partial'
          ? 'Anshik Manglik — moderate prabhav'
          : 'Poorna Manglik — vivah mein dhyan rakhe',
      })
    }
    if (kundli.hasKaalSarp) {
      doshas.push({
        name:   'Kaal Sarp Dosha',
        type:   kundli.kaalSarpType,
        active: true,
        detail: kundli.kaalSarpType
          ? `${kundli.kaalSarpType} Kaal Sarp Yoga`
          : 'Saare grahas Rahu-Ketu ke beech hain',
      })
    }
    if (kundli.sadeSatiActive) {
      doshas.push({
        name:   'Shani Sade Sati',
        active: true,
        detail: kundli.sadeSatiPhase
          ? `${kundli.sadeSatiPhase} phase mein hai`
          : 'Shani ki saadhe saati chal rahi hai',
      })
    }

    return {
      id:         kundli.id,
      generatedAt:kundli.generatedAt,
      // Core chart
      chart: {
        lagna:         kundli.lagna,
        lagnaLord:     kundli.lagnaLord,
        lagnaDegree:   kundli.lagnaDegree,
        rashi:         kundli.rashi,
        rashiLord:     kundli.rashiLord,
        sunSign:       kundli.sunSign,
        nakshatra:     kundli.nakshatra,
        nakshatraPada: kundli.nakshatraPada,
      },
      // Current planetary period
      dasha: {
        mahadasha:    kundli.currentMahadasha,
        antardasha:   kundli.currentAntardasha,
        pratyantar:   kundli.currentPratyantar,
        mahadashaEnds:kundli.mahadashaEndDate,
        antardashaEnds:kundli.antardashaEndDate,
        timeline:     kundli.dashaTimeline,
      },
      // Doshas list
      doshas,
      hasDoshas: doshas.length > 0,
      // Planets and houses
      planets: kundli.planetsData,
      houses:  kundli.housesData,
      // Birth snapshot
      birth: {
        date:  kundli.birthDate,
        time:  kundli.birthTime,
        place: kundli.birthPlace,
      },
      // Sharing
      isPublic:   kundli.isPublic,
      shareToken: kundli.isPublic ? kundli.shareToken : null,
      shareUrl:   kundli.isPublic ? `/kundli/share/${kundli.shareToken}` : null,
    }
  }
}
