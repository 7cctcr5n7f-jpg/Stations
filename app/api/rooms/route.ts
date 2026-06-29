import { NextResponse } from "next/server"
import { sql, mapRoom } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const rows = await sql`SELECT * FROM rooms ORDER BY number ASC`
    return NextResponse.json(rows.map(mapRoom))
  } catch (error) {
    console.error("[v0] /api/rooms GET error:", error)
    return NextResponse.json({ error: "Failed to load rooms" }, { status: 500 })
  }
}
