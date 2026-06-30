export const dynamic = "force-dynamic"

import { type NextRequest, NextResponse } from "next/server"
import { sql, mapSchedule } from "@/lib/db"
import { broadcastScheduleChange } from "@/app/api/schedules/sse/route"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const date = searchParams.get("date")
    const roomId = searchParams.get("roomId")

    let rows
    if (roomId && date) {
      rows = await sql`
        SELECT * FROM schedules
        WHERE room_id = ${Number(roomId)} AND schedule_date = ${date}
        ORDER BY position ASC, id ASC
      `
    } else if (date) {
      rows = await sql`
        SELECT * FROM schedules
        WHERE schedule_date = ${date}
        ORDER BY room_id ASC, position ASC, id ASC
      `
    } else {
      rows = await sql`
        SELECT * FROM schedules
        ORDER BY schedule_date DESC, room_id ASC, position ASC, id ASC
      `
    }

    return NextResponse.json(rows.map(mapSchedule))
  } catch (error) {
    console.error("[v0] Failed to fetch schedules:", error)
    return NextResponse.json({ message: "Failed to fetch schedules" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      roomId,
      videoId,
      scheduleDate,
      reps = "0",
      position = 1,
      displayTitle = null,
      displayEquipment = null,
      zoomLevel = "1",
      verticalPosition = "0",
      sets = 1,
      restTime = 0,
      isActive = true,
      heartRateZone = null,
    } = body

    if (!roomId || !videoId || !scheduleDate) {
      return NextResponse.json(
        { message: "roomId, videoId and scheduleDate are required" },
        { status: 400 },
      )
    }

    const rows = await sql`
      INSERT INTO schedules
        (room_id, video_id, schedule_date, reps, position, display_title, display_equipment,
         zoom_level, vertical_position, sets, rest_time, is_active, heart_rate_zone)
      VALUES
        (${roomId}, ${videoId}, ${scheduleDate}, ${String(reps)}, ${position},
         ${displayTitle}, ${displayEquipment}, ${String(zoomLevel)}, ${String(verticalPosition)},
         ${sets}, ${restTime}, ${isActive}, ${heartRateZone})
      RETURNING *
    `
    const created = mapSchedule(rows[0])
    broadcastScheduleChange(created.roomId, { type: "schedule_created", scheduleId: created.id, roomId: created.roomId, date: created.scheduleDate })
    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    console.error("[v0] Failed to create schedule:", error)
    return NextResponse.json({ message: "Failed to create schedule" }, { status: 500 })
  }
}
