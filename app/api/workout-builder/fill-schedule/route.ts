export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

import { type NextRequest, NextResponse } from "next/server"
import { sql, mapRoom } from "@/lib/db"
import { broadcastScheduleChange } from "@/app/api/schedules/sse/route"
import { generateWorkout } from "@/lib/workout-builder/engine"
import {
  getWeeklyTemplate,
  getRoundConfigs,
  getEquipmentLimits,
  getSettings,
  getVideosWithLastScheduled,
} from "@/lib/workout-builder/db"
import type { GeneratedRound, RoundExercise, HeartRate } from "@/lib/workout-builder/types"

// POST { date }
// Fills the schedule for a date: existing rows are kept as-is (and locked so
// the engine won't duplicate them), and only the EMPTY rounds get generated
// and inserted. If the day is empty, this builds a full workout.
export async function POST(request: NextRequest) {
  try {
    const { date } = (await request.json()) as { date: string }
    if (!date) {
      return NextResponse.json({ message: "date is required" }, { status: 400 })
    }

    const weekday = new Date(date + "T12:00:00").getDay()

    const [template, roundConfigs, equipmentLimits, settings, videoData, roomRows, existingRows] =
      await Promise.all([
        getWeeklyTemplate(weekday),
        getRoundConfigs(),
        getEquipmentLimits(),
        getSettings(),
        getVideosWithLastScheduled(),
        sql`SELECT * FROM rooms ORDER BY number`,
        sql`SELECT * FROM schedules WHERE schedule_date = ${date} ORDER BY room_id, position`,
      ])

    const rooms = roomRows.map(mapRoom)
    const roomNumberById = new Map(rooms.map((r) => [r.id, r.number]))
    const videoById = new Map(videoData.videos.map((v) => [v.id, v]))

    // Build configs (one per room if none configured), attach room numbers.
    let configs = roundConfigs
    if (configs.length === 0) {
      configs = rooms.map((r) => ({
        roomId: r.id,
        roomNumber: r.number,
        stationName: r.name,
        stationRole: r.description ?? null,
        preferredEquipment: [],
        allowedEquipment: [],
        avoidEquipment: [],
        preferredCategories: [],
        preferredHeartRate: null,
        preferredIntensity: null,
        availableSpace: null,
        coreOnly: false,
      }))
    } else {
      configs = configs.map((c) => ({ ...c, roomNumber: roomNumberById.get(c.roomId) }))
    }

    // Group existing schedule rows by room → locked rounds. Rooms that already
    // have at least one exercise are preserved untouched.
    const existingByRoom = new Map<number, any[]>()
    for (const row of existingRows) {
      const list = existingByRoom.get(row.room_id) ?? []
      list.push(row)
      existingByRoom.set(row.room_id, list)
    }

    const lockedByRoomId: Record<number, GeneratedRound> = {}
    for (const [roomId, rows] of existingByRoom) {
      const exercises: RoundExercise[] = rows
        .map((row) => {
          const video = videoById.get(row.video_id)
          if (!video) return null
          return {
            videoId: row.video_id,
            video,
            heartRate: (row.heart_rate_zone as HeartRate) ?? null,
            reps: row.reps ? Number(row.reps) : null,
            score: 100,
            reasons: ["Already scheduled — kept in place"],
            warnings: [],
            isBoxing: false,
            gloveCompatible: true,
          } as RoundExercise
        })
        .filter(Boolean) as RoundExercise[]
      if (exercises.length === 0) continue
      lockedByRoomId[roomId] = {
        roomId,
        roomNumber: roomNumberById.get(roomId) ?? 0,
        roomName: rooms.find((r) => r.id === roomId)?.name ?? "Round",
        exercises,
        isBoxingRound: false,
        glovesOn: false,
        dropset: exercises.length === 1,
        locked: true,
        score: 100,
        reasons: [],
        warnings: [],
      }
    }

    const draft = generateWorkout({
      date,
      weekday,
      template,
      roundConfigs: configs,
      equipmentLimits,
      settings,
      videos: videoData.videos,
      lastScheduledById: videoData.lastScheduledById,
      lockedByRoomId,
    })

    // Insert ONLY the rooms that were previously empty. Existing rows are left
    // exactly as the trainer set them (display settings preserved).
    const created: number[] = []
    const filledRoomIds: number[] = []
    for (const r of draft.rounds) {
      if (lockedByRoomId[r.roomId]) continue // preserve existing
      if (!r.exercises || r.exercises.length === 0) continue
      let position = 1
      for (const ex of r.exercises) {
        await sql`
          INSERT INTO schedules
            (room_id, video_id, schedule_date, reps, position, display_title, display_equipment,
             zoom_level, vertical_position, sets, rest_time, is_active, heart_rate_zone)
          VALUES
            (${r.roomId}, ${ex.videoId}, ${date}, ${String(ex.reps ?? "0")}, ${position},
             ${null}, ${null}, ${"1"}, ${"0"}, ${1}, ${0}, ${true}, ${ex.heartRate ?? null})
        `
        created.push(ex.videoId)
        position++
      }
      filledRoomIds.push(r.roomId)
    }

    for (const roomId of filledRoomIds) {
      broadcastScheduleChange(roomId, { type: "schedule_published", roomId, date })
    }

    return NextResponse.json({
      ok: true,
      filledRooms: filledRoomIds.length,
      addedExercises: created.length,
      keptRooms: Object.keys(lockedByRoomId).length,
    })
  } catch (error) {
    console.error("[v0] Failed to fill schedule:", error)
    return NextResponse.json({ message: "Failed to fill schedule", detail: String(error) }, { status: 500 })
  }
}
