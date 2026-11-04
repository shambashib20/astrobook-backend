import axios from 'axios'

// ─── Kundlit MCP API Service ───────────────────────────────────────────────────
// Free Vedic astrology API — no key, no signup.
// Uses MCP HTTP transport (JSON-RPC 2.0).
// Docs: https://kundlit.com
//
// Har call ek "tool" invoke karta hai. Response mein content[0].text mein
// human-readable text hota hai + structured data bhi hota hai (tool se
// depend karta hai).

const KUNDLIT_BASE_URL = 'https://kundlit.com/api/mcp'

const kundlitClient = axios.create({
  baseURL: KUNDLIT_BASE_URL,
  timeout: 15_000,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  },
})

// ─── MCP Helper ───────────────────────────────────────────────────────────────

let _reqId = 0
async function callTool(toolName: string, args: Record<string, any>): Promise<string> {
  const id = String(++_reqId)
  const response = await kundlitClient.post('', {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  })

  // SSE ya plain JSON — dono handle karo
  const data = response.data
  if (typeof data === 'string') {
    // SSE response — last `data:` line extract karo
    const lines = data.split('\n').filter((l: string) => l.startsWith('data:'))
    for (const line of lines.reverse()) {
      try {
        const parsed = JSON.parse(line.slice(5).trim())
        if (parsed?.result?.content?.[0]?.text) return parsed.result.content[0].text
      } catch {}
    }
    throw new Error(`Kundlit (${toolName}): SSE parse failed`)
  }

  // Plain JSON
  const text = data?.result?.content?.[0]?.text
  if (!text) throw new Error(`Kundlit (${toolName}): empty response`)
  return text as string
}

// ─── Individual Tool Calls ────────────────────────────────────────────────────

export interface KundlitBirthArgs {
  date: string    // YYYY-MM-DD
  time: string    // HH:MM:SS
  place: string   // "Kolkata, West Bengal"
}

/** D1 chart — lagna, 9 grahas, current dasha */
export async function fetchKundali(args: KundlitBirthArgs): Promise<string> {
  return callTool('kundali', args)
}

/** Manglik dosha check */
export async function fetchManglik(args: KundlitBirthArgs): Promise<string> {
  return callTool('manglik', args)
}

/** Kaal Sarp dosha check */
export async function fetchKaalSarp(args: KundlitBirthArgs): Promise<string> {
  return callTool('kaal_sarp', args)
}

/** Shani Sade Sati check */
export async function fetchSadeSati(args: KundlitBirthArgs): Promise<string> {
  return callTool('sade_sati', args)
}

/** Full Vimshottari dasha timeline */
export async function fetchDasha(args: KundlitBirthArgs): Promise<string> {
  return callTool('dasha', args)
}

// ─── Fetch All At Once ────────────────────────────────────────────────────────
// Ek hi birth input se saara data fetch karta hai — parallel calls
// (Promise.allSettled taaki ek fail hone se baaki na ruke)

export interface KundlitFullData {
  kundaliText:  string
  manglikText:  string
  kaalSarpText: string
  sadeSatiText: string
  dashaText:    string
  rawTexts:     Record<string, string>
}

export async function fetchAllKundliData(args: KundlitBirthArgs): Promise<KundlitFullData> {
  const [kundali, manglik, kaalSarp, sadeSati, dasha] = await Promise.allSettled([
    fetchKundali(args),
    fetchManglik(args),
    fetchKaalSarp(args),
    fetchSadeSati(args),
    fetchDasha(args),
  ])

  const get = (r: PromiseSettledResult<string>, fallback = '') =>
    r.status === 'fulfilled' ? r.value : fallback

  const kundaliText  = get(kundali)
  const manglikText  = get(manglik)
  const kaalSarpText = get(kaalSarp)
  const sadeSatiText = get(sadeSati)
  const dashaText    = get(dasha)

  return {
    kundaliText,
    manglikText,
    kaalSarpText,
    sadeSatiText,
    dashaText,
    rawTexts: { kundali: kundaliText, manglik: manglikText, kaalSarp: kaalSarpText, sadeSati: sadeSatiText, dasha: dashaText },
  }
}
