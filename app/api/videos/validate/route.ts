import { NextResponse } from "next/server"
import { sql } from "@/lib/db"

export const runtime = "nodejs"

function classify(url: string): "valid" | "invalid_path" {
  if (!url || !url.trim() || !/^https?:\/\//i.test(url)) return "invalid_path"
  return "valid"
}

export async function GET() {
  try {
    const videos = (await sql`SELECT id, title, url FROM videos ORDER BY id ASC`) as {
      id: number
      title: string
      url: string
    }[]

    const results = videos.map((v) => ({
      id: v.id,
      title: v.title,
      url: v.url,
      status: classify(v.url),
      fileSize: 0,
    }))

    return NextResponse.json(results)
  } catch (error) {
    console.error("[v0] Failed to validate videos:", error)
    return NextResponse.json({ message: "Failed to validate videos" }, { status: 500 })
  }
}
