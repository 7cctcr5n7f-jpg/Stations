import { NextResponse } from "next/server"
import { sql, mapRoomAssignment } from "@/lib/db"

export const runtime = "nodejs"

export async function GET() {
  try {
    const rows = await sql`SELECT * FROM room_assignments ORDER BY id ASC`
    return NextResponse.json(rows.map(mapRoomAssignment))
  } catch (error) {
    console.error("[v0] Failed to fetch room assignments:", error)
    return NextResponse.json({ message: "Failed to fetch room assignments" }, { status: 500 })
  }
}
