import { NextResponse } from "next/server"
import { sql, mapRoom } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const rows = await sql`SELECT * FROM rooms ORDER BY number ASC`
    return NextResponse.json(rows.map(mapRoom), {
      headers: {
        // Edge-cache for 60 s; serve stale for up to 5 min while revalidating.
        // Rooms change rarely; this saves a DB round-trip on every new tab.
        "Cache-Control": "s-maxage=60, stale-while-revalidate=300",
      },
    })
  } catch (error) {
    console.error("[v0] /api/rooms GET error:", error)
    return NextResponse.json({ error: "Failed to load rooms" }, { status: 500 })
  }
}
