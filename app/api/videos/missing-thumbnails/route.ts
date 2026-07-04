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
    // First, clear all invalid thumbnail URLs (old /uploads/ paths and non-http URLs)
    // This ensures they'll be regenerated properly
    await sql`
      UPDATE videos
      SET thumbnail_url = NULL
      WHERE thumbnail_url IS NOT NULL 
        AND thumbnail_url != ''
        AND (
          thumbnail_url LIKE '/uploads/%'
          OR thumbnail_url NOT LIKE 'http%'
        )
    `

    // Now get all videos that need thumbnails (NULL or empty)
    const rows = await sql`
      SELECT id FROM videos
      WHERE thumbnail_url IS NULL OR thumbnail_url = ''
      ORDER BY id ASC
    `
    console.log(`[missing-thumbnails] Found ${rows.length} videos without thumbnails (cleared invalid URLs)`);
    return NextResponse.json({ ids: rows.map((r: any) => r.id), count: rows.length })
  } catch (error) {
    console.error("[missing-thumbnails] error:", error)
    return NextResponse.json({ ids: [], count: 0 }, { status: 500 })
  }
}
