export const dynamic = "force-dynamic"

import { type NextRequest, NextResponse } from "next/server"
import { sql, mapSchedule } from "@/lib/db"
import { broadcastScheduleChange } from "@/app/api/schedules/sse/route"
import { syncChowForScheduleChanges } from "@/lib/chow"

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
  sets: "sets",
  restTime: "rest_time",
  isActive: "is_active",
  heartRateZone: "heart_rate_zone",
}

// Fields that are stored as text in the DB
const TEXT_FIELDS = new Set(["reps", "zoomLevel", "verticalPosition"])

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const scheduleId = Number(id)
    const body = await request.json()
    const existingRows = await sql`SELECT * FROM schedules WHERE id = ${scheduleId}`
    if (existingRows.length === 0) {
      return NextResponse.json({ message: "Schedule not found" }, { status: 404 })
    }
    const previous = mapSchedule(existingRows[0])

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
    const updated = mapSchedule(rows[0])
    const chowSyncs = await syncChowForScheduleChanges([
      { scheduleDate: previous.scheduleDate, roomId: previous.roomId },
      { scheduleDate: updated.scheduleDate, roomId: updated.roomId },
    ])
    const updatedRow = (await sql`SELECT * FROM schedules WHERE id = ${scheduleId}`)[0]
    const fallbackRow =
      updatedRow ??
      (
        await sql`
          SELECT *
          FROM schedules
          WHERE room_id = ${updated.roomId} AND schedule_date = ${updated.scheduleDate}
          ORDER BY position ASC, id ASC
          LIMIT 1
        `
      )[0]
    const responseSchedule = fallbackRow ? mapSchedule(fallbackRow) : updated
    broadcastScheduleChange(updated.roomId, { type: "schedule_updated", scheduleId: updated.id, roomId: updated.roomId, date: updated.scheduleDate })
    for (const sync of chowSyncs) {
      for (const date of sync.syncedDates) {
        broadcastScheduleChange(sync.roomId, { type: "schedule_published", roomId: sync.roomId, date })
      }
    }
    return NextResponse.json(responseSchedule)
  } catch (error) {
    console.error("[v0] Failed to update schedule:", error)
    return NextResponse.json({ message: "Failed to update schedule" }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const scheduleId = Number(id)
    // Fetch before deleting so we know which room to notify
    const rows = await sql`SELECT * FROM schedules WHERE id = ${scheduleId}`
    const previous = rows[0] ? mapSchedule(rows[0]) : null
    await sql`DELETE FROM schedules WHERE id = ${scheduleId}`
    const chowSyncs = previous
      ? await syncChowForScheduleChanges([{ scheduleDate: previous.scheduleDate, roomId: previous.roomId }])
      : []
    if (previous) {
      broadcastScheduleChange(previous.roomId, { type: "schedule_deleted", scheduleId, roomId: previous.roomId, date: previous.scheduleDate })
    }
    for (const sync of chowSyncs) {
      for (const date of sync.syncedDates) {
        broadcastScheduleChange(sync.roomId, { type: "schedule_published", roomId: sync.roomId, date })
      }
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Failed to delete schedule:", error)
    return NextResponse.json({ message: "Failed to delete schedule" }, { status: 500 })
  }
}
