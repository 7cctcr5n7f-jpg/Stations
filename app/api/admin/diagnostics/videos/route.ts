import { NextResponse, type NextRequest } from "next/server"
import { sql, mapVideo } from "@/lib/db"
import { headR2ByPublicUrl } from "@/lib/r2"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * TEMPORARY diagnostics endpoint.
 *
 * Returns, for every video, the authoritative existence + metadata of both its
 * video file and its thumbnail file, checked via the S3 HeadObject API (NOT the
 * rate-limited public r2.dev endpoint). This is the server-truth half of the
 * /admin/diagnostics panel; the browser-reality half runs client-side.
 *
 *   ?probe=head  (default) — HeadObject every video + thumbnail
 *   ?probe=none            — return DB rows only (fast; client does the probing)
 *   ?limit=&offset=        — page through the library
 */
async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let i = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      results[idx] = await fn(items[idx])
    }
  })
  await Promise.all(workers)
  return results
}

function keyFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const m = url.match(/\.r2\.dev\/(.+)$/) || url.match(/\/([^/]+\/[^/]+)$/)
  return m ? m[1].split("?")[0] : null
}

export async function GET(req: NextRequest) {
  const probe = req.nextUrl.searchParams.get("probe") ?? "head"
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? "10000") || 10000, 10000)
  const offset = Math.max(Number(req.nextUrl.searchParams.get("offset") ?? "0") || 0, 0)

  const rows = (await sql`
    SELECT id, title, url, thumbnail_url, category, body_part, equipment, duration
    FROM videos
    ORDER BY id
    LIMIT ${limit} OFFSET ${offset}
  `) as any[]

  const videos = rows.map(mapVideo)

  const base = videos.map((v) => {
    const filename = (v.url?.split("/").pop() ?? "").split("?")[0]
    const ext = (filename.match(/\.([^.]+)$/)?.[1] ?? "").toLowerCase()
    return {
      id: v.id,
      title: v.title,
      videoUrl: v.url,
      thumbnailUrl: v.thumbnailUrl ?? null,
      filename,
      videoExt: ext,
      videoKey: keyFromUrl(v.url),
      thumbKey: keyFromUrl(v.thumbnailUrl),
      hasThumbPointer: !!(v.thumbnailUrl && v.thumbnailUrl.trim()),
      duration: v.duration ?? null,
    }
  })

  if (probe === "none") {
    return NextResponse.json({ probe, count: base.length, rows: base })
  }

  // Authoritative HeadObject probe of both files.
  const enriched = await mapWithConcurrency(base, 24, async (r) => {
    const [video, thumb] = await Promise.all([
      headR2ByPublicUrl(r.videoUrl),
      r.hasThumbPointer ? headR2ByPublicUrl(r.thumbnailUrl) : Promise.resolve(null),
    ])
    return {
      ...r,
      video: {
        exists: video.exists,
        size: video.size,
        contentType: video.contentType,
        lastModified: video.lastModified,
        cacheControl: video.cacheControl,
        error: video.error,
      },
      thumb: thumb
        ? {
            exists: thumb.exists,
            size: thumb.size,
            contentType: thumb.contentType,
            lastModified: thumb.lastModified,
            cacheControl: thumb.cacheControl,
            error: thumb.error,
          }
        : { exists: false, size: null, contentType: null, lastModified: null, cacheControl: null, error: "no thumbnail_url" },
    }
  })

  const summary = {
    total: enriched.length,
    missingThumbPointer: enriched.filter((r) => !r.hasThumbPointer).length,
    thumbFileMissing: enriched.filter((r) => r.hasThumbPointer && !r.thumb.exists).length,
    videoFileMissing: enriched.filter((r) => !r.video.exists).length,
    thumbNotJpeg: enriched.filter((r) => r.thumb.exists && r.thumb.contentType && !/jpeg|jpg|png|webp/i.test(r.thumb.contentType)).length,
    videoNotMp4: enriched.filter((r) => r.video.exists && r.video.contentType && !/mp4/i.test(r.video.contentType)).length,
  }

  return NextResponse.json({ probe, summary, rows: enriched })
}
