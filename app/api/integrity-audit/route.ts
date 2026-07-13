import { NextResponse } from "next/server"
import { sql } from "@/lib/db"

export const runtime = "nodejs"
export const maxDuration = 120

type AssetIssue = {
  id: number
  title: string
  url: string
  status?: number
  error?: string
}

async function verifyAsset(url: string, kind: "video" | "thumbnail"): Promise<{ ok: true } | { ok: false; status?: number; error?: string }> {
  try {
    const res = await fetch(url, {
      headers: kind === "video" ? { Range: "bytes=0-0" } : undefined,
    })
    if (res.ok || res.status === 206) return { ok: true }
    return { ok: false, status: res.status }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}

export async function GET() {
  try {
    const [orphanedSchedules, danglingAssignments, invalidVideoUrls, invalidThumbnailUrls, duplicateTitles, missingThumbnails, videos] =
      await Promise.all([
        sql`
          SELECT s.id, s.room_id, s.video_id, s.schedule_date, s.position
          FROM schedules s
          LEFT JOIN videos v ON v.id = s.video_id
          LEFT JOIN rooms r ON r.id = s.room_id
          WHERE v.id IS NULL OR r.id IS NULL
          ORDER BY s.schedule_date, s.room_id, s.id
        `,
        sql`
          SELECT ra.id, ra.room_id, ra.video_id
          FROM room_assignments ra
          LEFT JOIN videos v ON v.id = ra.video_id
          LEFT JOIN rooms r ON r.id = ra.room_id
          WHERE v.id IS NULL OR r.id IS NULL
          ORDER BY ra.id
        `,
        sql`
          SELECT id, title, url
          FROM videos
          WHERE url NOT ILIKE 'http%'
          ORDER BY id
        `,
        sql`
          SELECT id, title, thumbnail_url
          FROM videos
          WHERE thumbnail_url IS NOT NULL AND thumbnail_url NOT ILIKE 'http%'
          ORDER BY id
        `,
        sql`
          SELECT lower(title) AS key, array_agg(id ORDER BY id) AS ids, array_agg(title ORDER BY id) AS titles
          FROM videos
          GROUP BY lower(title)
          HAVING COUNT(*) > 1
          ORDER BY lower(title)
        `,
        sql`
          SELECT id, title, url
          FROM videos
          WHERE thumbnail_url IS NULL
          ORDER BY id
        `,
        sql`
          SELECT id, title, url, thumbnail_url
          FROM videos
          ORDER BY id
        `,
      ])

    const missingVideoObjects: AssetIssue[] = []
    const missingThumbnailObjects: AssetIssue[] = []
    const rows = videos as Array<{ id: number; title: string; url: string; thumbnail_url: string | null }>
    const concurrency = 6
    let index = 0

    async function worker() {
      while (index < rows.length) {
        const video = rows[index++]
        const videoCheck = await verifyAsset(video.url, "video")
        if (!videoCheck.ok) {
          missingVideoObjects.push({
            id: video.id,
            title: video.title,
            url: video.url,
            status: videoCheck.status,
            error: videoCheck.error,
          })
        }

        if (video.thumbnail_url) {
          const thumbnailCheck = await verifyAsset(video.thumbnail_url, "thumbnail")
          if (!thumbnailCheck.ok) {
            missingThumbnailObjects.push({
              id: video.id,
              title: video.title,
              url: video.thumbnail_url,
              status: thumbnailCheck.status,
              error: thumbnailCheck.error,
            })
          }
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()))

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      orphanedSchedules,
      danglingRoomAssignments: danglingAssignments,
      invalidVideoUrls,
      invalidThumbnailUrls,
      missingThumbnails,
      missingR2VideoObjects: missingVideoObjects,
      missingR2ThumbnailObjects: missingThumbnailObjects,
      duplicateExerciseTitles: duplicateTitles,
      summary: {
        orphanedSchedules: orphanedSchedules.length,
        danglingRoomAssignments: danglingAssignments.length,
        invalidVideoUrls: invalidVideoUrls.length,
        invalidThumbnailUrls: invalidThumbnailUrls.length,
        missingThumbnails: missingThumbnails.length,
        missingR2VideoObjects: missingVideoObjects.length,
        missingR2ThumbnailObjects: missingThumbnailObjects.length,
        duplicateExerciseTitles: duplicateTitles.length,
      },
    })
  } catch (error) {
    console.error("[integrity-audit] Failed to run integrity audit:", error)
    return NextResponse.json({ error: "Failed to run integrity audit" }, { status: 500 })
  }
}
