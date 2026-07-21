import { NextRequest, NextResponse } from "next/server"
import { sql, mapVideo } from "@/lib/db"
import { deleteFromR2ByPublicUrl, uploadToR2 } from "@/lib/r2"
import { generateThumbnailForVideoUrl } from "@/lib/video-thumbnail"
import { ensureTvCompatibleBuffer } from "@/lib/video-compat"

export const runtime = "nodejs"
export const maxDuration = 300

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const videoId = Number(id)
    if (!Number.isFinite(videoId)) {
      return NextResponse.json({ error: "Invalid video id" }, { status: 400 })
    }

    const contentType = request.headers.get("content-type") || ""
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 })
    }

    const formData = await request.formData()
    const file = formData.get("video") as File | null
    if (!file) {
      return NextResponse.json({ error: "No replacement video provided" }, { status: 400 })
    }

    const existingRows = await sql`SELECT * FROM videos WHERE id = ${videoId}`
    if (existingRows.length === 0) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 })
    }

    const existing = existingRows[0]

    // Make sure the replacement plays on the room-display TV boxes (H.264 8-bit).
    const originalBuf = Buffer.from(await file.arrayBuffer())
    let uploadBuf: Buffer<ArrayBufferLike> = originalBuf
    let finalCodec: string | null = null
    let finalPix: string | null = null
    let wasConverted = false
    try {
      const result = await ensureTvCompatibleBuffer(originalBuf, String(videoId))
      uploadBuf = result.buffer
      finalCodec = result.converted ? "h264" : result.codec
      finalPix = result.converted ? "yuv420p" : result.pixFmt
      wasConverted = result.converted
    } catch (e) {
      console.error("[videos/replace] compatibility check failed, storing original:", e)
      uploadBuf = originalBuf
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.[^.]+$/, "")
    const key = `videos/${Date.now()}${wasConverted ? "-h264" : ""}-${safeName}.mp4`
    const replacementUrl = await uploadToR2(key, uploadBuf as any, "video/mp4")

    let replacementThumbnailUrl = existing.thumbnail_url as string | null
    try {
      replacementThumbnailUrl = await generateThumbnailForVideoUrl(videoId, replacementUrl)
    } catch (error) {
      console.warn("[videos/replace] Thumbnail generation failed, keeping existing thumbnail:", error)
    }

    const tvCompatible = finalCodec ? finalCodec === "h264" : null
    const updatedRows = await sql`
      UPDATE videos
      SET url = ${replacementUrl},
          storage_key = ${key},
          thumbnail_url = ${replacementThumbnailUrl},
          video_codec = ${finalCodec},
          pixel_format = ${finalPix},
          tv_compatible = ${tvCompatible},
          codec_checked_at = ${finalCodec ? new Date().toISOString() : null},
          converted_at = ${wasConverted ? new Date().toISOString() : null}
      WHERE id = ${videoId}
      RETURNING *
    `

    const oldUrl = existing.url as string | null
    const oldThumbnailUrl = existing.thumbnail_url as string | null
    const shouldDeleteOldVideo =
      oldUrl &&
      (
        await sql`SELECT COUNT(*)::int AS count FROM videos WHERE id <> ${videoId} AND url = ${oldUrl}`
      )[0].count === 0

    const shouldDeleteOldThumbnail =
      oldThumbnailUrl &&
      replacementThumbnailUrl !== oldThumbnailUrl &&
      (
        await sql`SELECT COUNT(*)::int AS count FROM videos WHERE id <> ${videoId} AND thumbnail_url = ${oldThumbnailUrl}`
      )[0].count === 0

    await Promise.all([
      shouldDeleteOldVideo ? deleteFromR2ByPublicUrl(oldUrl) : Promise.resolve(),
      shouldDeleteOldThumbnail ? deleteFromR2ByPublicUrl(oldThumbnailUrl) : Promise.resolve(),
    ])

    return NextResponse.json(mapVideo(updatedRows[0]))
  } catch (error) {
    console.error("[videos/replace] error:", error)
    return NextResponse.json({ error: "Failed to replace video" }, { status: 500 })
  }
}
