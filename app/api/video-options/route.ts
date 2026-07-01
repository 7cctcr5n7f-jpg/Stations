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
    const muscleGroups: string[] = []
    const workoutMethods: string[] = []

    for (const row of rows as { category: string; value: string }[]) {
      if (row.category === "bodyPart") bodyParts.push(row.value)
      else if (row.category === "secondaryMuscle") secondaryMuscles.push(row.value)
      else if (row.category === "equipment") equipment.push(row.value)
      else if (row.category === "muscleGroup") muscleGroups.push(row.value)
      else if (row.category === "workoutMethod") workoutMethods.push(row.value)
    }

    return NextResponse.json({ bodyParts, secondaryMuscles, equipment, muscleGroups, workoutMethods }, {
      headers: {
        // Edge-cache for 60 s; video options change only when a trainer adds/edits them.
        "Cache-Control": "s-maxage=60, stale-while-revalidate=300",
      },
    })
  } catch (error) {
    console.error("[v0] Failed to fetch video options:", error)
    return NextResponse.json({ message: "Failed to fetch video options" }, { status: 500 })
  }
}
