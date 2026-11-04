// ─── Kundlit Response Parser ──────────────────────────────────────────────────
// Kundlit API plain text return karta hai — yahan se structured data extract
// karte hain. Regex based hai — agar API ka format badle toh yahan update karo.
//
// Strategy: best-effort parsing. Jo extract ho sake extract karo,
// baaki null rakho — app crash nahi hona chahiye incomplete data pe.

import type { KundlitFullData } from './kundlit-api.service'

export interface ParsedKundli {
  // Core identity
  lagna:           string | null
  lagnaLord:       string | null
  lagnaDegree:     string | null
  rashi:           string | null
  rashiLord:       string | null
  sunSign:         string | null
  nakshatra:       string | null
  nakshatraPada:   number | null

  // Dasha
  currentMahadasha:  string | null
  currentAntardasha: string | null
  currentPratyantar: string | null
  mahadashaEndDate:  string | null
  antardashaEndDate: string | null

  // Doshas
  isManglik:      boolean
  manglikType:    string | null
  hasKaalSarp:    boolean
  kaalSarpType:   string | null
  sadeSatiActive: boolean
  sadeSatiEndDate:string | null
  sadeSatiPhase:  string | null

  // Raw text for full storage
  planetsData:   Record<string, any> | null
  housesData:    Record<string, any> | null
  dashaTimeline: any[] | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extract(text: string, pattern: RegExp): string | null {
  const m = text.match(pattern)
  return m ? (m[1] ?? m[0]).trim() : null
}

function extractBool(text: string, positivePattern: RegExp): boolean {
  return positivePattern.test(text)
}

// ─── Main Parser ──────────────────────────────────────────────────────────────

export function parseKundliData(data: KundlitFullData): ParsedKundli {
  const { kundaliText, manglikText, kaalSarpText, sadeSatiText, dashaText } = data

  // ── Lagna ──
  // e.g. "Lagna: Mesh (Aries)" or "Ascendant: Mesh"
  const lagna = extract(kundaliText, /(?:lagna|ascendant)[:\s]+([A-Za-zऀ-ॿ]+)/i)
  const lagnaLord = extract(kundaliText, /lagna.*?lord[:\s]+([A-Za-zऀ-ॿ]+)/i)
  const lagnaDegree = extract(kundaliText, /lagna.*?(\d+[°°]\s*\d+['′]?)/i)

  // ── Rashi (Moon Sign) ──
  // e.g. "Moon (Chandra): Vrishabh" or "Rashi: Vrishabh"
  const rashi = extract(kundaliText, /(?:moon.*?:|rashi[:\s]+)([A-Za-zऀ-ॿ]+)/i)
  const rashiLord = extract(kundaliText, /rashi.*?lord[:\s]+([A-Za-zऀ-ॿ]+)/i)

  // ── Sun Sign ──
  const sunSign = extract(kundaliText, /sun.*?:\s*([A-Za-zऀ-ॿ]+)/i)

  // ── Nakshatra ──
  // e.g. "Nakshatra: Rohini pada 2" or "Nakshatra: Rohini (pada 2)"
  const nakshatraFull = extract(kundaliText, /nakshatra[:\s]+([A-Za-zऀ-ॿ\s]+)/i)
  const nakshatra = nakshatraFull
    ? nakshatraFull.replace(/\s*pada.*$/i, '').replace(/\s*\(.*\)/, '').trim()
    : null
  const padaStr = extract(kundaliText, /(?:nakshatra.*?pada|pada)[:\s]*(\d)/i)
  const nakshatraPada = padaStr ? parseInt(padaStr) : null

  // ── Dasha ──
  // e.g. "Shani Mahadasha → Rahu Antardasha" or "Current: Shani MD / Rahu AD"
  // ends: "ends: 2027-03-15" or "end date: 15 Mar 2027"
  const currentMahadasha = extract(
    dashaText || kundaliText,
    /(?:current.*?mahadasha|mahadasha)[:\s→\-]+([A-Za-zऀ-ॿ]+)/i,
  )
  const currentAntardasha = extract(
    dashaText || kundaliText,
    /(?:antardasha|AD)[:\s→\-]+([A-Za-zऀ-ॿ]+)/i,
  )
  const currentPratyantar = extract(
    dashaText || kundaliText,
    /(?:pratyantar|PD)[:\s→\-]+([A-Za-zऀ-ॿ]+)/i,
  )
  // Date patterns: "2027-03-15" or "15 Mar 2027" or "March 15, 2027"
  const mahadashaEndDate = extract(
    dashaText || kundaliText,
    /mahadasha.*?end(?:s|ing)?[:\s]+(\d{4}-\d{2}-\d{2}|\d{1,2}\s+\w+\s+\d{4})/i,
  )
  const antardashaEndDate = extract(
    dashaText || kundaliText,
    /antardasha.*?end(?:s|ing)?[:\s]+(\d{4}-\d{2}-\d{2}|\d{1,2}\s+\w+\s+\d{4})/i,
  )

  // ── Manglik ──
  // "Manglik: Yes" / "is Manglik" / "not Manglik" / "Anshik Manglik"
  const isManglik = extractBool(manglikText, /\b(?:is manglik|manglik[:\s]+yes|manglik dosha[:\s]+yes|anshik manglik)\b/i)
    && !extractBool(manglikText, /not manglik|no manglik dosha/i)
  const manglikType = isManglik
    ? (extractBool(manglikText, /anshik|partial/i) ? 'partial' : 'full')
    : null

  // ── Kaal Sarp ──
  const hasKaalSarp = extractBool(kaalSarpText, /kaal sarp dosha[:\s]+(?:present|yes|true)/i)
    && !extractBool(kaalSarpText, /not present|absent|no kaal sarp/i)
  // Type: "Anant Kaal Sarp", "Kulik Kaal Sarp", etc.
  const kaalSarpType = hasKaalSarp
    ? extract(kaalSarpText, /\b(Anant|Kulik|Vasuki|Shankhapal|Padma|Mahapadma|Takshak|Karkotak|Shankhnaad|Patak|Vishakata|Sheshnag)\b/i)
    : null

  // ── Sade Sati ──
  const sadeSatiActive = extractBool(sadeSatiText, /sade sati[:\s]+(?:active|yes|true|running|currently)/i)
    && !extractBool(sadeSatiText, /not active|inactive|no sade sati/i)
  const sadeSatiEndDate = extract(
    sadeSatiText,
    /(?:ends?|end date)[:\s]+(\d{4}-\d{2}-\d{2}|\d{1,2}\s+\w+\s+\d{4})/i,
  )
  const sadeSatiPhase = extract(sadeSatiText, /phase[:\s]+(rising|peak|setting)/i)

  // ── Planets (structured best-effort) ──
  // Store as { graha: { sign, house, nakshatra, dignity } }
  const planetsData = parsePlanets(kundaliText)
  const housesData = parseHouses(kundaliText)
  const dashaTimeline = parseDashaTimeline(dashaText)

  return {
    lagna, lagnaLord, lagnaDegree,
    rashi, rashiLord, sunSign,
    nakshatra, nakshatraPada,
    currentMahadasha, currentAntardasha, currentPratyantar,
    mahadashaEndDate, antardashaEndDate,
    isManglik, manglikType,
    hasKaalSarp, kaalSarpType,
    sadeSatiActive, sadeSatiEndDate, sadeSatiPhase,
    planetsData, housesData, dashaTimeline,
  }
}

// ─── Sub-parsers ──────────────────────────────────────────────────────────────

const GRAHAS = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn', 'Rahu', 'Ketu',
                'Surya', 'Chandra', 'Mangal', 'Budh', 'Guru', 'Shukra', 'Shani']

function parsePlanets(text: string): Record<string, any> | null {
  if (!text) return null
  const result: Record<string, any> = {}
  const lines = text.split('\n')
  for (const line of lines) {
    for (const graha of GRAHAS) {
      if (line.toLowerCase().includes(graha.toLowerCase())) {
        const sign    = extract(line, /:\s*([A-Za-zऀ-ॿ]+)/)
        const house   = extract(line, /house[:\s]+(\d+)/i)
        const naksh   = extract(line, /nakshatra[:\s]+([A-Za-zऀ-ॿ]+)/i)
        const dignity = extract(line, /\b(Exalted|Debilitated|Own Sign|Friendly|Neutral|Enemy)\b/i)
        if (sign) {
          result[graha] = { sign, house, nakshatra: naksh, dignity, raw: line.trim() }
          break
        }
      }
    }
  }
  return Object.keys(result).length > 0 ? result : null
}

function parseHouses(text: string): Record<string, any> | null {
  if (!text) return null
  const result: Record<string, any> = {}
  const housePattern = /house\s+(\d+)\s*[:\-]\s*([A-Za-zऀ-ॿ]+)/gi
  let m: RegExpExecArray | null
  while ((m = housePattern.exec(text)) !== null) {
    result[`house${m[1]}`] = { sign: m[2], raw: m[0] }
  }
  return Object.keys(result).length > 0 ? result : null
}

function parseDashaTimeline(text: string): any[] | null {
  if (!text) return null
  const lines = text.split('\n').filter(l => l.trim())
  const timeline: any[] = []
  for (const line of lines) {
    // e.g. "Shani Mahadasha: 2018-03-15 to 2037-03-15"
    const m = line.match(/([A-Za-zऀ-ॿ]+)\s+(?:mahadasha|MD)[:\s]+(\d{4}-\d{2}-\d{2})\s+(?:to|-)\s+(\d{4}-\d{2}-\d{2})/i)
    if (m) {
      timeline.push({ planet: m[1], start: m[2], end: m[3], raw: line.trim() })
    }
  }
  return timeline.length > 0 ? timeline : null
}
