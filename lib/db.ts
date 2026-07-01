import { neon, type NeonQueryFunction } from "@neondatabase/serverless"
import type { Room, Video, Schedule, RoomAssignment } from "@/lib/shared/schema"

// Lazily initialize the Neon client on first use. Initializing at module load
// breaks `next build` page-data collection, where DATABASE_URL is not present.
let _sql: NeonQueryFunction<false, false> | null = null

function getSql(): NeonQueryFunction<false, false> {
  if (!_sql) {
    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is not set. Connect the Neon integration.")
    }
    _sql = neon(databaseUrl)
  }
  return _sql
}

// Tagged-template SQL client. Use as: await sql`SELECT * FROM rooms`
// Also supports sql.query(text, params) via the underlying Neon client.
export const sql = ((...args: any[]) => (getSql() as any)(...args)) as NeonQueryFunction<false, false>

// Provide a `.query(text, params)` helper for parameterized, non-tagged queries.
// The Neon HTTP driver (v0.10.x) does not expose `.query()` on the function it
// returns — instead the function itself is called directly with (text, params).
// Forwarding through that call form keeps existing `sql.query(...)` callers working.
;(sql as any).query = (text: string, params?: any[]) => (getSql() as any)(text, params)

// ---- Row mappers (snake_case DB columns -> camelCase domain objects) ----

export function mapRoom(row: any): Room {
  return {
    id: row.id,
    number: row.number,
    name: row.name,
    description: row.description ?? null,
    isActive: row.is_active ?? true,
  }
}

export function mapVideo(row: any): Video {
  // Resolve category: prefer the new `category` column; fall back to `body_part`
  // for rows not yet migrated (should be none after migration).
  const category: string = row.category ?? row.body_part ?? ""

  // Resolve muscleGroups: prefer the new `muscle_groups` array column.
  // Fall back to splitting `secondary_muscle` CSV for any un-migrated rows.
  let muscleGroups: string[] = []
  if (Array.isArray(row.muscle_groups) && row.muscle_groups.length > 0) {
    muscleGroups = row.muscle_groups
  } else if (row.secondary_muscle) {
    muscleGroups = row.secondary_muscle.split(",").map((s: string) => s.trim()).filter(Boolean)
  }

  const workoutMethods: string[] = Array.isArray(row.workout_methods) ? row.workout_methods : []

  return {
    id: row.id,
    title: row.title,
    url: row.url,
    duration: row.duration ?? null,
    // New canonical fields
    category,
    muscleGroups,
    workoutMethods,
    // Deprecated aliases — kept for backward compat
    bodyPart: category,
    secondaryMuscle: muscleGroups.join(", ") || null,
    equipment: row.equipment ?? "",
    thumbnailUrl: row.thumbnail_url ?? null,
    lastUsed: row.computed_last_used
      ? (typeof row.computed_last_used === "string" ? row.computed_last_used : new Date(row.computed_last_used).toISOString())
      : row.last_used ?? null,
    nextScheduled: row.next_scheduled
      ? (typeof row.next_scheduled === "string" ? row.next_scheduled : new Date(row.next_scheduled).toISOString().split("T")[0])
      : null,
    timesUsed: row.times_used != null ? Number(row.times_used) : 0,
    movementPattern: row.movement_pattern ?? null,
    intensity: row.intensity ?? null,
    exerciseType: row.exercise_type ?? null,
    explosive: row.explosive ?? false,
    weightRequired: row.weight_required ?? false,
    spaceRequirement: row.space_requirement ?? null,
    boxingType: row.boxing_type ?? null,
    aiConfidence: row.ai_confidence != null ? Number(row.ai_confidence) : null,
    aiGeneratedAt: row.ai_generated_at
      ? (typeof row.ai_generated_at === "string" ? row.ai_generated_at : new Date(row.ai_generated_at).toISOString())
      : null,
    manualFields: Array.isArray(row.manual_fields)
      ? row.manual_fields
      : (row.manual_fields ? JSON.parse(row.manual_fields) : []),
  }
}

export function mapSchedule(row: any): Schedule {
  return {
    id: row.id,
    roomId: row.room_id,
    videoId: row.video_id,
    scheduleDate:
      typeof row.schedule_date === "string"
        ? row.schedule_date
        : new Date(row.schedule_date).toISOString().split("T")[0],
    reps: row.reps ?? null,
    position: row.position ?? 1,
    displayTitle: row.display_title ?? null,
    displayEquipment: row.display_equipment ?? null,
    zoomLevel: row.zoom_level ?? null,
    verticalPosition: row.vertical_position ?? null,
    sets: row.sets ?? 1,
    restTime: row.rest_time ?? 0,
    isActive: row.is_active ?? true,
    heartRateZone: row.heart_rate_zone ?? null,
  }
}

export function mapRoomAssignment(row: any): RoomAssignment {
  return {
    id: row.id,
    roomId: row.room_id,
    videoId: row.video_id,
  }
}
