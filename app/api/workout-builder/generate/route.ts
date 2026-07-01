export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 120

import { type NextRequest, NextResponse } from "next/server"
import { sql, mapRoom } from "@/lib/db"
import { generateWorkout } from "@/lib/workout-builder/engine"
import {
  getAllWeeklyTemplates,
  getWeeklyTemplate,
  getRoundConfigs,
  getEquipmentLimits,
  getSettings,
  getVideosWithLastScheduled,
} from "@/lib/workout-builder/db"
import type { BuilderParams, GeneratedRound } from "@/lib/workout-builder/types"

// Helper: given a Monday date string, return yyyy-mm-dd strings for Mon–Sat
function weekDates(mondayIso: string): string[] {
  const base = new Date(mondayIso + "T12:00:00")
  const dates: string[] = []
  for (let i = 0; i < 6; i++) {
    const d = new Date(base)
    d.setDate(base.getDate() + i)
    dates.push(d.toISOString().split("T")[0])
  }
  return dates
}

// Ensure round configs carry roomNumber for the engine
function attachRoomNumbers(
  configs: Awaited<ReturnType<typeof getRoundConfigs>>,
  roomNumberById: Map<number, number>,
) {
  return configs.map((c) => ({ ...c, roomNumber: roomNumberById.get(c.roomId) }))
}

// POST { params: BuilderParams, lockedRounds?: GeneratedRound[] }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const params: BuilderParams = body.params
    const lockedRounds: GeneratedRound[] = Array.isArray(body.lockedRounds) ? body.lockedRounds : []

    if (!params?.startDate) {
      return NextResponse.json({ message: "params.startDate is required" }, { status: 400 })
    }

    // Pre-load shared data once
    const [roundConfigs, equipmentLimits, settings, videoData, roomRows] = await Promise.all([
      getRoundConfigs(),
      getEquipmentLimits(),
      getSettings(),
      getVideosWithLastScheduled(),
      sql`SELECT * FROM rooms ORDER BY number`,
    ])

    const rooms = roomRows.map(mapRoom)
    const roomNumberById = new Map(rooms.map((r) => [r.id, r.number]))
    const roomById = new Map(rooms.map((r) => [r.id, r]))

    let configs = roundConfigs.length
      ? attachRoomNumbers(roundConfigs, roomNumberById)
      : rooms.map((r) => ({
          roomId: r.id,
          roomNumber: r.number,
          stationName: r.name,
          stationRole: r.description ?? null,
          preferredEquipment: [] as string[],
          allowedEquipment: [] as string[],
          avoidEquipment: [] as string[],
          preferredCategories: [] as string[],
          preferredHeartRate: null,
          preferredIntensity: null,
          availableSpace: null,
          coreOnly: false,
        }))

    // Build locked map by roomId (only used for single-day; for week, locked state
    // is per-day, so we only apply it when the day date matches lockedRounds date)
    const lockedByRoomId: Record<number, GeneratedRound> = {}
    for (const lr of lockedRounds) {
      if (lr.locked && lr.roomId) lockedByRoomId[lr.roomId] = lr
    }

    // ---- SINGLE DAY --------------------------------------------------------
    if (params.mode === "single") {
      const date = params.startDate
      const weekday = new Date(date + "T12:00:00").getDay()
      const template = await getWeeklyTemplate(weekday)

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
        params,
      })

      draft.rounds = draft.rounds.map((rd) => {
        const room = roomById.get(rd.roomId)
        return { ...rd, roomNumber: room?.number ?? 0, roomName: room?.name ?? rd.roomName }
      })
      draft.rounds.sort((a, b) => a.roomNumber - b.roomNumber)

      return NextResponse.json({ mode: "single", day: draft })
    }

    // ---- TRAINING WEEK (Mon–Sat) -------------------------------------------
    const dates = weekDates(params.startDate)
    const allTemplates = await getAllWeeklyTemplates()
    const templateByWeekday = new Map(allTemplates.map((t) => [t.weekday, t]))

    const days = []
    // Track used video IDs across the whole week for better rotation
    const weekUsedVideoIds = new Set<number>()

    // Mirror pairs: Mon(idx 0) ↔ Thu(idx 3), Tue(idx 1) ↔ Fri(idx 4), Wed(idx 2) ↔ Sat(idx 5)
    // We store video IDs used on each day so the mirror day can exclude them.
    const videosByDayIndex: number[][] = []

    for (let dayIndex = 0; dayIndex < dates.length; dayIndex++) {
      const date = dates[dayIndex]
      const weekday = new Date(date + "T12:00:00").getDay()
      const template = templateByWeekday.get(weekday) ?? null

      // Build a modified lastScheduledById that penalises videos used earlier this week.
      // For mirror days (Thu/Fri/Sat), also hard-exclude the videos from the corresponding
      // earlier day (Mon/Tue/Wed) so the workout is noticeably different.
      const lastScheduledWithWeek = { ...videoData.lastScheduledById }
      for (const id of weekUsedVideoIds) {
        if (!lastScheduledWithWeek[id]) {
          lastScheduledWithWeek[id] = date
        }
      }

      // Mirror day exclusion: mark the counterpart day's videos as "used today"
      // so they are deprioritised (freshness score pushes them down)
      const mirrorIdx = dayIndex - 3 // Thu→Mon, Fri→Tue, Sat→Wed
      const mirrorVideos = mirrorIdx >= 0 ? (videosByDayIndex[mirrorIdx] ?? []) : []
      for (const id of mirrorVideos) {
        // Override to today's date regardless of previous value — strong freshness penalty
        lastScheduledWithWeek[id] = date
      }

      const dayDraft = generateWorkout({
        date,
        weekday,
        template,
        roundConfigs: configs,
        equipmentLimits,
        settings,
        videos: videoData.videos,
        lastScheduledById: lastScheduledWithWeek,
        lockedByRoomId: {},
        params,
      })

      dayDraft.rounds = dayDraft.rounds.map((rd) => {
        const room = roomById.get(rd.roomId)
        return { ...rd, roomNumber: room?.number ?? 0, roomName: room?.name ?? rd.roomName }
      })
      dayDraft.rounds.sort((a, b) => a.roomNumber - b.roomNumber)

      // Record this day's video IDs for mirror-day exclusion and week-wide rotation
      const dayVideoIds: number[] = []
      for (const rd of dayDraft.rounds) {
        for (const ex of rd.exercises) {
          weekUsedVideoIds.add(ex.videoId)
          dayVideoIds.push(ex.videoId)
        }
      }
      videosByDayIndex[dayIndex] = dayVideoIds

      days.push(dayDraft)
    }

    return NextResponse.json({ mode: "week", days })
  } catch (error) {
    console.error("[v0] Failed to generate workout:", error)
    return NextResponse.json({ message: "Failed to generate workout", detail: String(error) }, { status: 500 })
  }
}
