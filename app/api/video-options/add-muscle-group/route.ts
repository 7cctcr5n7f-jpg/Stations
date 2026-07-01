import { type NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const muscleGroup = typeof body.muscleGroup === "string" ? body.muscleGroup.trim() : null
    if (!muscleGroup) {
      return NextResponse.json({ error: "muscleGroup is required" }, { status: 400 })
    }
    // Insert only if not already present.
    await sql`
      INSERT INTO video_options (category, value)
      VALUES ('muscleGroup', ${muscleGroup})
      ON CONFLICT DO NOTHING
    `
    return NextResponse.json({ success: true, muscleGroup })
  } catch (error) {
    console.error("[v0] /api/video-options/add-muscle-group POST error:", error)
    return NextResponse.json({ error: "Failed to add muscle group" }, { status: 500 })
  }
}
