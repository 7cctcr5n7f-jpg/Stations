import { type NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"

export const runtime = "nodejs"

// Derive a comparable title from a filename (strip extension, normalize)
function filenameToTitle(filename: string): string {
  return filename
    .replace(/\.[^/.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase()
}

export async function POST(request: NextRequest) {
  try {
    const { filenames } = (await request.json()) as { filenames: string[] }

    if (!Array.isArray(filenames)) {
      return NextResponse.json({ message: "filenames array is required" }, { status: 400 })
    }

    const existing = (await sql`SELECT title FROM videos`) as { title: string }[]
    const existingTitles = new Set(existing.map((v) => v.title.trim().toLowerCase()))

    const results = filenames.map((filename) => {
      const normalized = filenameToTitle(filename)
      const isDuplicate = existingTitles.has(normalized)
      return {
        filename,
        isDuplicate,
        reason: isDuplicate ? "A video with this title already exists" : "",
      }
    })

    const duplicates = results.filter((r) => r.isDuplicate).length
    return NextResponse.json({
      results,
      summary: {
        total: results.length,
        duplicates,
        new: results.length - duplicates,
      },
    })
  } catch (error) {
    console.error("[v0] Failed to check duplicates:", error)
    return NextResponse.json({ message: "Failed to check duplicates" }, { status: 500 })
  }
}
