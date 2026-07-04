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
    // Step 1: Get count of all videos
    const totalCount = await sql`SELECT COUNT(*) as count FROM videos`
    console.log(`[missing-thumbnails] Total videos in DB: ${totalCount[0]?.count}`);

    // Step 1b: Get count of videos with thumbnail_url set
    const withThumbs = await sql`SELECT COUNT(*) as count FROM videos WHERE thumbnail_url IS NOT NULL AND thumbnail_url != ''`
    console.log(`[missing-thumbnails] Videos with thumbnail_url set: ${withThumbs[0]?.count}`);

    // Step 2: Get all videos with any kind of thumbnail_url set
    const allWithThumbs = await sql`
      SELECT id, thumbnail_url FROM videos
      WHERE thumbnail_url IS NOT NULL AND thumbnail_url != ''
    `
    console.log(`[missing-thumbnails] Fetched ${allWithThumbs.length} videos with thumbnail_url`);
    
    // Step 3: Filter to find which ones are invalid (don't start with http)
    const invalidIds = allWithThumbs
      .filter((v: any) => !v.thumbnail_url.startsWith('http://') && !v.thumbnail_url.startsWith('https://'))
      .map((v: any) => v.id);
    
    console.log(`[missing-thumbnails] Found ${invalidIds.length} videos with invalid thumbnail URLs (sample: ${invalidIds.slice(0, 5).join(', ')})`);
    
    // Step 4: Clear invalid thumbnail URLs
    if (invalidIds.length > 0) {
      await sql`
        UPDATE videos
        SET thumbnail_url = NULL
        WHERE id = ANY(${invalidIds})
      `
      console.log(`[missing-thumbnails] Cleared ${invalidIds.length} invalid thumbnail URLs`);
    }

    // Step 5: Get all videos that need thumbnails (NULL or empty)
    const rows = await sql`
      SELECT id FROM videos
      WHERE thumbnail_url IS NULL OR thumbnail_url = ''
      ORDER BY id ASC
    `
    console.log(`[missing-thumbnails] Found ${rows.length} videos needing thumbnails`);
    return NextResponse.json({ ids: rows.map((r: any) => r.id), count: rows.length })
  } catch (error) {
    console.error("[missing-thumbnails] error:", error)
    return NextResponse.json({ ids: [], count: 0 }, { status: 500 })
  }
}
