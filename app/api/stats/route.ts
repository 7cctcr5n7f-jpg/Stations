import { NextResponse } from "next/server"
import { sql } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const today = new Date().toISOString().split("T")[0]

    const [activeRooms] = await sql`SELECT COUNT(*)::int AS count FROM rooms WHERE is_active = true`
    const [totalVideos] = await sql`SELECT COUNT(*)::int AS count FROM videos`
    const [todaySchedules] = await sql`SELECT COUNT(*)::int AS count FROM schedules WHERE schedule_date = ${today}`
    const [videosInUse] =
      await sql`SELECT COUNT(DISTINCT video_id)::int AS count FROM schedules WHERE schedule_date = ${today}`

    return NextResponse.json({
      activeRooms: activeRooms?.count ?? 0,
      videosInUse: videosInUse?.count ?? 0,
      totalVideos: totalVideos?.count ?? 0,
      todaySchedules: todaySchedules?.count ?? 0,
    })
  } catch (error) {
    console.error("[v0] /api/stats error:", error)
    return NextResponse.json({ error: "Failed to load stats" }, { status: 500 })
  }
}
