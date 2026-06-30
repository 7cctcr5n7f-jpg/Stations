export const dynamic = "force-dynamic"

import { type NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  try {
    const { bodyPart } = await request.json()
    if (!bodyPart || !String(bodyPart).trim()) {
      return NextResponse.json({ message: "bodyPart is required" }, { status: 400 })
    }
    await sql`
      INSERT INTO video_options (category, value)
      VALUES ('bodyPart', ${String(bodyPart).trim()})
      ON CONFLICT (category, value) DO NOTHING
    `
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Failed to add body part:", error)
    return NextResponse.json({ message: "Failed to add body part" }, { status: 500 })
  }
}