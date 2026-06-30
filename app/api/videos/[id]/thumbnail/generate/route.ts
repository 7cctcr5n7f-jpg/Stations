export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

import path from "path"
import os from "os"
import fs from "fs"
import { type NextRequest, NextResponse } from "next/server"
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg"
import ffmpeg from "fluent-ffmpeg"
import { sql, mapVideo } from "@/lib/db"
import { uploadToR2 } from "@/lib/r2"

ffmpeg.setFfmpegPath(ffmpegInstaller.path)

/**
 * POST /api/videos/[id]/thumbnail/generate
 *
 * Fetches the video from R2 server-side, uses ffmpeg to extract a JPEG frame
 * at 1 second, uploads it to R2, and writes thumbnail_url to the DB.
 * No CORS issues — everything runs on the server.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const tmpVideo = path.join(os.tmpdir(), `thumb-video-${Date.now()}.mp4`)
  const tmpThumb = path.join(os.tmpdir(), `thumb-out-${Date.now()}.jpg`)

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

    // Download the video to a temp file (ffmpeg works best with file paths)
    const videoRes = await fetch(videoUrl)
    if (!videoRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch video: ${videoRes.status}` },
        { status: 502 }
      )
    }
    const videoBuffer = Buffer.from(await videoRes.arrayBuffer())
    fs.writeFileSync(tmpVideo, videoBuffer)

    // Use ffmpeg to extract a JPEG frame at 1 second (or at 0 if video is shorter)
    await new Promise<void>((resolve, reject) => {
      ffmpeg(tmpVideo)
        .on("end", () => resolve())
        .on("error", (err) => reject(err))
        .screenshots({
          timestamps: ["00:00:01.000"],
          filename: path.basename(tmpThumb),
          folder: os.tmpdir(),
          size: "320x?",
        })
    })

    // Upload the JPEG to R2
    const thumbBuffer = fs.readFileSync(tmpThumb)
    const key = `thumbnails/${videoId}-${Date.now()}.jpg`
    const thumbnailUrl = await uploadToR2(key, thumbBuffer, "image/jpeg")

    // Persist the URL in the DB
    const updated = await sql`
      UPDATE videos
      SET thumbnail_url = ${thumbnailUrl}
      WHERE id = ${videoId}
      RETURNING *
    `

    return NextResponse.json(mapVideo(updated[0]))
  } catch (error) {
    console.error("[thumbnail/generate] error:", error)
    return NextResponse.json(
      { error: "Failed to generate thumbnail", detail: String(error) },
      { status: 500 }
    )
  } finally {
    // Clean up temp files
    try { fs.unlinkSync(tmpVideo) } catch {}
    try { fs.unlinkSync(tmpThumb) } catch {}
  }
}
