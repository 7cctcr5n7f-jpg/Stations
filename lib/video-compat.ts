/**
 * lib/video-compat.ts
 *
 * Shared helpers for detecting and fixing video codecs that Android TV box
 * browsers/WebView cannot decode. Room displays can only play H.264 (avc)
 * with an 8-bit 4:2:0 pixel format; HEVC/H.265 (any bit depth) and 10-bit
 * clips fail with "video not loaded". These helpers probe a file and, when
 * needed, transcode it to the universally supported profile.
 *
 * Server-only (uses child_process + fs). Import from route handlers / actions.
 */

import { execFile } from "child_process"
import { writeFile, readFile, unlink } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"

let _ffmpegPath: string | null = null
export function ffmpegPath(): string {
  if (_ffmpegPath) return _ffmpegPath
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _ffmpegPath = require("@ffmpeg-installer/ffmpeg").path
  } catch {
    _ffmpegPath = "ffmpeg"
  }
  return _ffmpegPath as string
}

export function runFfmpeg(args: string[], timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath(), args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message))
      else resolve(stderr || stdout)
    })
  })
}

/**
 * `ffmpeg -i` with no output exits non-zero but prints stream info to stderr,
 * so we resolve with stderr regardless of exit code.
 */
export function runFfmpegProbe(input: string, timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve) => {
    execFile(ffmpegPath(), ["-i", input, "-hide_banner"], { timeout: timeoutMs }, (_err, _stdout, stderr) => {
      resolve(stderr || "")
    })
  })
}

export function parseVideoStream(stderr: string): { codec: string | null; pixFmt: string | null } {
  const line = stderr.split("\n").find((l) => /Stream #\d+:\d+.*: Video:/.test(l)) || ""
  const codecMatch = line.match(/Video:\s*([a-z0-9]+)/i)
  const pixMatch = line.match(/,\s*(yuv[a-z0-9]+)/i)
  return {
    codec: codecMatch ? codecMatch[1].toLowerCase() : null,
    pixFmt: pixMatch ? pixMatch[1].toLowerCase() : null,
  }
}

/** Probe a video (local path or URL) for its primary video stream codec/pixel format. */
export async function probeVideo(input: string): Promise<{ codec: string | null; pixFmt: string | null }> {
  return parseVideoStream(await runFfmpegProbe(input))
}

/**
 * True only for H.264, 8-bit 4:2:0 — the profile every room-display TV box
 * can decode. HEVC/H.265 and 10/12-bit formats return false.
 */
export function isTvCompatible(codec: string | null, pixFmt: string | null): boolean {
  if (codec !== "h264" && codec !== "avc1") return false
  if (pixFmt && (pixFmt.includes("10le") || pixFmt.includes("12le"))) return false
  if (pixFmt && !pixFmt.startsWith("yuv420p")) return false
  return true
}

/** ffmpeg args to transcode any input into TV-box-safe H.264 8-bit, 30fps, <=1080p. */
export function h264TranscodeArgs(inputPath: string, outputPath: string): string[] {
  return [
    "-i", inputPath,
    "-map", "0:v:0",
    "-map", "0:a?",
    "-c:v", "libx264",
    "-profile:v", "high",
    "-level", "4.0",
    "-pix_fmt", "yuv420p",
    "-vf", "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease,fps=30",
    "-preset", "veryfast",
    "-crf", "23",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    "-y", outputPath,
  ]
}

/**
 * Given a source video buffer, return a TV-compatible buffer. If the source is
 * already H.264 8-bit it is returned unchanged (converted=false); otherwise it
 * is transcoded to H.264 (converted=true). Never throws on transcode failure
 * unless `input` is unreadable — callers decide how to handle the result.
 */
export async function ensureTvCompatibleBuffer(
  buf: Buffer,
  idHint = String(Date.now()),
): Promise<{ buffer: Buffer; converted: boolean; codec: string | null; pixFmt: string | null }> {
  const inputPath = join(tmpdir(), `compat-in-${idHint}.mp4`)
  const outputPath = join(tmpdir(), `compat-out-${idHint}.mp4`)
  try {
    await writeFile(inputPath, buf)
    const { codec, pixFmt } = await probeVideo(inputPath)
    if (isTvCompatible(codec, pixFmt)) {
      return { buffer: buf, converted: false, codec, pixFmt }
    }
    await runFfmpeg(h264TranscodeArgs(inputPath, outputPath))
    const out = await readFile(outputPath)
    return { buffer: out, converted: true, codec: "h264", pixFmt: "yuv420p" }
  } finally {
    await unlink(inputPath).catch(() => {})
    await unlink(outputPath).catch(() => {})
  }
}
