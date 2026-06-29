import { type NextRequest, NextResponse } from "next/server"
import { sql, mapRoom } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const rows = await sql`SELECT * FROM rooms WHERE id = ${Number(id)}`
    if (rows.length === 0) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 })
    }
    return NextResponse.json(mapRoom(rows[0]))
  } catch (error) {
    console.error("[v0] /api/rooms/[id] GET error:", error)
    return NextResponse.json({ error: "Failed to load room" }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()

    const columnMap: Record<string, string> = {
      number: "number",
      name: "name",
      description: "description",
      isActive: "is_active",
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
      const rows = await sql`SELECT * FROM rooms WHERE id = ${Number(id)}`
      return NextResponse.json(rows[0] ? mapRoom(rows[0]) : {})
    }

    values.push(Number(id))
    const text = `UPDATE rooms SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`
    const rows = await sql.query(text, values)
    return NextResponse.json(mapRoom(rows[0]))
  } catch (error) {
    console.error("[v0] /api/rooms/[id] PATCH error:", error)
    return NextResponse.json({ error: "Failed to update room" }, { status: 500 })
  }
}
