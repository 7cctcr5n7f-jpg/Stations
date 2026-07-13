import fs from "fs"
import os from "os"
import path from "path"
import { uploadToR2 } from "@/lib/r2"

// Use require() so webpack does not attempt to bundle these native-binary
// packages — they must be resolved at runtime via node_modules.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg") as { path: string }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpeg = require("fluent-ffmpeg") as typeof import("fluent-ffmpeg")
ffmpeg.setFfmpegPath(ffmpegInstaller.path)

async function runThumbnailExtraction(input: string, output: string, seekSeconds: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(input)
      .inputOptions([`-ss ${seekSeconds.toFixed(3)}`])
      .outputOptions(["-vframes 1", "-q:v 3", "-vf scale=320:-1"])
      .output(output)
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .run()
  })
}

async function extractThumbnailFrame(videoUrl: string, tmpThumb: string): Promise<void> {
  const attempts: Array<() => Promise<void>> = [
    () => runThumbnailExtraction(videoUrl, tmpThumb, 1),
    () => runThumbnailExtraction(videoUrl, tmpThumb, 0),
  ]

  let lastError: unknown = null
  for (const attempt of attempts) {
    try {
      await attempt()
      if (fs.existsSync(tmpThumb) && fs.statSync(tmpThumb).size > 0) return
    } catch (error) {
      lastError = error
    }
  }

  const tmpVideo = path.join(os.tmpdir(), `thumb-src-${Date.now()}-${videoIdSafeSegment(videoUrl)}.mp4`)
  try {
    const response = await fetch(videoUrl)
    if (!response.ok) {
      throw new Error(`Failed to download video for thumbnail generation (${response.status})`)
    }

    fs.writeFileSync(tmpVideo, Buffer.from(await response.arrayBuffer()))
    for (const seekSeconds of [1, 0]) {
      try {
        await runThumbnailExtraction(tmpVideo, tmpThumb, seekSeconds)
        if (fs.existsSync(tmpThumb) && fs.statSync(tmpThumb).size > 0) return
      } catch (error) {
        lastError = error
      }
    }
  } finally {
    try {
      fs.unlinkSync(tmpVideo)
    } catch {}
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to extract thumbnail frame")
}

function videoIdSafeSegment(videoUrl: string): string {
  return videoUrl.replace(/[^a-zA-Z0-9]+/g, "-").slice(-40) || "video"
}

export async function generateThumbnailForVideoUrl(videoId: number, videoUrl: string): Promise<string> {
  const tmpThumb = path.join(os.tmpdir(), `thumb-out-${videoId}-${Date.now()}.jpg`)

  try {
    await extractThumbnailFrame(videoUrl, tmpThumb)

    const thumbBuffer = fs.readFileSync(tmpThumb)
    const key = `thumbnails/${videoId}-${Date.now()}.jpg`
    return await uploadToR2(key, thumbBuffer, "image/jpeg")
  } finally {
    try {
      fs.unlinkSync(tmpThumb)
    } catch {}
  }
}
