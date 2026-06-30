export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { sql } from "@/lib/db"

export const runtime = "nodejs"

export async function GET() {
  try {
    const rows = await sql`SELECT category, value FROM video_options ORDER BY id ASC`

    const bodyParts: string[] = []
    const secondaryMuscles: string[] = []
    const equipment: string[] = []

    for (const row of rows as { category: string; value: string }[]) {
      if (row.category === "bodyPart") bodyParts.push(row.value)
      else if (row.category === "secondaryMuscle") secondaryMuscles.push(row.value)
      else if (row.category === "equipment") equipment.push(row.value)
    }

    return NextResponse.json({ bodyParts, secondaryMuscles, equipment })
  } catch (error) {
    console.error("[v0] Failed to fetch video options:", error)
    return NextResponse.json({ message: "Failed to fetch video options" }, { status: 500 })
  }
}