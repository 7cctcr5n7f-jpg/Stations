import { type NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { uploadToR2 } from "@/lib/r2"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

/**
 * POST /api/videos/thumbnail
 * Accepts a JPEG frame extracted client-side from the video and stores it in R2.
 * Body: FormData with fields:
 *   - videoId: number
 *   - frame: Blob (image/jpeg)
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const videoId = Number(form.get("videoId"))
    const frame = form.get("frame") as File | null

    if (!videoId || !frame) {
      return NextResponse.json({ error: "videoId and frame are required" }, { status: 400 })
    }

    const buffer = Buffer.from(await frame.arrayBuffer())
    const key = `thumbnails/thumb-${Date.now()}-${videoId}.jpg`
    const thumbnailUrl = await uploadToR2(key, buffer, "image/jpeg")

    await sql`UPDATE videos SET thumbnail_url = ${thumbnailUrl} WHERE id = ${videoId}`

    return NextResponse.json({ thumbnailUrl })
  } catch (err: any) {
    console.error("[v0] thumbnail upload error:", err?.message)
    return NextResponse.json({ error: "Failed to upload thumbnail" }, { status: 500 })
  }
}

/**
 * GET /api/videos/thumbnail?missing=true
 * Returns the ids + urls of videos that still need a thumbnail.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  if (searchParams.get("missing") === "true") {
    const rows = await sql`
      SELECT id, url FROM videos
      WHERE (thumbnail_url IS NULL OR thumbnail_url = '')
        AND url LIKE 'https://%'
      ORDER BY id ASC
    `
    return NextResponse.json({ videos: rows })
  }
  return NextResponse.json({ error: "Use ?missing=true" }, { status: 400 })
}
