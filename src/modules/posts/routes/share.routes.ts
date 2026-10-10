/**
 * Share routes — public-facing URLs for social sharing + Android App Links.
 *
 * These are registered at the ROOT level (no /api prefix) so that:
 *   - /.well-known/assetlinks.json  → Android App Links verification
 *   - /share/post/:id               → OG meta page + intent redirect
 *
 * Social media crawlers (WhatsApp, Facebook, Telegram) hit this page to
 * generate a preview card.  Real Android users get silently redirected to
 * the app (if installed) or Play Store (if not).
 */

import type { FastifyInstance } from 'fastify'
import { getDb } from '@/core/database/client'
import { PostsRepository } from '../repositories/posts.repository'

// ─── Android App Links fingerprint ────────────────────────────────────────────
// Replace SHA_256_CERT_FINGERPRINT_HERE with the actual fingerprint from:
//   keytool -list -v -keystore your.keystore -alias your_key_alias
// OR from Play Console → Setup → App integrity → SHA-256 certificate fingerprint.
// Until replaced, Android will fall through to the browser (intent:// URL still
// works — users go to Play Store if app not installed).
const PACKAGE_NAME = 'com.astrobook.app'
const SHA256_FINGERPRINT = '66:C3:D3:8A:E1:0E:60:27:15:27:16:8F:90:2D:6B:7E:2D:96:7E:F7:A3:74:42:55:3C:D8:8A:5D:A2:09:AD:68'

const APP_STORE_URL = `https://play.google.com/store/apps/details?id=${PACKAGE_NAME}`
const BASE_SHARE_URL = 'https://astrobook.in'
const DEFAULT_OG_IMAGE = `${BASE_SHARE_URL}/og-cover.png`

// ─── Minimal HTML page — OG tags + intent redirect ────────────────────────────
function buildSharePage(opts: {
  postId: string
  title: string
  description: string
  imageUrl: string
  canonicalUrl: string
}): string {
  const { postId, title, description, imageUrl, canonicalUrl } = opts

  // intent:// URL trick:
  //   • If Astrobook IS installed → opens astrobook:///post/{id} directly.
  //   • If NOT installed           → browser_fallback_url kicks in → Play Store.
  //
  // Android App Links (autoVerify + assetlinks.json) is a PARALLEL path:
  // when the domain is verified, Android intercepts the https:// link BEFORE
  // the browser ever loads this page — so this page is only reached when:
  //   (a) app is not installed, or
  //   (b) App Links verification hasn't propagated yet.
  const intentUrl =
    `intent://post/${postId}#Intent;` +
    `scheme=astrobook;` +
    `package=${PACKAGE_NAME};` +
    `S.browser_fallback_url=${encodeURIComponent(APP_STORE_URL)};` +
    `end`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)}</title>

  <!-- Open Graph — WhatsApp, Facebook, Telegram, Twitter all read these -->
  <meta property="og:type"        content="article" />
  <meta property="og:title"       content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:image"       content="${escapeHtml(imageUrl)}" />
  <meta property="og:url"         content="${escapeHtml(canonicalUrl)}" />
  <meta property="og:site_name"   content="Astrobook" />

  <!-- Twitter Card -->
  <meta name="twitter:card"        content="summary_large_image" />
  <meta name="twitter:title"       content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image"       content="${escapeHtml(imageUrl)}" />

  <style>
    body {
      margin: 0; padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #121943; color: #fff;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; text-align: center;
    }
    .card { max-width: 360px; padding: 32px 24px; }
    img.logo { width: 72px; height: 72px; border-radius: 18px; margin-bottom: 20px; }
    h1 { font-size: 20px; font-weight: 700; margin: 0 0 8px; }
    p  { font-size: 14px; color: #c4b5fd; margin: 0 0 28px; line-height: 1.5; }
    a.btn {
      display: inline-block; background: #9d0399; color: #fff;
      text-decoration: none; border-radius: 12px;
      padding: 14px 28px; font-size: 16px; font-weight: 700;
    }
    a.btn:active { opacity: 0.85; }
    .sub { margin-top: 16px; font-size: 13px; color: #a78bfa; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(description)}</p>
    <a class="btn" href="${intentUrl}">Open in Astrobook</a>
    <div class="sub">
      App nahi hai?
      <a href="${APP_STORE_URL}" style="color:#c4b5fd">Play Store se install karo</a>
    </div>
  </div>

  <script>
    // Try to open the app immediately — intent:// handles both cases:
    //   installed  → app opens
    //   not installed → Play Store (via browser_fallback_url)
    // We do it after a tiny delay so the page renders first (better UX).
    setTimeout(function () {
      window.location.href = "${intentUrl}";
    }, 100);
  </script>
</body>
</html>`
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + '…'
}

// ─── Route registration ────────────────────────────────────────────────────────

export async function shareRoutes(app: FastifyInstance) {
  const db = getDb()
  const postsRepository = new PostsRepository(db)

  // ── /.well-known/assetlinks.json ──────────────────────────────────────────
  // Android verifies this file at install-time (and periodically).
  // Once verified, Android intercepts https://astrobook.in/post/* links and
  // opens the app WITHOUT going through the browser — fastest possible UX.
  app.get('/.well-known/assetlinks.json', {
    schema: { tags: ['Share'] },
  }, async (_req, reply) => {
    reply.header('Content-Type', 'application/json')
    reply.header('Cache-Control', 'public, max-age=86400') // 1 day
    return reply.send([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: PACKAGE_NAME,
          sha256_cert_fingerprints: [SHA256_FINGERPRINT],
        },
      },
    ])
  })

  // ── GET /share/post/:id ───────────────────────────────────────────────────
  // Returns HTML with OG meta + intent redirect.
  // Social crawlers (bots) get the meta tags → preview card.
  // Real users get auto-redirected to the app or Play Store.
  app.get('/share/post/:id', {
    schema: {
      tags: ['Share'],
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const post = await postsRepository.findById(id)

    const canonicalUrl = `${BASE_SHARE_URL}/share/post/${id}`

    let title: string
    let description: string
    let imageUrl: string

    if (!post) {
      // Post not found — still show a generic Astrobook page rather than 404
      title = 'Astrobook'
      description = 'Astrology aur spiritual guidance ke liye Astrobook download karo.'
      imageUrl = DEFAULT_OG_IMAGE
    } else {
      const astrologerName = (post as any).astrologerName ?? 'Astrologer'
      title = `${astrologerName} on Astrobook`
      description = truncate(post.content ?? 'Astrobook pe ek post dekho.', 160)
      imageUrl = (post.mediaUrl ?? DEFAULT_OG_IMAGE)
    }

    const html = buildSharePage({ postId: id, title, description, imageUrl, canonicalUrl })

    reply.header('Content-Type', 'text/html; charset=utf-8')
    // Cache briefly so crawlers don't hammer the DB, but fresh enough that
    // post edits/deletes propagate within a few minutes.
    reply.header('Cache-Control', 'public, max-age=300')
    return reply.send(html)
  })
}
