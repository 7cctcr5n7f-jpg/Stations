export const dynamic = "force-dynamic"

import { type NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  try {
    const { equipment } = await request.json()
    if (!equipment || !String(equipment).trim()) {
      return NextResponse.json({ message: "equipment is required" }, { status: 400 })
    }
    await sql`
      INSERT INTO video_options (category, value)
      VALUES ('equipment', ${String(equipment).trim()})
      ON CONFLICT (category, value) DO NOTHING
    `
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Failed to add equipment:", error)
    return NextResponse.json({ message: "Failed to add equipment" }, { status: 500 })
  }
}