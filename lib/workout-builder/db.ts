import { sql, mapVideo } from "@/lib/db"
import type { Video } from "@/lib/shared/schema"
import type {
  BuilderSettings,
  EquipmentLimit,
  RoundConfig,
  WeeklyTemplate,
} from "./types"

// ---- mappers ---------------------------------------------------------------

export function mapWeeklyTemplate(row: any): WeeklyTemplate {
  return {
    weekday: row.weekday,
    label: row.label ?? null,
    primaryMuscles: row.primary_muscles ?? [],
    secondaryMuscles: row.secondary_muscles ?? [],
    workoutStyle: row.workout_style ?? null,
    goals: row.goals ?? {},
  }
}

export function mapRoundConfig(row: any): RoundConfig {
  return {
    roomId: row.room_id,
    stationName: row.station_name ?? null,
    stationRole: row.station_role ?? null,
    preferredEquipment: row.preferred_equipment ?? [],
    allowedEquipment: row.allowed_equipment ?? [],
    avoidEquipment: row.avoid_equipment ?? [],
    preferredCategories: row.preferred_categories ?? [],
    preferredHeartRate: row.preferred_heart_rate ?? null,
    preferredIntensity: row.preferred_intensity ?? null,
    availableSpace: row.available_space ?? null,
    coreOnly: row.core_only ?? false,
  }
}

export function mapEquipmentLimit(row: any): EquipmentLimit {
  return { equipment: row.equipment, maxStations: row.max_stations }
}

export function mapSettings(row: any): BuilderSettings {
  return {
    reuseWeeks: row.reuse_weeks ?? 6,
    minScore: row.min_score ?? 90,
    autoRegen: row.auto_regen ?? true,
    weeklyChallenge: row.weekly_challenge ?? {},
  }
}

// ---- getters ---------------------------------------------------------------

export async function getWeeklyTemplate(weekday: number): Promise<WeeklyTemplate | null> {
  const rows = await sql`SELECT * FROM wb_weekly_templates WHERE weekday = ${weekday}`
  return rows.length ? mapWeeklyTemplate(rows[0]) : null
}

export async function getAllWeeklyTemplates(): Promise<WeeklyTemplate[]> {
  const rows = await sql`SELECT * FROM wb_weekly_templates ORDER BY weekday`
  return rows.map(mapWeeklyTemplate)
}

export async function getRoundConfigs(): Promise<RoundConfig[]> {
  const rows = await sql`SELECT * FROM wb_round_config ORDER BY room_id`
  return rows.map(mapRoundConfig)
}

export async function getEquipmentLimits(): Promise<EquipmentLimit[]> {
  const rows = await sql`SELECT * FROM wb_equipment_limits ORDER BY equipment`
  return rows.map(mapEquipmentLimit)
}

export async function getSettings(): Promise<BuilderSettings> {
  const rows = await sql`SELECT * FROM wb_settings WHERE id = 1`
  return rows.length ? mapSettings(rows[0]) : { reuseWeeks: 6, minScore: 90, autoRegen: true, weeklyChallenge: {} }
}

// All videos with their most-recent scheduled date (for rotation freshness).
export async function getVideosWithLastScheduled(): Promise<{
  videos: Video[]
  lastScheduledById: Record<number, string | null>
}> {
  const rows = await sql`
    SELECT v.*, ls.last_used AS computed_last_used
    FROM videos v
    LEFT JOIN (
      SELECT video_id, MAX(schedule_date) AS last_used
      FROM schedules
      GROUP BY video_id
    ) ls ON ls.video_id = v.id
    ORDER BY v.title
  `
  const videos = rows.map(mapVideo)
  const lastScheduledById: Record<number, string | null> = {}
  for (const r of rows) {
    lastScheduledById[r.id] = r.computed_last_used
      ? typeof r.computed_last_used === "string"
        ? r.computed_last_used
        : new Date(r.computed_last_used).toISOString()
      : null
  }
  return { videos, lastScheduledById }
}
