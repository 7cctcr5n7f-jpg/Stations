import { NextResponse } from "next/server"
import { sql } from "@/lib/db"

export const runtime = "nodejs"

type Status = "valid" | "missing_file" | "invalid_path" | "corrupt"

function classify(url: string): Status {
  if (!url || !url.trim()) return "invalid_path"
  if (!/^https?:\/\//i.test(url)) return "invalid_path"
  return "valid"
}

export async function GET() {
  try {
    const videos = (await sql`SELECT id, title, url FROM videos ORDER BY id ASC`) as {
      id: number
      title: string
      url: string
    }[]

    const details = videos.map((v) => ({
      id: v.id,
      title: v.title,
      url: v.url,
      status: classify(v.url),
      fileSize: 0,
    }))

    const valid = details.filter((d) => d.status === "valid").length
    const missing = details.filter((d) => d.status === "missing_file").length
    const corrupt = details.filter((d) => d.status === "corrupt").length
    const invalid = details.filter((d) => d.status === "invalid_path").length

    return NextResponse.json({
      total: details.length,
      valid,
      missing,
      corrupt,
      invalid,
      totalFileSize: 0,
      details,
    })
  } catch (error) {
    console.error("[v0] Failed to compute video health:", error)
    return NextResponse.json({ message: "Failed to compute video health" }, { status: 500 })
  }
}
