import { type NextRequest } from "next/server"
import { downloadFromR2, getR2KeyFromPublicUrl } from "@/lib/r2"

export const runtime = "nodejs"
export const maxDuration = 30

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
}

function imageContentTypeForKey(key: string): string | null {
  const ext = key.split(".").pop()?.toLowerCase() ?? ""
  return IMAGE_CONTENT_TYPES[ext] ?? null
}

/**
 * Same-origin thumbnail proxy.
 *
 * Thumbnails were served straight from the public R2 bucket (`*.r2.dev`), which
 * Cloudflare rate-limits ("not for production"). When a surface mounts many
 * `<img>` at once (the Live View grid, the full Video Library table) the
 * concurrent burst trips that rate limit and a fraction of requests return
 * HTTP 429 → blank tiles. This route streams the same JPEG bytes from our own
 * origin (via the S3 API, server-side, which is NOT the rate-limited endpoint)
 * with an immutable Cache-Control, so each browser downloads a given thumbnail
 * once and never touches r2.dev again.
 *
 * Accepts either `?key=<storageKey>` or `?url=<publicR2Url>`. Only objects that
 * resolve to an image key inside our bucket are served (so it can't be abused
 * as an open proxy for arbitrary objects).
 */
export async function GET(req: NextRequest) {
  const urlParam = req.nextUrl.searchParams.get("url")
  const keyParam = req.nextUrl.searchParams.get("key")

  let key: string | null = keyParam
  if (!key && urlParam) key = getR2KeyFromPublicUrl(urlParam)
  if (!key) {
    return new Response("Missing or invalid thumbnail key", { status: 400 })
  }

  const contentType = imageContentTypeForKey(key)
  if (!contentType) {
    return new Response("Unsupported thumbnail type", { status: 400 })
  }

  let buffer: Buffer
  try {
    buffer = await downloadFromR2(key)
  } catch (e: any) {
    console.error("[thumbnail-proxy] download failed:", key, e?.message)
    return new Response("Thumbnail not found", { status: 404 })
  }

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(buffer.length),
      // Immutable: a replaced thumbnail gets a new key, so this is safe and lets
      // the browser (and Vercel's edge) cache each thumbnail permanently.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  })
}
