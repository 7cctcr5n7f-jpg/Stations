import { type NextRequest, NextResponse } from "next/server"
import { sql, mapVideo } from "@/lib/db"

export const dynamic = "force-dynamic"

const columnMap: Record<string, string> = {
  title: "title",
  url: "url",
  duration: "duration",
  bodyPart: "body_part",
  equipment: "equipment",
  secondaryMuscle: "secondary_muscle",
  thumbnailUrl: "thumbnail_url",
  lastUsed: "last_used",
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    let body = await req.json()

    // Support inline-edit payloads of the shape { field, value }
    if (body && typeof body === "object" && "field" in body && "value" in body) {
      body = { [body.field]: body.value }
    }

    const sets: string[] = []
    const values: any[] = []
    let i = 1
    for (const [key, value] of Object.entries(body)) {
      const col = columnMap[key]
      if (!col) continue
      sets.push(`${col} = $${i++}`)
      values.push(value)
    }

    if (sets.length === 0) {
      const rows = await sql`SELECT * FROM videos WHERE id = ${Number(id)}`
      return NextResponse.json(rows[0] ? mapVideo(rows[0]) : {})
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
    // Remove dependent rows first to avoid orphaned schedules/assignments.
    await sql`DELETE FROM schedules WHERE video_id = ${videoId}`
    await sql`DELETE FROM room_assignments WHERE video_id = ${videoId}`
    const rows = await sql`DELETE FROM videos WHERE id = ${videoId} RETURNING id`
    if (rows.length === 0) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] /api/videos/[id] DELETE error:", error)
    return NextResponse.json({ error: "Failed to delete video" }, { status: 500 })
  }
}
