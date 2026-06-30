export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

import { type NextRequest, NextResponse } from "next/server"
import { sql, mapSchedule } from "@/lib/db"
import { broadcastScheduleChange } from "@/app/api/schedules/sse/route"
import type { GeneratedRound } from "@/lib/workout-builder/types"

// POST { date, rounds, replace? }
// Publishes a generated workout into the schedules table for the given date.
// By default it REPLACES any existing schedule rows for that date.
export async function POST(request: NextRequest) {
  try {
    const { date, rounds, replace = true } = (await request.json()) as {
      date: string
      rounds: GeneratedRound[]
      replace?: boolean
    }

    if (!date || !Array.isArray(rounds)) {
      return NextResponse.json({ message: "date and rounds are required" }, { status: 400 })
    }

    const filled = rounds.filter((r) => r.exercises && r.exercises.length > 0)
    if (filled.length === 0) {
      return NextResponse.json({ message: "No filled rounds to publish" }, { status: 400 })
    }

    // Replace existing schedule for this date
    if (replace) {
      await sql`DELETE FROM schedules WHERE schedule_date = ${date}`
    }

    const created = []
    for (const r of filled) {
      // Each exercise in the round becomes its own schedule row, ordered by
      // position (1, 2, ...). A dropset round simply has a single exercise.
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

    // Broadcast a change for every affected room so live displays refresh
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
