import { type NextRequest, NextResponse } from "next/server"
import { verifyAdminSessionToken, ADMIN_SESSION_COOKIE } from "@/lib/admin-auth"
import { downloadFromR2, uploadToR2, updateR2Metadata, listR2Keys, getR2KeyFromPublicUrl } from "@/lib/r2"
import { sql } from "@/lib/db"
import { execFile } from "child_process"
import { writeFile, readFile, unlink, stat } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 300 // 5 minutes max for Vercel

let _ffmpegPath: string | null = null
function ffmpegPath(): string {
  if (_ffmpegPath) return _ffmpegPath
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _ffmpegPath = require("@ffmpeg-installer/ffmpeg").path
  } catch {
    _ffmpegPath = "ffmpeg"
  }
  return _ffmpegPath
}

function runFfmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath(), args, { timeout: 120_000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message))
      else resolve(stderr || stdout)
    })
  })
}

/** Check if a video's moov atom is before mdat (fast-start) */
async function isFastStart(buf: Buffer): Promise<boolean> {
  let pos = 0
  while (pos < Math.min(buf.length, 4096) - 8) {
    const size = buf.readUInt32BE(pos)
    const type = buf.subarray(pos + 4, pos + 8).toString("ascii")
    if (size < 8) break
    if (type === "moov") return true
    if (type === "mdat") return false
    pos += size
  }
  return false
}

/**
 * POST /api/admin/optimize-videos
 *
 * Actions:
 *   { action: "analyze" }          — Report how many videos need fast-start and cache headers
 *   { action: "fix-headers" }      — Set Cache-Control on all R2 objects (fast, no re-upload)
 *   { action: "fix-faststart", limit?: number } — Reprocess videos that have mdat before moov
 *   { action: "compress-large", maxSizeMB?: number, limit?: number } — Re-encode oversized videos
 */
export async function POST(request: NextRequest) {
  const cookie = request.cookies.get(ADMIN_SESSION_COOKIE)?.value
  const session = await verifyAdminSessionToken(cookie)
  if (!session.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { action, limit, maxSizeMB } = await request.json()

  if (action === "analyze") {
    return analyze()
  }

  if (action === "fix-headers") {
    return fixHeaders()
  }

  if (action === "fix-faststart") {
    return fixFastStart(limit ?? 10)
  }

  if (action === "compress-large") {
    return compressLarge(maxSizeMB ?? 10, limit ?? 5)
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 })
}

async function analyze() {
  const videos = await sql`SELECT id, url, title FROM videos WHERE url IS NOT NULL ORDER BY id`

  let needsFastStart = 0
  let alreadyFastStart = 0
  let errors = 0
  const oversized: { id: number; title: string; sizeMB: number }[] = []

  // Sample first 50 videos for fast-start check
  const sample = videos.slice(0, 50)
  for (const v of sample) {
    try {
      const resp = await fetch(v.url, { headers: { Range: "bytes=0-4095" } })
      if (!resp.ok) { errors++; continue }
      const buf = Buffer.from(await resp.arrayBuffer())
      if (await isFastStart(buf)) alreadyFastStart++
      else needsFastStart++
    } catch {
      errors++
    }
  }

  // Check sizes of all videos via HEAD
  const sizeChecks = await Promise.all(
    videos.map(async (v: any) => {
      try {
        const resp = await fetch(v.url, { method: "HEAD" })
        const len = parseInt(resp.headers.get("content-length") || "0", 10)
        return { id: v.id, title: v.title, sizeMB: Math.round(len / 1024 / 1024 * 10) / 10 }
      } catch {
        return null
      }
    })
  )

  for (const s of sizeChecks) {
    if (s && s.sizeMB > 10) oversized.push(s)
  }

  // Check cache headers on a sample
  let hasCacheControl = 0
  let noCacheControl = 0
  for (const v of sample.slice(0, 5)) {
    try {
      const resp = await fetch(v.url, { method: "HEAD" })
      if (resp.headers.get("cache-control")) hasCacheControl++
      else noCacheControl++
    } catch { /* skip */ }
  }

  return NextResponse.json({
    totalVideos: videos.length,
    fastStartSample: { checked: sample.length, needsFastStart, alreadyFastStart, errors },
    oversizedVideos: { count: oversized.length, videos: oversized.slice(0, 20) },
    cacheHeaders: { hasCacheControl, noCacheControl },
  })
}

async function fixHeaders() {
  const keys = await listR2Keys()
  let updated = 0
  let errors = 0

  // Process in parallel batches of 20
  const BATCH = 20
  for (let i = 0; i < keys.length; i += BATCH) {
    const batch = keys.slice(i, i + BATCH)
    const results = await Promise.allSettled(
      batch.map(async (key) => {
        const contentType = key.endsWith(".mp4")
          ? "video/mp4"
          : key.endsWith(".jpg") || key.endsWith(".jpeg")
          ? "image/jpeg"
          : key.endsWith(".png")
          ? "image/png"
          : "application/octet-stream"
        await updateR2Metadata(key, contentType, "public, max-age=31536000, immutable")
      })
    )
    for (const r of results) {
      if (r.status === "fulfilled") updated++
      else errors++
    }
  }

  return NextResponse.json({ updated, errors, total: keys.length })
}

async function fixFastStart(limit: number) {
  const videos = await sql`SELECT id, url, title FROM videos WHERE url IS NOT NULL ORDER BY id`

  const results: { id: number; title: string; status: string; before?: number; after?: number }[] = []
  let processed = 0

  for (const v of videos) {
    if (processed >= limit) break

    try {
      // Check first 4KB to determine atom order
      const headResp = await fetch(v.url, { headers: { Range: "bytes=0-4095" } })
      if (!headResp.ok) { results.push({ id: v.id, title: v.title, status: "fetch-error" }); continue }
      const headBuf = Buffer.from(await headResp.arrayBuffer())

      if (await isFastStart(headBuf)) {
        results.push({ id: v.id, title: v.title, status: "already-optimized" })
        continue
      }

      // Download the full video
      const key = getR2KeyFromPublicUrl(v.url)
      if (!key) { results.push({ id: v.id, title: v.title, status: "bad-url" }); continue }

      const fullBuf = await downloadFromR2(key)
      const inputPath = join(tmpdir(), `faststart-in-${v.id}.mp4`)
      const outputPath = join(tmpdir(), `faststart-out-${v.id}.mp4`)

      await writeFile(inputPath, fullBuf)
      const beforeSize = fullBuf.length

      // Remux with fast-start (no re-encoding)
      await runFfmpeg(["-i", inputPath, "-c", "copy", "-movflags", "+faststart", "-y", outputPath])

      const outputStat = await stat(outputPath)
      const outputBuf = await readFile(outputPath)

      // Upload the optimized version (same key, with cache headers)
      await uploadToR2(key, outputBuf, "video/mp4", { cacheControl: "public, max-age=31536000, immutable" })

      // Clean up temp files
      await unlink(inputPath).catch(() => {})
      await unlink(outputPath).catch(() => {})

      results.push({
        id: v.id,
        title: v.title,
        status: "optimized",
        before: Math.round(beforeSize / 1024),
        after: Math.round(outputStat.size / 1024),
      })
      processed++
    } catch (e: any) {
      results.push({ id: v.id, title: v.title, status: `error: ${e.message?.slice(0, 100)}` })
    }
  }

  return NextResponse.json({ processed, results })
}

async function compressLarge(maxSizeMB: number, limit: number) {
  const videos = await sql`SELECT id, url, title FROM videos WHERE url IS NOT NULL ORDER BY id`

  const results: { id: number; title: string; status: string; beforeMB?: number; afterMB?: number }[] = []
  let processed = 0

  for (const v of videos) {
    if (processed >= limit) break

    try {
      // Check file size
      const headResp = await fetch(v.url, { method: "HEAD" })
      const contentLength = parseInt(headResp.headers.get("content-length") || "0", 10)
      const sizeMB = contentLength / 1024 / 1024

      if (sizeMB <= maxSizeMB) continue

      const key = getR2KeyFromPublicUrl(v.url)
      if (!key) { results.push({ id: v.id, title: v.title, status: "bad-url" }); continue }

      const fullBuf = await downloadFromR2(key)
      const inputPath = join(tmpdir(), `compress-in-${v.id}.mp4`)
      const outputPath = join(tmpdir(), `compress-out-${v.id}.mp4`)

      await writeFile(inputPath, fullBuf)

      // Re-encode to 720p at ~2.5Mbps with fast-start
      await runFfmpeg([
        "-i", inputPath,
        "-vf", "scale=-2:720",
        "-c:v", "libx264",
        "-preset", "medium",
        "-b:v", "2500k",
        "-maxrate", "3000k",
        "-bufsize", "5000k",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        "-y", outputPath,
      ])

      const outputStat = await stat(outputPath)
      const outputBuf = await readFile(outputPath)

      await uploadToR2(key, outputBuf, "video/mp4", { cacheControl: "public, max-age=31536000, immutable" })

      await unlink(inputPath).catch(() => {})
      await unlink(outputPath).catch(() => {})

      results.push({
        id: v.id,
        title: v.title,
        status: "compressed",
        beforeMB: Math.round(sizeMB * 10) / 10,
        afterMB: Math.round(outputStat.size / 1024 / 1024 * 10) / 10,
      })
      processed++
    } catch (e: any) {
      results.push({ id: v.id, title: v.title, status: `error: ${e.message?.slice(0, 100)}` })
    }
  }

  return NextResponse.json({ processed, results })
}
