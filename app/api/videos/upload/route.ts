export const dynamic = "force-dynamic"

import { type NextRequest, NextResponse } from "next/server"
import { sql, mapVideo } from "@/lib/db"
import { uploadToR2 } from "@/lib/r2"
import { ensureTvCompatibleBuffer } from "@/lib/video-compat"

export const runtime = "nodejs"
export const maxDuration = 300

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || ""
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      return NextResponse.json({ message: "Expected multipart form data" }, { status: 400 })
    }

    const formData = await request.formData()
    const file = formData.get("video") as File | null
    const title = (formData.get("title") as string) || ""
    const bodyPart = (formData.get("bodyPart") as string) || ""
    const secondaryMuscle = (formData.get("secondaryMuscle") as string) || ""
    const equipment = (formData.get("equipment") as string) || ""
    // Optional AI-reviewed metadata from the upload modal.
    const movementPattern = (formData.get("movementPattern") as string) || null
    const intensity = (formData.get("intensity") as string) || null
    const exerciseType = (formData.get("exerciseType") as string) || null
    const explosive = formData.get("explosive") === "true"
    const weightRequired = formData.get("weightRequired") === "true"
    const spaceRequirement = (formData.get("spaceRequirement") as string) || null
    const boxingType = (formData.get("boxingType") as string) || null
    const aiConfidenceRaw = formData.get("aiConfidence") as string | null
    const aiConfidence = aiConfidenceRaw ? Number(aiConfidenceRaw) : null

    if (!file) {
      return NextResponse.json({ message: "No video file provided" }, { status: 400 })
    }
    if (!title) {
      return NextResponse.json({ message: "Title is required" }, { status: 400 })
    }

    // Ensure the uploaded clip plays on the room-display Android TV boxes.
    // Those only decode H.264 8-bit; HEVC/H.265 and 10-bit clips (the iPhone
    // "High Efficiency" default) must be transcoded before storage.
    const originalBuf = Buffer.from(await file.arrayBuffer())
    let uploadBuf = originalBuf
    let videoCodec: string | null = null
    let pixelFormat: string | null = null
    let wasConverted = false
    try {
      const result = await ensureTvCompatibleBuffer(originalBuf)
      uploadBuf = result.buffer
      videoCodec = result.codec
      pixelFormat = result.pixFmt
      wasConverted = result.converted
      if (wasConverted) {
        console.log(`[v0] Upload auto-converted to H.264 (was ${videoCodec ?? "unknown"}/${pixelFormat ?? "?"})`)
      }
    } catch (e) {
      // If probing/transcoding fails, fall back to storing the original file.
      console.error("[v0] Upload compatibility check failed, storing original:", e)
      uploadBuf = originalBuf
    }

    // Upload to Cloudflare R2
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
    const key = `videos/${Date.now()}${wasConverted ? "-h264" : ""}-${safeName.replace(/\.[^.]+$/, "")}.mp4`
    const videoUrl = await uploadToR2(key, uploadBuf as any, "video/mp4")

    // After (possible) conversion the stored file is always TV compatible when
    // we successfully probed/transcoded it; only unknown if the check failed.
    const finalCodec = wasConverted ? "h264" : videoCodec
    const finalPix = wasConverted ? "yuv420p" : pixelFormat
    const tvCompatible = finalCodec ? finalCodec === "h264" : null

    const rows = await sql`
      INSERT INTO videos (
        title, url, storage_key, body_part, secondary_muscle, equipment,
        movement_pattern, intensity, exercise_type, explosive,
        weight_required, space_requirement, boxing_type,
        ai_confidence, ai_generated_at,
        video_codec, pixel_format, tv_compatible, codec_checked_at, converted_at
      )
      VALUES (
        ${title},
        ${videoUrl},
        ${key},
        ${bodyPart},
        ${secondaryMuscle === "none" ? null : secondaryMuscle},
        ${equipment},
        ${movementPattern},
        ${intensity},
        ${exerciseType},
        ${explosive},
        ${weightRequired},
        ${spaceRequirement},
        ${boxingType},
        ${aiConfidence},
        ${aiConfidence != null ? new Date().toISOString() : null},
        ${finalCodec},
        ${finalPix},
        ${tvCompatible},
        ${finalCodec ? new Date().toISOString() : null},
        ${wasConverted ? new Date().toISOString() : null}
      )
      RETURNING *
    `
    return NextResponse.json(mapVideo(rows[0]), { status: 201 })
  } catch (error) {
    console.error("[v0] Video upload error:", error)
    return NextResponse.json({ message: "Failed to upload video" }, { status: 500 })
  }
}
