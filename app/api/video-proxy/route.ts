import { type NextRequest } from "next/server"
import { downloadFromR2, getR2KeyFromPublicUrl } from "@/lib/r2"

export const runtime = "nodejs"
// Videos can be a few MB; allow enough time to stream on a slow gym network.
export const maxDuration = 60

/**
 * Same-origin video proxy.
 *
 * The public R2 bucket (`*.r2.dev`) sends no CORS headers, so a browser
 * `fetch()` to download a video into IndexedDB fails cross-origin. This route
 * streams the same bytes from our own origin (via the S3 API, server-side),
 * which lets the room displays download each clip ONCE into local storage and
 * then loop it entirely offline.
 *
 * Accepts either `?key=<storageKey>` or `?url=<publicR2Url>`. Only objects that
 * resolve to a key inside our bucket are served.
 */
export async function GET(req: NextRequest) {
  const urlParam = req.nextUrl.searchParams.get("url")
  const keyParam = req.nextUrl.searchParams.get("key")

  let key: string | null = keyParam
  if (!key && urlParam) key = getR2KeyFromPublicUrl(urlParam)
  if (!key) {
    return new Response("Missing or invalid video key", { status: 400 })
  }

  let buffer: Buffer
  try {
    buffer = await downloadFromR2(key)
  } catch (e: any) {
    console.error("[v0] video-proxy download failed:", key, e?.message)
    return new Response("Video not found", { status: 404 })
  }

  const total = buffer.length
  const baseHeaders: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    // Cache at the browser/CDN too; the file is immutable (new uploads get a
    // new key), so this is safe and reduces re-downloads.
    "Cache-Control": "public, max-age=31536000, immutable",
  }

  // Honour Range requests so the proxy also works as a direct <video> src
  // fallback (the browser streams via 206 partial responses).
  const range = req.headers.get("range")
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range)
    let start = match && match[1] ? Number.parseInt(match[1], 10) : 0
    let end = match && match[2] ? Number.parseInt(match[2], 10) : total - 1
    if (Number.isNaN(start) || start < 0) start = 0
    if (Number.isNaN(end) || end >= total) end = total - 1
    if (start > end) start = 0

    const chunk = buffer.subarray(start, end + 1)
    return new Response(new Uint8Array(chunk), {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Content-Length": String(chunk.length),
      },
    })
  }

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: { ...baseHeaders, "Content-Length": String(total) },
  })
}
