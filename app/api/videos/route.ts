import { NextResponse } from "next/server"
import { sql, mapVideo } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const rows = await sql`SELECT * FROM videos ORDER BY id ASC`
    return NextResponse.json(rows.map(mapVideo))
  } catch (error) {
    console.error("[v0] /api/videos GET error:", error)
    return NextResponse.json({ error: "Failed to load videos" }, { status: 500 })
  }
}
