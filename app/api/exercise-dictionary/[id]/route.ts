import { type NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** PATCH /api/exercise-dictionary/[id] — update any fields */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()
    const { alias, canonical, category, tags, notes } = body

    const rows = await sql`
      UPDATE exercise_dictionary SET
        alias      = COALESCE(${alias ?? null},      alias),
        canonical  = COALESCE(${canonical ?? null},  canonical),
        category   = COALESCE(${category ?? null},   category),
        tags       = COALESCE(${tags ?? null},        tags),
        notes      = COALESCE(${notes ?? null},       notes),
        updated_at = NOW()
      WHERE id = ${Number(id)}
      RETURNING *
    `

    if (!rows[0]) return NextResponse.json({ error: "Entry not found" }, { status: 404 })

    return NextResponse.json(rows[0])
  } catch (error: any) {
    console.error("[v0] exercise-dictionary PATCH error:", error?.message)
    return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 500 })
  }
}

/** DELETE /api/exercise-dictionary/[id] — remove an entry */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await sql`DELETE FROM exercise_dictionary WHERE id = ${Number(id)}`
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error("[v0] exercise-dictionary DELETE error:", error?.message)
    return NextResponse.json({ error: error?.message ?? "Delete failed" }, { status: 500 })
  }
}
