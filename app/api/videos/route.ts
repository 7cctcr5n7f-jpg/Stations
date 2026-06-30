import { NextResponse } from "next/server"
import { sql, mapVideo } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    // Join with schedules to compute last_used (most recent past date) and
    // next_scheduled (nearest future date) per video in one query.
    const rows = await sql`
      SELECT
        v.*,
        GREATEST(
          v.last_used,
          MAX(CASE WHEN s.schedule_date < CURRENT_DATE THEN s.schedule_date::timestamp ELSE NULL END)
        ) AS computed_last_used,
        MIN(CASE WHEN s.schedule_date >= CURRENT_DATE THEN s.schedule_date ELSE NULL END) AS next_scheduled,
        COUNT(s.id) AS times_used
      FROM videos v
      LEFT JOIN schedules s ON s.video_id = v.id
      GROUP BY v.id
      ORDER BY v.id ASC
    `
    return NextResponse.json(rows.map(mapVideo))
  } catch (error) {
    console.error("[v0] /api/videos GET error:", error)
    return NextResponse.json({ error: "Failed to load videos" }, { status: 500 })
  }
}
