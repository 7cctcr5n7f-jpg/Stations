export const dynamic = "force-dynamic"

import { type NextRequest, NextResponse } from "next/server"
import { sql, mapVideo } from "@/lib/db"
import { uploadToR2 } from "@/lib/r2"

export const runtime = "nodejs"
export const maxDuration = 60

export async function POST(request: NextRequest) {
  try {
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

    // Upload to Cloudflare R2
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
    const key = `videos/${Date.now()}-${safeName}`
    const videoUrl = await uploadToR2(key, await file.arrayBuffer() as any, file.type || "video/mp4")

    const rows = await sql`
      INSERT INTO videos (title, url, body_part, secondary_muscle, equipment)
      VALUES (
        ${title},
        ${videoUrl},
        ${bodyPart},
        ${secondaryMuscle === "none" ? null : secondaryMuscle},
        ${equipment}
      )
      RETURNING *
    `
    return NextResponse.json(mapVideo(rows[0]), { status: 201 })
  } catch (error) {
    console.error("[v0] Video upload error:", error)
    return NextResponse.json({ message: "Failed to upload video" }, { status: 500 })
  }
}
