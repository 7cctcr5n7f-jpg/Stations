export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { type NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"

function mapDraft(row: any) {
  return {
    id: row.id,
    date: typeof row.draft_date === "string" ? row.draft_date : new Date(row.draft_date).toISOString().split("T")[0],
    label: row.label ?? null,
    rounds: row.rounds,
    score: row.score,
    createdAt: typeof row.created_at === "string" ? row.created_at : new Date(row.created_at).toISOString(),
  }
}

// GET ?date=yyyy-mm-dd (optional) — list saved drafts, newest first
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const date = searchParams.get("date")
    const rows = date
      ? await sql`SELECT * FROM wb_drafts WHERE draft_date = ${date} ORDER BY created_at DESC`
      : await sql`SELECT * FROM wb_drafts ORDER BY draft_date DESC, created_at DESC LIMIT 50`
    return NextResponse.json(rows.map(mapDraft))
  } catch (error) {
    console.error("[v0] Failed to list drafts:", error)
    return NextResponse.json({ message: "Failed to list drafts" }, { status: 500 })
  }
}

// POST { date, label, rounds, score } — save a draft for later comparison
export async function POST(request: NextRequest) {
  try {
    const { date, label, rounds, score } = await request.json()
    if (!date || !rounds) {
      return NextResponse.json({ message: "date and rounds are required" }, { status: 400 })
    }
    const rows = await sql`
      INSERT INTO wb_drafts (draft_date, label, rounds, score)
      VALUES (${date}, ${label ?? null}, ${JSON.stringify(rounds)}, ${score ?? 0})
      RETURNING *
    `
    return NextResponse.json(mapDraft(rows[0]), { status: 201 })
  } catch (error) {
    console.error("[v0] Failed to save draft:", error)
    return NextResponse.json({ message: "Failed to save draft" }, { status: 500 })
  }
}

// DELETE ?id= — remove a saved draft
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")
    if (!id) return NextResponse.json({ message: "id is required" }, { status: 400 })
    await sql`DELETE FROM wb_drafts WHERE id = ${Number(id)}`
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[v0] Failed to delete draft:", error)
    return NextResponse.json({ message: "Failed to delete draft" }, { status: 500 })
  }
}
