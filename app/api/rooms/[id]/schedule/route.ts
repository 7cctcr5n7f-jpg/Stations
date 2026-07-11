import { type NextRequest, NextResponse } from "next/server"
import { sql, mapSchedule } from "@/lib/db"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

function buildScheduleFingerprint(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return ""

  const base = rows
    .map((row) =>
      [
        row.id ?? "",
        row.video_id ?? "",
        row.reps ?? "",
        row.position ?? "",
        row.display_title ?? "",
        row.display_equipment ?? "",
        row.zoom_level ?? "",
        row.vertical_position ?? "",
        row.sets ?? "",
        row.rest_time ?? "",
        row.is_active ?? "",
        row.heart_rate_zone ?? "",
      ].join("|"),
    )
    .join(";")

  let hash = 0
  for (let i = 0; i < base.length; i++) {
    hash = (hash * 31 + base.charCodeAt(i)) | 0
  }
  return String(hash)
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const roomId = Number(id)
    if (!Number.isFinite(roomId)) {
      return NextResponse.json({ error: "Invalid room id" }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    const date = searchParams.get("date")
    const mode = searchParams.get("mode")

    if (!date) {
      return NextResponse.json({ error: "date is required" }, { status: 400 })
    }

    if (mode === "fingerprint") {
      const rows = await sql`
        SELECT
          id,
          video_id,
          reps,
          position,
          display_title,
          display_equipment,
          zoom_level,
          vertical_position,
          sets,
          rest_time,
          is_active,
          heart_rate_zone
        FROM schedules
        WHERE room_id = ${roomId} AND schedule_date = ${date}
        ORDER BY position ASC, id ASC
      `

      return NextResponse.json({
        roomId,
        date,
        rowCount: rows.length,
        maxId: rows.length ? Number(rows[rows.length - 1].id) : 0,
        fingerprint: buildScheduleFingerprint(rows as Array<Record<string, unknown>>),
      })
    }

    const rows = await sql`
      SELECT
        s.id,
        s.room_id,
        s.video_id,
        s.schedule_date,
        s.reps,
        s.position,
        s.display_title,
        s.display_equipment,
        s.zoom_level,
        s.vertical_position,
        s.sets,
        s.rest_time,
        s.is_active,
        s.heart_rate_zone,
        v.title AS video_title,
        v.url AS video_url,
        v.duration AS video_duration,
        v.category AS video_category,
        v.equipment AS video_equipment,
        v.intensity AS video_intensity
      FROM schedules s
      INNER JOIN videos v ON v.id = s.video_id
      WHERE s.room_id = ${roomId} AND s.schedule_date = ${date}
      ORDER BY s.position ASC, s.id ASC
    `

    const assignments = rows.map((row) => {
      const schedule = mapSchedule(row)
      return {
        id: schedule.id,
        roomId: schedule.roomId,
        videoId: schedule.videoId,
        sets: schedule.sets ?? 1,
        reps: schedule.reps ?? "0",
        restTime: schedule.restTime ?? 0,
        position: schedule.position ?? 1,
        isActive: schedule.isActive ?? true,
        zoomLevel: schedule.zoomLevel ?? "1",
        verticalPosition: schedule.verticalPosition ?? "0",
        displayEquipment: schedule.displayEquipment ?? row.video_equipment,
        video: {
          id: schedule.videoId,
          title: schedule.displayTitle ?? row.video_title,
          url: row.video_url,
          duration: row.video_duration ?? null,
          bodyPart: row.video_category ?? "",
          equipment: schedule.displayEquipment ?? row.video_equipment ?? "",
          intensity: row.video_intensity ?? null,
        },
      }
    })

    const fingerprint = buildScheduleFingerprint(rows as Array<Record<string, unknown>>)

    return NextResponse.json({
      roomId,
      date,
      assignments,
      fingerprint,
    })
  } catch (error) {
    console.error("[v0] /api/rooms/[id]/schedule GET error:", error)
    return NextResponse.json({ error: "Failed to load room schedule" }, { status: 500 })
  }
}
