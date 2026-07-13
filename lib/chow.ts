import { sql } from "@/lib/db"

const CHOW_PREFIX = "CHOW"
const CHOW_KEY = "chowByWeek"
const CHOW_WEEK_DAYS = 7

type WeeklyChallengeSettings = Record<string, unknown> & {
  chowByWeek?: Record<string, number>
}

export interface ChowSyncResult {
  weekStart: string
  roomId: number
  syncedDates: string[]
  sourceScheduleId: number | null
  cleared: boolean
}

function toIsoDate(value: string | Date): string {
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
    return value.slice(0, 10)
  }

  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
}

export function getWeekStartIso(value: string | Date): string {
  const base = typeof value === "string" ? new Date(`${value}T12:00:00`) : new Date(value)
  const day = base.getDay()
  const daysFromMonday = day === 0 ? 6 : day - 1
  base.setDate(base.getDate() - daysFromMonday)
  return toIsoDate(base)
}

export function getWeekDates(weekStart: string, totalDays = CHOW_WEEK_DAYS): string[] {
  const base = new Date(`${weekStart}T12:00:00`)
  return Array.from({ length: totalDays }, (_, index) => {
    const date = new Date(base)
    date.setDate(base.getDate() + index)
    return toIsoDate(date)
  })
}

function normalizeWeeklyChallengeSettings(raw: unknown): WeeklyChallengeSettings {
  if (!raw) return {}
  if (typeof raw === "string") {
    try {
      return normalizeWeeklyChallengeSettings(JSON.parse(raw))
    } catch {
      return {}
    }
  }
  if (typeof raw !== "object" || Array.isArray(raw)) return {}
  return raw as WeeklyChallengeSettings
}

export async function getWeeklyChallengeSettings(): Promise<WeeklyChallengeSettings> {
  const rows = await sql`SELECT weekly_challenge FROM wb_settings WHERE id = 1`
  return normalizeWeeklyChallengeSettings(rows[0]?.weekly_challenge)
}

export function getChowRoomIdForWeek(settings: WeeklyChallengeSettings, weekStart: string): number | null {
  const chowByWeek = settings[CHOW_KEY]
  if (!chowByWeek || typeof chowByWeek !== "object" || Array.isArray(chowByWeek)) return null
  const raw = (chowByWeek as Record<string, unknown>)[weekStart]
  const roomId = typeof raw === "number" ? raw : Number(raw)
  return Number.isFinite(roomId) && roomId > 0 ? roomId : null
}

export async function setChowRoomIdForWeek(weekStart: string, roomId: number | null): Promise<WeeklyChallengeSettings> {
  const current = await getWeeklyChallengeSettings()
  const currentMap = current[CHOW_KEY]
  const chowByWeek =
    currentMap && typeof currentMap === "object" && !Array.isArray(currentMap)
      ? { ...(currentMap as Record<string, unknown>) }
      : {}

  if (roomId && Number.isFinite(roomId)) {
    chowByWeek[weekStart] = roomId
  } else {
    delete chowByWeek[weekStart]
  }

  const next: WeeklyChallengeSettings = { ...current, [CHOW_KEY]: chowByWeek as Record<string, number> }

  await sql`
    UPDATE wb_settings
    SET weekly_challenge = ${JSON.stringify(next)},
        updated_at = now()
    WHERE id = 1
  `

  return next
}

export function prependChowToReps(reps: string | null | undefined): string {
  const raw = reps ?? ""
  if (/^\s*CHOW\b/i.test(raw)) return raw
  const trimmed = raw.trim()
  return trimmed ? `${CHOW_PREFIX}\n${trimmed}` : CHOW_PREFIX
}

async function deleteExtraSchedules(scheduleIds: number[]) {
  if (scheduleIds.length === 0) return
  await sql`DELETE FROM schedules WHERE id = ANY(${scheduleIds})`
}

export async function syncChowWeek(weekStart: string, roomId: number): Promise<ChowSyncResult> {
  const weekDates = getWeekDates(weekStart)
  const syncedDates = new Set<string>()

  const sourceRows = await sql`
    SELECT *
    FROM schedules
    WHERE room_id = ${roomId} AND schedule_date = ${weekStart}
    ORDER BY position ASC, id ASC
  `

  if (sourceRows.length === 0) {
    const deletedRows = await sql`
      DELETE FROM schedules
      WHERE room_id = ${roomId} AND schedule_date = ANY(${weekDates})
      RETURNING schedule_date
    `
    for (const row of deletedRows) {
      syncedDates.add(toIsoDate(row.schedule_date))
    }
    return { weekStart, roomId, syncedDates: Array.from(syncedDates), sourceScheduleId: null, cleared: true }
  }

  const sourceRow = sourceRows[0]
  const sourceReps = prependChowToReps(sourceRow.reps != null ? String(sourceRow.reps) : null)

  await sql`
    UPDATE schedules
    SET video_id = ${sourceRow.video_id},
        reps = ${sourceReps},
        position = 1,
        display_title = ${sourceRow.display_title ?? null},
        display_equipment = ${sourceRow.display_equipment ?? null},
        zoom_level = ${sourceRow.zoom_level ?? "1"},
        vertical_position = ${sourceRow.vertical_position ?? "0"},
        sets = ${sourceRow.sets ?? 1},
        rest_time = ${sourceRow.rest_time ?? 0},
        is_active = ${sourceRow.is_active ?? true},
        heart_rate_zone = ${sourceRow.heart_rate_zone ?? null}
    WHERE id = ${sourceRow.id}
  `
  await deleteExtraSchedules(sourceRows.slice(1).map((row) => Number(row.id)))
  syncedDates.add(weekStart)

  const sourceTemplate = {
    videoId: Number(sourceRow.video_id),
    reps: sourceReps,
    displayTitle: sourceRow.display_title ?? null,
    displayEquipment: sourceRow.display_equipment ?? null,
    zoomLevel: sourceRow.zoom_level ?? "1",
    verticalPosition: sourceRow.vertical_position ?? "0",
    sets: sourceRow.sets ?? 1,
    restTime: sourceRow.rest_time ?? 0,
    isActive: sourceRow.is_active ?? true,
    heartRateZone: sourceRow.heart_rate_zone ?? null,
  }

  for (const date of weekDates.slice(1)) {
    const dayRows = await sql`
      SELECT *
      FROM schedules
      WHERE room_id = ${roomId} AND schedule_date = ${date}
      ORDER BY position ASC, id ASC
    `

    if (dayRows.length === 0) {
      await sql`
        INSERT INTO schedules
          (room_id, video_id, schedule_date, reps, position, display_title, display_equipment,
           zoom_level, vertical_position, sets, rest_time, is_active, heart_rate_zone)
        VALUES
          (${roomId}, ${sourceTemplate.videoId}, ${date}, ${sourceTemplate.reps}, ${1},
           ${sourceTemplate.displayTitle}, ${sourceTemplate.displayEquipment}, ${sourceTemplate.zoomLevel},
           ${sourceTemplate.verticalPosition}, ${sourceTemplate.sets}, ${sourceTemplate.restTime},
           ${sourceTemplate.isActive}, ${sourceTemplate.heartRateZone})
      `
    } else {
      await sql`
        UPDATE schedules
        SET video_id = ${sourceTemplate.videoId},
            reps = ${sourceTemplate.reps},
            position = 1,
            display_title = ${sourceTemplate.displayTitle},
            display_equipment = ${sourceTemplate.displayEquipment},
            zoom_level = ${sourceTemplate.zoomLevel},
            vertical_position = ${sourceTemplate.verticalPosition},
            sets = ${sourceTemplate.sets},
            rest_time = ${sourceTemplate.restTime},
            is_active = ${sourceTemplate.isActive},
            heart_rate_zone = ${sourceTemplate.heartRateZone}
        WHERE id = ${dayRows[0].id}
      `
      await deleteExtraSchedules(dayRows.slice(1).map((row) => Number(row.id)))
    }

    syncedDates.add(date)
  }

  return {
    weekStart,
    roomId,
    syncedDates: Array.from(syncedDates),
    sourceScheduleId: Number(sourceRow.id),
    cleared: false,
  }
}

export async function syncChowForScheduleChanges(
  changes: Array<{ scheduleDate?: string | null; roomId?: number | null }>,
): Promise<ChowSyncResult[]> {
  const validChanges = changes.filter(
    (change): change is { scheduleDate: string; roomId: number } =>
      !!change.scheduleDate && Number.isFinite(change.roomId) && Number(change.roomId) > 0,
  )

  if (validChanges.length === 0) return []

  const settings = await getWeeklyChallengeSettings()
  const chowWeeks = new Map<string, number>()

  for (const change of validChanges) {
    const weekStart = getWeekStartIso(change.scheduleDate)
    const chowRoomId = getChowRoomIdForWeek(settings, weekStart)
    if (chowRoomId && chowRoomId === change.roomId) {
      chowWeeks.set(`${weekStart}:${chowRoomId}`, chowRoomId)
    }
  }

  const results: ChowSyncResult[] = []
  for (const [key, roomId] of chowWeeks) {
    const [weekStart] = key.split(":")
    results.push(await syncChowWeek(weekStart, roomId))
  }
  return results
}
