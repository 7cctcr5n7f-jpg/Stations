import { type NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import type { DictionaryEntry } from "@/lib/shared/schema"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function mapEntry(row: any): DictionaryEntry {
  return {
    id: row.id,
    alias: row.alias,
    canonical: row.canonical,
    category: row.category,
    tags: Array.isArray(row.tags) ? row.tags : [],
    notes: row.notes ?? null,
    createdAt: row.created_at
      ? (typeof row.created_at === "string" ? row.created_at : new Date(row.created_at).toISOString())
      : null,
    updatedAt: row.updated_at
      ? (typeof row.updated_at === "string" ? row.updated_at : new Date(row.updated_at).toISOString())
      : null,
  }
}

/** GET /api/exercise-dictionary — return all entries, ordered alphabetically by alias */
export async function GET() {
  try {
    const rows = await sql`
      SELECT * FROM exercise_dictionary ORDER BY lower(alias) ASC
    `
    return NextResponse.json(rows.map(mapEntry))
  } catch (error: any) {
    console.error("[v0] exercise-dictionary GET error:", error?.message)
    return NextResponse.json({ error: error?.message ?? "Failed to fetch dictionary" }, { status: 500 })
  }
}

/** POST /api/exercise-dictionary — create a new entry */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { alias, canonical, category, tags = [], notes = "" } = body

    if (!alias?.trim() || !canonical?.trim() || !category?.trim()) {
      return NextResponse.json({ error: "alias, canonical, and category are required" }, { status: 400 })
    }

    const rows = await sql`
      INSERT INTO exercise_dictionary (alias, canonical, category, tags, notes)
      VALUES (${alias.trim()}, ${canonical.trim()}, ${category.trim()}, ${tags}, ${notes ?? ""})
      ON CONFLICT (lower(alias))
      DO UPDATE SET
        canonical  = EXCLUDED.canonical,
        category   = EXCLUDED.category,
        tags       = EXCLUDED.tags,
        notes      = EXCLUDED.notes,
        updated_at = NOW()
      RETURNING *
    `

    return NextResponse.json(mapEntry(rows[0]), { status: 201 })
  } catch (error: any) {
    console.error("[v0] exercise-dictionary POST error:", error?.message)
    return NextResponse.json({ error: error?.message ?? "Failed to create entry" }, { status: 500 })
  }
}
