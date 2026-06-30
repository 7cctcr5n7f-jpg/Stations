export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { sql } from "@/lib/db"

export async function GET() {
  try {
    const rows = await sql`
      SELECT id, title, url
      FROM videos
      WHERE (thumbnail_url IS NULL OR thumbnail_url = '')
        AND url LIKE 'https://%'
      ORDER BY title
    `
    return NextResponse.json({ videos: rows })
  } catch (error) {
    console.error("[v0] missing-thumbnails error:", error)
    return NextResponse.json({ message: "Failed to fetch" }, { status: 500 })
  }
}
