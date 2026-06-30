export const dynamic = "force-dynamic"
import { type NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"

/**
 * POST /api/videos/fix-thumbnails
 * Nulls out legacy /uploads/thumbnails/* thumbnail_url values so the UI
 * no longer fires 404 requests for files that no longer exist on the server.
 * The ImageThumbnail component already falls back to a Film icon placeholder
 * when thumbnailUrl is null, so the table will look clean.
 */
export async function POST(_req: NextRequest) {
  try {
    const result = await sql`
      UPDATE videos
      SET thumbnail_url = NULL
      WHERE thumbnail_url LIKE '/uploads/%'
      RETURNING id
    `
    return NextResponse.json({ fixed: result.length })
  } catch (error) {
    console.error("[fix-thumbnails]", error)
    return NextResponse.json({ error: "Failed to fix thumbnails" }, { status: 500 })
  }
}
