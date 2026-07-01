import { NextResponse } from "next/server"
import { sql } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const today = new Date().toISOString().split("T")[0]

    // Single round-trip: all four counts in one query using subqueries.
    const [row] = await sql`
      SELECT
        (SELECT COUNT(*)::int FROM rooms WHERE is_active = true)          AS active_rooms,
        (SELECT COUNT(*)::int FROM videos)                                AS total_videos,
        (SELECT COUNT(*)::int FROM schedules WHERE schedule_date = ${today})        AS today_schedules,
        (SELECT COUNT(DISTINCT video_id)::int FROM schedules WHERE schedule_date = ${today}) AS videos_in_use
    `

    return NextResponse.json({
      activeRooms:    row?.active_rooms    ?? 0,
      videosInUse:    row?.videos_in_use   ?? 0,
      totalVideos:    row?.total_videos    ?? 0,
      todaySchedules: row?.today_schedules ?? 0,
    }, {
      headers: {
        // Stats are summary counts; 30 s edge cache is acceptable.
        "Cache-Control": "s-maxage=30, stale-while-revalidate=60",
      },
    })
  } catch (error) {
    console.error("[v0] /api/stats error:", error)
    return NextResponse.json({ error: "Failed to load stats" }, { status: 500 })
  }
}
