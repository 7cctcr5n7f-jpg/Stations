export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

import { type NextRequest, NextResponse } from "next/server"
import { sql, mapSchedule } from "@/lib/db"
import { broadcastScheduleChange } from "@/app/api/schedules/sse/route"
import type { GeneratedRound } from "@/lib/workout-builder/types"

// Helper: publish one day's rounds and return created schedules
async function publishDay(date: string, rounds: GeneratedRound[], replace: boolean) {
  const filled = rounds.filter((r) => r.exercises && r.exercises.length > 0)
  if (!filled.length) return []

  if (replace) {
    await sql`DELETE FROM schedules WHERE schedule_date = ${date}`
  }

  const created = []
  for (const r of filled) {
    let position = 1
    for (const ex of r.exercises) {
      const rows = await sql`
        INSERT INTO schedules
          (room_id, video_id, schedule_date, reps, position, display_title, display_equipment,
           zoom_level, vertical_position, sets, rest_time, is_active, heart_rate_zone)
        VALUES
          (${r.roomId}, ${ex.videoId}, ${date}, ${String(ex.reps ?? "0")}, ${position},
           ${null}, ${null}, ${"1"}, ${"0"}, ${1}, ${0}, ${true}, ${ex.heartRate ?? null})
        RETURNING *
      `
      created.push(mapSchedule(rows[0]))
      position++
    }
  }
  return created
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
      for (const day of toPublish) {
        const created = await publishDay(day.date, day.rounds, replace)
        allCreated.push(...created)
      }

      const roomIds = Array.from(new Set(allCreated.map((c) => c.roomId)))
      for (const roomId of roomIds) {
        broadcastScheduleChange(roomId, { type: "schedule_published", roomId })
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

    const created = await publishDay(date, rounds, replace)
    if (!created.length) {
      return NextResponse.json({ message: "No filled rounds to publish" }, { status: 400 })
    }

    const roomIds = Array.from(new Set(created.map((c) => c.roomId)))
    for (const roomId of roomIds) {
      broadcastScheduleChange(roomId, { type: "schedule_published", roomId, date })
    }

    return NextResponse.json({ ok: true, count: created.length, schedules: created }, { status: 201 })
  } catch (error) {
    console.error("[v0] Failed to publish workout:", error)
    return NextResponse.json({ message: "Failed to publish workout", detail: String(error) }, { status: 500 })
  }
}
