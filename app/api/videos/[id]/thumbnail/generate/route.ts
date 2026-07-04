export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

import path from "path"
import os from "os"
import fs from "fs"
import { type NextRequest, NextResponse } from "next/server"
import { sql, mapVideo } from "@/lib/db"
import { uploadToR2 } from "@/lib/r2"

// Use require() so webpack does not attempt to bundle these native-binary
// packages — they must be resolved at runtime via node_modules.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg") as { path: string }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpeg = require("fluent-ffmpeg") as typeof import("fluent-ffmpeg")
ffmpeg.setFfmpegPath(ffmpegInstaller.path)

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

    // Pass the remote URL directly to ffmpeg with -ss before -i so it seeks
    // via HTTP range requests rather than downloading the whole file first.
    // -vframes 1 grabs exactly one frame and exits immediately.
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(videoUrl)
        .inputOptions(["-ss 00:00:01"])   // seek to 1 s BEFORE opening (fast seek)
        .outputOptions(["-vframes 1", "-q:v 3", "-vf scale=320:-1"])
        .output(tmpThumb)
        .on("end", () => resolve())
        .on("error", (err) => {
          // If 1-second seek fails (video shorter than 1s), retry at 0
          ffmpeg()
            .input(videoUrl)
            .inputOptions(["-ss 00:00:00"])
            .outputOptions(["-vframes 1", "-q:v 3", "-vf scale=320:-1"])
            .output(tmpThumb)
            .on("end", () => resolve())
            .on("error", (err2) => reject(err2))
            .run()
        })
        .run()
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
    try { fs.unlinkSync(tmpThumb) } catch {}
  }
}
