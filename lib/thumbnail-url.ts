/**
 * Rewrites a public R2 thumbnail URL to our same-origin thumbnail proxy so the
 * browser never hits Cloudflare's rate-limited `*.r2.dev` endpoint (which
 * returns HTTP 429 under the concurrent burst of a full grid/table of images).
 *
 * Only rewrites absolute `http(s)` URLs. Anything already same-origin/relative
 * (e.g. an already-proxied path or a data URL) is returned unchanged.
 */
export function proxiedThumbnailUrl(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (!/^https?:\/\//i.test(trimmed)) return trimmed
  return `/api/thumbnail-proxy?url=${encodeURIComponent(trimmed)}`
}
