import { neon } from "@neondatabase/serverless"
import type { Room, Video, Schedule, RoomAssignment } from "@/lib/shared/schema"

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  // Surfaced clearly during development if the integration env var is missing.
  console.error("[v0] DATABASE_URL is not set. Connect the Neon integration.")
}

// Tagged-template SQL client. Use as: await sql`SELECT * FROM rooms`
export const sql = neon(databaseUrl || "")

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
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    duration: row.duration ?? null,
    bodyPart: row.body_part ?? "",
    equipment: row.equipment ?? "",
    secondaryMuscle: row.secondary_muscle ?? null,
    thumbnailUrl: row.thumbnail_url ?? null,
    lastUsed: row.last_used ?? null,
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
  }
}

export function mapRoomAssignment(row: any): RoomAssignment {
  return {
    id: row.id,
    roomId: row.room_id,
    videoId: row.video_id,
  }
}
