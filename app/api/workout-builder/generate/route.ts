export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 120

import { type NextRequest, NextResponse } from "next/server"
import { sql, mapRoom } from "@/lib/db"
import { generateWorkout } from "@/lib/workout-builder/engine"
import { validateWeek } from "@/lib/workout-builder/validator"
import {
  getAllWeeklyTemplates,
  getWeeklyTemplate,
  getRoundConfigs,
  getEquipmentLimits,
  getSettings,
  getVideosWithLastScheduled,
} from "@/lib/workout-builder/db"
import type { BuilderParams, GeneratedRound, MovementPatternCategory, WeeklyTemplate } from "@/lib/workout-builder/types"

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

// Collect all movement patterns from a workout day's rounds.
function collectDayPatterns(rounds: GeneratedRound[]): MovementPatternCategory[] {
  const patterns = new Set<MovementPatternCategory>()
  for (const round of rounds) {
    for (const p of round.movementPatterns) patterns.add(p)
  }
  return [...patterns]
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

    const configs = roundConfigs.length
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

    // ---- TRAINING WEEK or CUSTOM DAYS -------------------------------------------
    const allDates = weekDates(params.startDate)
    // Determine which day indices to generate (0=Mon, 1=Tue ... 5=Sat)
    const selectedIndices = (params.mode === "custom" && Array.isArray(params.selectedDays) && params.selectedDays.length > 0)
      ? params.selectedDays.filter((i) => i >= 0 && i <= 5).sort((a, b) => a - b)
      : [0, 1, 2, 3, 4, 5] // default: full week

    const allTemplates = await getAllWeeklyTemplates()
    const templateByWeekday = new Map(allTemplates.map((t) => [t.weekday, t]))

    // Load existing published schedules for this week (to consider in exercise history)
    const existingWeekSchedules = await sql`
      SELECT s.video_id, s.schedule_date
      FROM schedules s
      WHERE s.schedule_date >= ${params.startDate}
        AND s.schedule_date < ${allDates[5] ? allDates[5] + "T23:59:59" : params.startDate}
        AND s.video_id IS NOT NULL
    `
    // Build map of existing scheduled video IDs per day index
    const existingVideosByDayIdx: Map<number, Set<number>> = new Map()
    for (const row of existingWeekSchedules) {
      const dateStr = typeof row.schedule_date === "string" ? row.schedule_date.split("T")[0] : new Date(row.schedule_date).toISOString().split("T")[0]
      const idx = allDates.indexOf(dateStr)
      if (idx >= 0 && !selectedIndices.includes(idx)) {
        if (!existingVideosByDayIdx.has(idx)) existingVideosByDayIdx.set(idx, new Set())
        existingVideosByDayIdx.get(idx)!.add(row.video_id)
      }
    }

    const days = []
    const dayTemplates: (WeeklyTemplate | null)[] = []
    // Track used video IDs across the whole week for better rotation
    const weekUsedVideoIds = new Set<number>()
    // Pre-populate with existing (non-selected) days' videos
    for (const [, vids] of existingVideosByDayIdx) {
      for (const id of vids) weekUsedVideoIds.add(id)
    }

    // Mirror pairs: Mon(idx 0) ↔ Thu(idx 3), Tue(idx 1) ↔ Fri(idx 4), Wed(idx 2) ↔ Sat(idx 5)
    // We store video IDs and movement patterns used on each day so the mirror day can differentiate.
    const videosByDayIndex: (number[] | undefined)[] = new Array(6).fill(undefined)
    const patternsByDayIndex: (MovementPatternCategory[] | undefined)[] = new Array(6).fill(undefined)

    // Pre-fill existing days for mirror pair awareness
    for (const [idx, vids] of existingVideosByDayIdx) {
      videosByDayIndex[idx] = [...vids]
    }

    for (const dayIndex of selectedIndices) {
      const date = allDates[dayIndex]
      const weekday = new Date(date + "T12:00:00").getDay()
      const template = templateByWeekday.get(weekday) ?? null
      dayTemplates.push(template)

      // Build a modified lastScheduledById that penalises videos used earlier this week.
      const lastScheduledWithWeek = { ...videoData.lastScheduledById }
      for (const id of weekUsedVideoIds) {
        if (!lastScheduledWithWeek[id]) {
          lastScheduledWithWeek[id] = date
        }
      }

      // Mirror day exclusion: mark the counterpart day's videos as "used today"
      const mirrorIdx = dayIndex >= 3 ? dayIndex - 3 : dayIndex + 3
      const mirrorVideos = videosByDayIndex[mirrorIdx] ?? []
      for (const id of mirrorVideos) {
        lastScheduledWithWeek[id] = date
      }

      // Pass mirror day movement patterns for variation enforcement
      const mirrorDayMovementPatterns = videosByDayIndex[mirrorIdx] ? (patternsByDayIndex[mirrorIdx] ?? undefined) : undefined

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
        mirrorDayMovementPatterns,
      })

      dayDraft.rounds = dayDraft.rounds.map((rd) => {
        const room = roomById.get(rd.roomId)
        return { ...rd, roomNumber: room?.number ?? 0, roomName: room?.name ?? rd.roomName }
      })
      dayDraft.rounds.sort((a, b) => a.roomNumber - b.roomNumber)

      // Record this day's video IDs and patterns for mirror-day exclusion
      const dayVideoIds: number[] = []
      for (const rd of dayDraft.rounds) {
        for (const ex of rd.exercises) {
          weekUsedVideoIds.add(ex.videoId)
          dayVideoIds.push(ex.videoId)
        }
      }
      videosByDayIndex[dayIndex] = dayVideoIds
      patternsByDayIndex[dayIndex] = collectDayPatterns(dayDraft.rounds)

      days.push(dayDraft)
    }

    // Produce weekly validation report
    const validation = validateWeek(days, dayTemplates)

    return NextResponse.json({ mode: params.mode === "custom" ? "custom" : "week", days, validation, selectedIndices })
  } catch (error) {
    console.error("[v0] Failed to generate workout:", error)
    return NextResponse.json({ message: "Failed to generate workout", detail: String(error) }, { status: 500 })
  }
}
