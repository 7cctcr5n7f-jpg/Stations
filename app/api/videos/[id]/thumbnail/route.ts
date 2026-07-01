export const dynamic = "force-dynamic"

import { type NextRequest, NextResponse } from "next/server"
import { sql, mapVideo } from "@/lib/db"
import { uploadToR2 } from "@/lib/r2"

export const runtime = "nodejs"

/**
 * POST /api/videos/[id]/thumbnail
 *
 * Accepts a JPEG image blob in the request body, uploads it to R2 under
 * "thumbnails/<id>-<timestamp>.jpg", then writes the resulting public URL
 * back to videos.thumbnail_url for the given video id.
 *
 * Returns the updated Video object.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const videoId = Number(id)
    if (!videoId || isNaN(videoId)) {
      return NextResponse.json({ error: "Invalid video id" }, { status: 400 })
    }

    const contentType = req.headers.get("content-type") || "image/jpeg"
    const buffer = Buffer.from(await req.arrayBuffer())

    if (!buffer.length) {
      return NextResponse.json({ error: "Empty thumbnail body" }, { status: 400 })
    }

    const ext = contentType.includes("png") ? "png" : "jpg"
    const key = `thumbnails/${videoId}-${Date.now()}.${ext}`
    const thumbnailUrl = await uploadToR2(key, buffer, contentType)

    const rows = await sql`
      UPDATE videos
      SET thumbnail_url = ${thumbnailUrl}
      WHERE id = ${videoId}
      RETURNING *
    `

    if (rows.length === 0) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 })
    }

    return NextResponse.json(mapVideo(rows[0]))
  } catch (error) {
    console.error("[thumbnail] POST error:", error)
    return NextResponse.json({ error: "Failed to save thumbnail" }, { status: 500 })
  }
}
