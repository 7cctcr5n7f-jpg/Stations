import { type NextRequest, NextResponse } from "next/server"
import { sql, mapVideo } from "@/lib/db"
import { deleteFromR2ByPublicUrl } from "@/lib/r2"

export const dynamic = "force-dynamic"

const columnMap: Record<string, string> = {
  title: "title",
  url: "url",
  duration: "duration",
  // New canonical fields
  category: "category",
  muscleGroups: "muscle_groups",
  workoutMethods: "workout_methods",
  // Deprecated aliases — still accepted for backward compat, write both columns
  bodyPart: "body_part",
  secondaryMuscle: "secondary_muscle",
  equipment: "equipment",
  thumbnailUrl: "thumbnail_url",
  lastUsed: "last_used",
  movementPattern: "movement_pattern",
  intensity: "intensity",
  exerciseType: "exercise_type",
  explosive: "explosive",
  weightRequired: "weight_required",
  spaceRequirement: "space_requirement",
  boxingType: "boxing_type",
}

// Metadata fields that, when edited by a trainer, should be recorded in
// manual_fields so the AI generator never overwrites them.
const AI_MANAGED_FIELDS = new Set([
  "movementPattern",
  "intensity",
  "exerciseType",
  "explosive",
  "weightRequired",
  "spaceRequirement",
  "boxingType",
  "category",
  "muscleGroups",
  "workoutMethods",
])

// Fields whose DB column type is an array — values must be cast to text[].
const ARRAY_FIELDS = new Set(["muscleGroups", "workoutMethods"])

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    let body = await req.json()

    // Support inline-edit payloads of the shape { field, value }
    if (body && typeof body === "object" && "field" in body && "value" in body) {
      body = { [body.field]: body.value }
    }

    // Allow callers (the AI generator) to bypass manual-field tracking.
    const skipManualTracking = body && body.__aiGenerated === true
    if (body && typeof body === "object") delete body.__aiGenerated

    const sets: string[] = []
    const values: any[] = []
    const editedManualFields: string[] = []
    let i = 1
    for (const [key, value] of Object.entries(body)) {
      const col = columnMap[key]
      if (!col) continue
      if (ARRAY_FIELDS.has(key)) {
        // Ensure array values are stored as text[]
        const arr = Array.isArray(value) ? value : String(value).split(",").map((s: string) => s.trim()).filter(Boolean)
        sets.push(`${col} = $${i++}::text[]`)
        values.push(arr)
      } else {
        sets.push(`${col} = $${i++}`)
        values.push(value)
      }
      // When saving `category`, also keep legacy `body_part` in sync.
      if (key === "category") {
        sets.push(`body_part = $${i++}`)
        values.push(value)
      }
      if (!skipManualTracking && AI_MANAGED_FIELDS.has(key)) {
        editedManualFields.push(key)
      }
    }

    if (sets.length === 0) {
      const rows = await sql`SELECT * FROM videos WHERE id = ${Number(id)}`
      return NextResponse.json(rows[0] ? mapVideo(rows[0]) : {})
    }

    // Merge newly edited metadata fields into manual_fields so AI won't overwrite them.
    if (editedManualFields.length > 0) {
      const jsonArray = JSON.stringify(editedManualFields)
      sets.push(
        `manual_fields = (SELECT to_jsonb(array(SELECT DISTINCT jsonb_array_elements_text(COALESCE(manual_fields, '[]'::jsonb) || $${i++}::jsonb))))`,
      )
      values.push(jsonArray)
    }

    values.push(Number(id))
    const text = `UPDATE videos SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`
    const rows = await sql.query(text, values)
    if (rows.length === 0) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 })
    }
    return NextResponse.json(mapVideo(rows[0]))
  } catch (error) {
    console.error("[v0] /api/videos/[id] PATCH error:", error)
    return NextResponse.json({ error: "Failed to update video" }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const videoId = Number(id)
    const existingRows = await sql`SELECT url, thumbnail_url FROM videos WHERE id = ${videoId}`
    if (existingRows.length === 0) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 })
    }

    // Remove dependent rows first to avoid orphaned schedules/assignments.
    await sql`DELETE FROM schedules WHERE video_id = ${videoId}`
    await sql`DELETE FROM room_assignments WHERE video_id = ${videoId}`
    const rows = await sql`DELETE FROM videos WHERE id = ${videoId} RETURNING id`

    const oldUrl = existingRows[0].url as string | null
    const oldThumbnailUrl = existingRows[0].thumbnail_url as string | null
    const [videoRefRow] = oldUrl
      ? await sql`SELECT COUNT(*)::int AS count FROM videos WHERE url = ${oldUrl}`
      : [{ count: 1 }]
    const [thumbnailRefRow] = oldThumbnailUrl
      ? await sql`SELECT COUNT(*)::int AS count FROM videos WHERE thumbnail_url = ${oldThumbnailUrl}`
      : [{ count: 1 }]

    await Promise.all([
      oldUrl && videoRefRow.count === 0 ? deleteFromR2ByPublicUrl(oldUrl) : Promise.resolve(),
      oldThumbnailUrl && thumbnailRefRow.count === 0 ? deleteFromR2ByPublicUrl(oldThumbnailUrl) : Promise.resolve(),
    ])

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] /api/videos/[id] DELETE error:", error)
    return NextResponse.json({ error: "Failed to delete video" }, { status: 500 })
  }
}
