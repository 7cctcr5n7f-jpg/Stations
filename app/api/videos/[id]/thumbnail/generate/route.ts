export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

import { type NextRequest, NextResponse } from "next/server"
import { sql, mapVideo } from "@/lib/db"
import { deleteFromR2ByPublicUrl } from "@/lib/r2"
import { generateThumbnailForVideoUrl } from "@/lib/video-thumbnail"

/**
 * POST /api/videos/[id]/thumbnail/generate
 *
 * Uses ffmpeg to seek directly into the remote R2 URL (no full download),
 * extracts a single JPEG frame at 1 second, uploads it to R2, and writes
 * thumbnail_url to the DB. No CORS issues — everything runs on the server.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const videoId = Number(id)
    if (!videoId || isNaN(videoId)) {
      return NextResponse.json({ error: "Invalid video id" }, { status: 400 })
    }

    // Fetch the video row to get its URL
    const rows = await sql`SELECT * FROM videos WHERE id = ${videoId}`
    if (rows.length === 0) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 })
    }
    const video = rows[0]
    const videoUrl: string = video.url

    if (!videoUrl) {
      return NextResponse.json({ error: "Video has no URL" }, { status: 400 })
    }

    // Validate URL is HTTP/HTTPS
    if (!videoUrl.startsWith('http://') && !videoUrl.startsWith('https://')) {
      console.warn(`[thumbnail/generate] Skipping invalid URL for video ${videoId}: ${videoUrl}`)
      return NextResponse.json({ error: "Video URL is not HTTP/HTTPS" }, { status: 400 })
    }

    const previousThumbnailUrl = video.thumbnail_url as string | null | undefined
    const thumbnailUrl = await generateThumbnailForVideoUrl(videoId, videoUrl)

    // Persist the URL in the DB
    const updated = await sql`
      UPDATE videos
      SET thumbnail_url = ${thumbnailUrl}
      WHERE id = ${videoId}
      RETURNING *
    `

    const [thumbRefRow] = previousThumbnailUrl
      ? await sql`SELECT COUNT(*)::int AS count FROM videos WHERE id <> ${videoId} AND thumbnail_url = ${previousThumbnailUrl}`
      : [{ count: 1 }]

    if (previousThumbnailUrl && previousThumbnailUrl !== thumbnailUrl && thumbRefRow.count === 0) {
      await deleteFromR2ByPublicUrl(previousThumbnailUrl)
    }

    return NextResponse.json(mapVideo(updated[0]))
  } catch (error) {
    console.error("[thumbnail/generate] error:", error)
    return NextResponse.json(
      { error: "Failed to generate thumbnail", detail: String(error) },
      { status: 500 }
    )
  }
}
