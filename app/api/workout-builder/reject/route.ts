export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { type NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"

// GET — return all rejection feedback entries, newest first
export async function GET() {
  try {
    const rows = await sql`
      SELECT * FROM wb_rejection_feedback ORDER BY created_at DESC LIMIT 200
    `
    return NextResponse.json(rows)
  } catch (error) {
    console.error("[v0] Failed to load rejection feedback:", error)
    return NextResponse.json({ message: "Failed to load feedback" }, { status: 500 })
  }
}

// POST — save a rejection and optionally apply equipment to avoidEquipment
// Body: { roomId, roomNumber, roomName, reason, equipment: string[], videoIds: number[], videoTitles: string[], applyToConfig: boolean }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      roomId,
      roomNumber,
      roomName,
      reason,
      equipment = [],
      videoIds = [],
      videoTitles = [],
      applyToConfig = false,
    } = body

    if (!reason?.trim()) {
      return NextResponse.json({ message: "reason is required" }, { status: 400 })
    }

    // Insert feedback record
    const [row] = await sql`
      INSERT INTO wb_rejection_feedback
        (room_id, room_number, room_name, reason, equipment, video_ids, video_titles, applied)
      VALUES
        (${roomId ?? null}, ${roomNumber ?? null}, ${roomName ?? null},
         ${reason.trim()}, ${equipment}::text[], ${videoIds}::integer[], ${videoTitles}::text[],
         ${applyToConfig})
      RETURNING *
    `

    // If trainer wants to apply equipment avoidance to the round config, merge into avoid_equipment
    if (applyToConfig && equipment.length > 0 && roomId) {
      await sql`
        INSERT INTO wb_round_config (room_id, avoid_equipment, updated_at)
        VALUES (${roomId}, ${equipment}::text[], now())
        ON CONFLICT (room_id) DO UPDATE SET
          avoid_equipment = (
            SELECT array_agg(DISTINCT e)
            FROM unnest(wb_round_config.avoid_equipment || ${equipment}::text[]) AS e
            WHERE e <> ''
          ),
          updated_at = now()
      `
    }

    return NextResponse.json({ ok: true, feedback: row })
  } catch (error) {
    console.error("[v0] Failed to save rejection feedback:", error)
    return NextResponse.json({ message: "Failed to save feedback" }, { status: 500 })
  }
}

// DELETE — remove a feedback entry (and optionally remove its equipment from avoidEquipment)
export async function DELETE(request: NextRequest) {
  try {
    const { id, revertConfig } = await request.json()
    if (!id) return NextResponse.json({ message: "id is required" }, { status: 400 })

    const [row] = await sql`SELECT * FROM wb_rejection_feedback WHERE id = ${id}`
    if (!row) return NextResponse.json({ message: "Not found" }, { status: 404 })

    await sql`DELETE FROM wb_rejection_feedback WHERE id = ${id}`

    // Optionally remove the equipment from the round's avoidEquipment
    if (revertConfig && row.applied && row.room_id && row.equipment?.length > 0) {
      await sql`
        UPDATE wb_round_config
        SET avoid_equipment = (
          SELECT array_agg(e)
          FROM unnest(avoid_equipment) AS e
          WHERE e <> ALL(${row.equipment}::text[])
        ),
        updated_at = now()
        WHERE room_id = ${row.room_id}
      `
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[v0] Failed to delete feedback:", error)
    return NextResponse.json({ message: "Failed to delete" }, { status: 500 })
  }
}
