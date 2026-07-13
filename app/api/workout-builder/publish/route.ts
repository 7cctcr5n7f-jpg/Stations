export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

import { type NextRequest, NextResponse } from "next/server"
import { sql, mapSchedule } from "@/lib/db"
import { broadcastScheduleChange } from "@/app/api/schedules/sse/route"
import { syncChowForScheduleChanges } from "@/lib/chow"
import type { GeneratedRound } from "@/lib/workout-builder/types"

// Helper: publish one day's rounds and return created schedules
async function publishDay(date: string, rounds: GeneratedRound[], replace: boolean) {
  const filled = rounds.filter((r) => r.exercises && r.exercises.length > 0)
  if (!filled.length) return { created: [] as ReturnType<typeof mapSchedule>[], affectedRoomIds: [] as number[] }

  const affectedRoomIds = new Set<number>()

  if (replace) {
    const existingRows = await sql`SELECT DISTINCT room_id FROM schedules WHERE schedule_date = ${date}`
    for (const row of existingRows) affectedRoomIds.add(Number(row.room_id))
    await sql`DELETE FROM schedules WHERE schedule_date = ${date}`
  }

  const created = []
  for (const r of filled) {
    affectedRoomIds.add(r.roomId)
    let position = 1
    for (const ex of r.exercises) {
      // Dropset rounds always publish "Dropset" regardless of exercise-level reps.
      // For all other rounds use the engine-assigned reps string, falling back to "0".
      const repsValue = r.dropset ? "Dropset" : String(ex.reps ?? "0")
      const rows = await sql`
        INSERT INTO schedules
          (room_id, video_id, schedule_date, reps, position, display_title, display_equipment,
           zoom_level, vertical_position, sets, rest_time, is_active, heart_rate_zone)
        VALUES
          (${r.roomId}, ${ex.videoId}, ${date}, ${repsValue}, ${position},
           ${null}, ${null}, ${"1"}, ${"0"}, ${1}, ${0}, ${true}, ${ex.heartRate ?? null})
        RETURNING *
      `
      created.push(mapSchedule(rows[0]))
      position++
    }
  }
  return { created, affectedRoomIds: Array.from(affectedRoomIds) }
}

// POST — supports both single-day and weekly publish.
//
// Single day:  { date, rounds, replace? }
// Weekly:      { days: Array<{ date, rounds }>, replace?, selectedDates?: string[] }
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      // single
      date?: string
      rounds?: GeneratedRound[]
      // weekly
      days?: Array<{ date: string; rounds: GeneratedRound[] }>
      selectedDates?: string[]
      replace?: boolean
    }
    const replace = body.replace !== false

    // ---- Weekly publish ----
    if (Array.isArray(body.days)) {
      let toPublish = body.days
      if (body.selectedDates?.length) {
        toPublish = body.days.filter((d) => body.selectedDates!.includes(d.date))
      }
      if (toPublish.length === 0) {
        return NextResponse.json({ message: "No days selected to publish" }, { status: 400 })
      }

      const allCreated = []
      const chowChanges: Array<{ scheduleDate: string; roomId: number }> = []
      for (const day of toPublish) {
        const result = await publishDay(day.date, day.rounds, replace)
        allCreated.push(...result.created)
        for (const roomId of result.affectedRoomIds) {
          chowChanges.push({ scheduleDate: day.date, roomId })
        }
      }

      const chowSyncs = await syncChowForScheduleChanges(chowChanges)

      const roomIds = Array.from(new Set(allCreated.map((c) => c.roomId)))
      for (const roomId of roomIds) {
        broadcastScheduleChange(roomId, { type: "schedule_published", roomId })
      }
      for (const sync of chowSyncs) {
        for (const date of sync.syncedDates) {
          broadcastScheduleChange(sync.roomId, { type: "schedule_published", roomId: sync.roomId, date })
        }
      }

      return NextResponse.json(
        { ok: true, count: allCreated.length, days: toPublish.length },
        { status: 201 },
      )
    }

    // ---- Single day publish ----
    const { date, rounds } = body
    if (!date || !Array.isArray(rounds)) {
      return NextResponse.json({ message: "date and rounds are required" }, { status: 400 })
    }

    const result = await publishDay(date, rounds, replace)
    const created = result.created
    if (!created.length) {
      return NextResponse.json({ message: "No filled rounds to publish" }, { status: 400 })
    }

    const chowSyncs = await syncChowForScheduleChanges(
      result.affectedRoomIds.map((roomId) => ({ scheduleDate: date, roomId })),
    )

    const roomIds = Array.from(new Set(created.map((c) => c.roomId)))
    for (const roomId of roomIds) {
      broadcastScheduleChange(roomId, { type: "schedule_published", roomId, date })
    }
    for (const sync of chowSyncs) {
      for (const syncedDate of sync.syncedDates) {
        broadcastScheduleChange(sync.roomId, { type: "schedule_published", roomId: sync.roomId, date: syncedDate })
      }
    }

    return NextResponse.json({ ok: true, count: created.length, schedules: created }, { status: 201 })
  } catch (error) {
    console.error("[v0] Failed to publish workout:", error)
    return NextResponse.json({ message: "Failed to publish workout", detail: String(error) }, { status: 500 })
  }
}
