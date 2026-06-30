export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

import { type NextRequest, NextResponse } from "next/server"
import { sql, mapRoom } from "@/lib/db"
import { generateWorkout } from "@/lib/workout-builder/engine"
import {
  getWeeklyTemplate,
  getRoundConfigs,
  getEquipmentLimits,
  getSettings,
  getVideosWithLastScheduled,
} from "@/lib/workout-builder/db"
import type { GeneratedRound } from "@/lib/workout-builder/types"

// POST { date, lockedRounds?: GeneratedRound[] }
// Generates a workout draft for the given date using the rule engine.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const date: string = body.date
    if (!date) {
      return NextResponse.json({ message: "date is required" }, { status: 400 })
    }

    const weekday = new Date(date + "T12:00:00").getDay()

    const [template, roundConfigs, equipmentLimits, settings, videoData, roomRows] = await Promise.all([
      getWeeklyTemplate(weekday),
      getRoundConfigs(),
      getEquipmentLimits(),
      getSettings(),
      getVideosWithLastScheduled(),
      sql`SELECT * FROM rooms ORDER BY number`,
    ])

    const rooms = roomRows.map(mapRoom)
    const roomNumberById = new Map(rooms.map((r) => [r.id, r.number]))

    // If no round configs exist yet, fall back to one config per room so the
    // builder still produces something the trainer can review.
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
      // Attach room numbers so the engine can apply boxing-round rules.
      configs = configs.map((c) => ({ ...c, roomNumber: roomNumberById.get(c.roomId) }))
    }

    // Build locked map by roomId
    const lockedByRoomId: Record<number, GeneratedRound> = {}
    if (Array.isArray(body.lockedRounds)) {
      for (const lr of body.lockedRounds as GeneratedRound[]) {
        if (lr.locked && lr.roomId) lockedByRoomId[lr.roomId] = lr
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

    // Attach room number/name onto rounds for display
    const roomById = new Map(rooms.map((r) => [r.id, r]))
    draft.rounds = draft.rounds.map((rd) => {
      const room = roomById.get(rd.roomId)
      return { ...rd, roomNumber: room?.number ?? 0, roomName: room?.name ?? rd.roomName }
    })
    draft.rounds.sort((a, b) => a.roomNumber - b.roomNumber)

    return NextResponse.json(draft)
  } catch (error) {
    console.error("[v0] Failed to generate workout:", error)
    return NextResponse.json({ message: "Failed to generate workout", detail: String(error) }, { status: 500 })
  }
}
