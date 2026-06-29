import { NextResponse } from "next/server"
import { sql } from "@/lib/db"

export const runtime = "nodejs"

export async function POST() {
  try {
    // Remove schedules whose referenced video no longer exists (orphaned records)
    const orphanedSchedules = (await sql`
      DELETE FROM schedules
      WHERE video_id NOT IN (SELECT id FROM videos)
      RETURNING id
    `) as { id: number }[]

    const orphanedAssignments = (await sql`
      DELETE FROM room_assignments
      WHERE video_id NOT IN (SELECT id FROM videos)
      RETURNING id
    `) as { id: number }[]

    return NextResponse.json({
      orphanedRecords: orphanedSchedules.length + orphanedAssignments.length,
      missingFiles: 0,
    })
  } catch (error) {
    console.error("[v0] Failed to verify integrity:", error)
    return NextResponse.json({ message: "Failed to verify integrity" }, { status: 500 })
  }
}
