export const dynamic = "force-dynamic"

import { type NextRequest, NextResponse } from "next/server"
import { sql, mapSchedule } from "@/lib/db"

export const runtime = "nodejs"

const FIELD_MAP: Record<string, string> = {
  roomId: "room_id",
  videoId: "video_id",
  scheduleDate: "schedule_date",
  reps: "reps",
  position: "position",
  displayTitle: "display_title",
  displayEquipment: "display_equipment",
  zoomLevel: "zoom_level",
  verticalPosition: "vertical_position",
}

// Fields that are stored as text in the DB
const TEXT_FIELDS = new Set(["reps", "zoomLevel", "verticalPosition"])

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const scheduleId = Number(id)
    const body = await request.json()

    const setClauses: string[] = []
    const values: unknown[] = []
    let i = 1

    for (const [key, value] of Object.entries(body)) {
      const column = FIELD_MAP[key]
      if (!column) continue
      setClauses.push(`${column} = $${i}`)
      values.push(TEXT_FIELDS.has(key) && value !== null ? String(value) : value)
      i++
    }

    if (setClauses.length === 0) {
      return NextResponse.json({ message: "No valid fields to update" }, { status: 400 })
    }

    values.push(scheduleId)
    const query = `UPDATE schedules SET ${setClauses.join(", ")} WHERE id = $${i} RETURNING *`
    const rows = (await sql.query(query, values)) as Record<string, unknown>[]

    if (rows.length === 0) {
      return NextResponse.json({ message: "Schedule not found" }, { status: 404 })
    }
    return NextResponse.json(mapSchedule(rows[0]))
  } catch (error) {
    console.error("[v0] Failed to update schedule:", error)
    return NextResponse.json({ message: "Failed to update schedule" }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await sql`DELETE FROM schedules WHERE id = ${Number(id)}`
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Failed to delete schedule:", error)
    return NextResponse.json({ message: "Failed to delete schedule" }, { status: 500 })
  }
}