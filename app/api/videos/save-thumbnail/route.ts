export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { type NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { uploadToR2 } from "@/lib/r2"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { videoId, thumbnailDataUrl } = body

    if (!videoId || !thumbnailDataUrl) {
      return NextResponse.json({ message: "videoId and thumbnailDataUrl are required" }, { status: 400 })
    }

    // Decode base64 data URL → Buffer
    const matches = thumbnailDataUrl.match(/^data:image\/(\w+);base64,(.+)$/)
    if (!matches) {
      return NextResponse.json({ message: "Invalid thumbnail data URL format" }, { status: 400 })
    }
    const ext = matches[1] === "jpeg" ? "jpg" : matches[1]
    const buffer = Buffer.from(matches[2], "base64")

    // Upload to R2
    const key = `thumbnails/thumb-${videoId}-${Date.now()}.${ext}`
    const thumbnailUrl = await uploadToR2(key, buffer, `image/${matches[1]}`)

    // Save to DB
    await sql`UPDATE videos SET thumbnail_url = ${thumbnailUrl} WHERE id = ${videoId}`

    return NextResponse.json({ thumbnailUrl })
  } catch (error) {
    console.error("[v0] save-thumbnail error:", error)
    return NextResponse.json({ message: "Failed to save thumbnail" }, { status: 500 })
  }
}
