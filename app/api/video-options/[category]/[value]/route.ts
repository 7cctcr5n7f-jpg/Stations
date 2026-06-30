export const dynamic = "force-dynamic"

import { type NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"

export const runtime = "nodejs"

// Map the option category to the videos column it populates
const VIDEO_COLUMN: Record<string, string> = {
  bodyPart: "body_part",
  secondaryMuscle: "secondary_muscle",
  equipment: "equipment",
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ category: string; value: string }> },
) {
  try {
    const { category, value: rawValue } = await params
    const value = decodeURIComponent(rawValue)

    if (!VIDEO_COLUMN[category]) {
      return NextResponse.json({ message: "Invalid category" }, { status: 400 })
    }

    // Remove the option
    await sql`
      DELETE FROM video_options
      WHERE category = ${category} AND value = ${value}
    `

    // Clear the value from any videos that referenced it
    const column = VIDEO_COLUMN[category]
    const fallback = category === "secondaryMuscle" ? null : ""
    const updated = (await sql.query(
      `UPDATE videos SET ${column} = $1 WHERE ${column} = $2 RETURNING id`,
      [fallback, value],
    )) as { id: number }[]

    return NextResponse.json({ success: true, videosUpdated: updated.length })
  } catch (error) {
    console.error("[v0] Failed to delete video option:", error)
    return NextResponse.json({ message: "Failed to delete video option" }, { status: 500 })
  }
}