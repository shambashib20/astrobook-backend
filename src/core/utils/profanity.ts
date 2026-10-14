/**
 * Profanity filter — powered by leo-profanity (English word list)
 * plus an extended Hindi / Hinglish word list.
 *
 * Strategy:
 *  1. Pull leo-profanity's maintained English list at module load.
 *  2. Merge with our Hindi/Hinglish list.
 *  3. Normalise leet-speak before matching so "f@ck", "sh1t", etc. are caught.
 *  4. Use word-boundary regex to avoid false positives ("class" ≠ "ass").
 *  5. Return matched terms so callers can surface them in error messages.
 *
 * Sync this file with admin-panel/src/lib/profanity.ts whenever you edit it.
 */

// leo-profanity ships no TypeScript types — shim the parts we use.
/* eslint-disable @typescript-eslint/no-require-imports */
const leoProfanity = require('leo-profanity') as {
  list: () => string[]
}

// ─── Hindi / Hinglish word list ───────────────────────────────────────────────

const HINDI_WORDS: string[] = [
  // ── Tier-1: most common abuses ──────────────────────────────────────────────
  'madarchod', 'maderchod', 'madarjaat', 'madarlod', 'maa ka bhosda',
  'maa ki aankh', 'teri maa', 'teri maa ki', 'maa ki aankh',
  'behenchod', 'behnchod', 'bhenchod', 'benchod', 'bencho', 'bhen ke laude',
  'chutiya', 'chutiye', 'chut', 'choot', 'chootiya',
  'gaandu', 'gandu', 'gaand', 'gand',
  'bhosdike', 'bhosdi', 'bhosadike', 'bhosdiwale', 'bhosad',
  'loda', 'lauda', 'lund', 'lavda', 'lodi', 'lun',
  'randi', 'raand', 'randwe', 'randi ka bacha', 'randi ki aulad',
  'harami', 'haramzada', 'haramkhor', 'haramjada', 'haramjadi', 'haramkhor',

  // ── Tier-2: strong abuses ────────────────────────────────────────────────────
  'bhadwa', 'bhadwi', 'bhadwe',           // pimp / prostitute
  'chakka', 'chhakka',                    // derogatory for trans/eunuch
  'hijra',                                // derogatory when used as insult
  'jhant', 'jhantu', 'jhantoo',
  'kamina', 'kamine', 'kamini',
  'bakchod', 'bakchodi', 'bakchodiya', 'bakchodon',
  'chodu', 'chod', 'chodna', 'chodoge', 'chodega',
  'besharam',
  'kutte', 'kutti', 'kutiya', 'kutta ki aulad', 'kuttiya',
  'saala', 'saali', 'saale', 'sala', 'sali',
  'tatti', 'tattu',                       // shit / worthless
  'ullu', 'ullu ka pattha', 'ullupan',
  'kameena', 'kameeni',

  // ── Tier-3: chat abbreviations ───────────────────────────────────────────────
  // (short but context-specific — keep word-boundary so "bc" alone is caught)
  'mc',       // madarchod
  'bc',       // behenchod
  'bkl',      // behenchod ke laude
  'bklol',
  'mkl',
  'mklc',
  'lmc',
  'mmc',

  // ── Tier-4: additional slang / regional ─────────────────────────────────────
  'raand',
  'lounda', 'laundebaaz', 'laundiya',
  'goo',                                  // shit (mild, but still profane)
  'gadha',                                // donkey (commonly used as insult)
  'suar', 'suwar',                        // pig (used as insult)
  'nalayak',
  'nikamma',
  'bhadwi',
  'kanjri', 'kanjri ka',
  'maa chod', 'behen chod', 'baap chod',
  'land', 'landwa',
  'phuddu', 'fuddu',
  'jhandu',
  'chaman', 'chaman choot',
  'bkwas', 'bakwas',                      // nonsense (mild but often used rudely)
  'takla',                                // bald (used as insult)
  'mote',                                 // fat (used as insult)
  'kala',                                 // dark-skinned (used as slur)
  'lafanga',
  'badmash',
  'ghatiya',
  'bhand',
  'pendu',
  'lawda',                               // alternate spelling of lauda
  'madarc',
  'behenc',
  'bhosdk',
]

// ─── Leet-speak normalisation ─────────────────────────────────────────────────

const LEET_MAP: Array<[RegExp, string]> = [
  [/[@4]/g, 'a'],
  [/3/g, 'e'],
  [/[1!|]/g, 'i'],
  [/0/g, 'o'],
  [/[$5]/g, 's'],
  [/7/g, 't'],
  [/[/\\]/g, 'l'],
  [/[)(]/g, ''],
]

function normalise(text: string): string {
  let t = text.toLowerCase()
  for (const [pattern, replacement] of LEET_MAP) {
    t = t.replace(pattern, replacement)
  }
  // collapse triple+ repeated chars  fuuuck → fuck
  t = t.replace(/(.)\1{2,}/g, '$1$1')
  return t
}

// ─── Build combined word list ─────────────────────────────────────────────────
// leo-profanity's English list + our Hindi list, de-duped.

const ALL_WORDS = [...new Set([...leoProfanity.list(), ...HINDI_WORDS])]

// Pre-compile one regex per term once at startup, not per request.
// Multi-word phrases skip \b because spaces already delimit them.
const COMPILED = ALL_WORDS.map((term) => {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = term.includes(' ') ? escaped : `\\b${escaped}\\b`
  return { term, re: new RegExp(pattern, 'i') }
})

// ─── Public API ───────────────────────────────────────────────────────────────

export interface ProfanityCheckResult {
  clean: boolean
  /** De-duped list of matched bad words — shown in error messages / admin UI. */
  matches: string[]
}

export function checkProfanity(text: string): ProfanityCheckResult {
  if (!text?.trim()) return { clean: true, matches: [] }

  const normalised = normalise(text)
  const matches: string[] = []

  for (const { term, re } of COMPILED) {
    if (re.test(normalised)) matches.push(term)
  }

  return { clean: matches.length === 0, matches }
}

/**
 * Check multiple strings at once (content + tags joined).
 * Use this in service methods so content and every tag are checked together.
 */
export function checkProfanityBulk(parts: string[]): ProfanityCheckResult {
  return checkProfanity(parts.filter(Boolean).join(' '))
}
