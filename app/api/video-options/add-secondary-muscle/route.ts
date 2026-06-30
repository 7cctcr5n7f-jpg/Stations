export const dynamic = "force-dynamic"

import { type NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  try {
    const { secondaryMuscle } = await request.json()
    if (!secondaryMuscle || !String(secondaryMuscle).trim()) {
      return NextResponse.json({ message: "secondaryMuscle is required" }, { status: 400 })
    }
    await sql`
      INSERT INTO video_options (category, value)
      VALUES ('secondaryMuscle', ${String(secondaryMuscle).trim()})
      ON CONFLICT (category, value) DO NOTHING
    `
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Failed to add secondary muscle:", error)
    return NextResponse.json({ message: "Failed to add secondary muscle" }, { status: 500 })
  }
}