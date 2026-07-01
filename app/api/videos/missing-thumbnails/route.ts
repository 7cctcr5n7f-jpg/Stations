import { NextResponse } from "next/server"
import { sql } from "@/lib/db"

export const dynamic = "force-dynamic"

/**
 * GET /api/videos/missing-thumbnails
 *
 * Returns the IDs of every video that has no thumbnail_url set.
 * Used by the bulk thumbnail generator so it queries the full DB instead
 * of relying on the client-side SWR cache (which may be a subset).
 */
export async function GET() {
  try {
    const rows = await sql`
      SELECT id FROM videos
      WHERE thumbnail_url IS NULL OR thumbnail_url = ''
      ORDER BY id ASC
    `
    return NextResponse.json({ ids: rows.map((r: any) => r.id), count: rows.length })
  } catch (error) {
    console.error("[missing-thumbnails] error:", error)
    return NextResponse.json({ ids: [], count: 0 }, { status: 500 })
  }
}
