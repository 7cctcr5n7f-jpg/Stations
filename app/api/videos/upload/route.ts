export const dynamic = "force-dynamic"

import { put } from "@vercel/blob"
import { type NextRequest, NextResponse } from "next/server"
import { sql, mapVideo } from "@/lib/db"

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

    if (!file) {
      return NextResponse.json({ message: "No video file provided" }, { status: 400 })
    }
    if (!title) {
      return NextResponse.json({ message: "Title is required" }, { status: 400 })
    }

    // Upload to Vercel Blob (public store) with a unique pathname
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
    const pathname = `videos/${Date.now()}-${safeName}`
    const blob = await put(pathname, file, {
      access: "public",
      contentType: file.type || "video/mp4",
    })

    const rows = await sql`
      INSERT INTO videos (title, url, body_part, secondary_muscle, equipment)
      VALUES (
        ${title},
        ${blob.url},
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