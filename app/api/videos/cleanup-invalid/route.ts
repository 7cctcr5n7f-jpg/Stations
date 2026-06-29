import { NextResponse } from "next/server"
import { sql } from "@/lib/db"

export const runtime = "nodejs"

export async function POST() {
  try {
    // Invalid = empty url or not an http(s) URL
    const deleted = (await sql`
      DELETE FROM videos
      WHERE url IS NULL OR url = '' OR url !~* '^https?://'
      RETURNING id
    `) as { id: number }[]

    const deletedIds = deleted.map((d) => d.id)

    // Remove dependent schedules / assignments for deleted videos
    if (deletedIds.length > 0) {
      await sql`DELETE FROM schedules WHERE video_id = ANY(${deletedIds})`
      await sql`DELETE FROM room_assignments WHERE video_id = ANY(${deletedIds})`
    }

    return NextResponse.json({ deleted: deletedIds.length })
  } catch (error) {
    console.error("[v0] Failed to cleanup invalid videos:", error)
    return NextResponse.json({ message: "Failed to cleanup invalid videos" }, { status: 500 })
  }
}
