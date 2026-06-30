import { type NextRequest, NextResponse } from "next/server"
import { generateExerciseMetadata } from "@/lib/ai/exercise-metadata"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

// Suggest metadata for an exercise without persisting anything — used by the
// upload modal so trainers can review AI suggestions before saving.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const title = (body.title as string)?.trim()
    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 })
    }
    const meta = await generateExerciseMetadata({
      id: 0,
      title,
      bodyPart: body.bodyPart ?? null,
      equipment: body.equipment ?? null,
      secondaryMuscle: body.secondaryMuscle ?? null,
    })
    return NextResponse.json(meta)
  } catch (error: any) {
    console.error("[v0] /api/videos/ai-suggest error:", error?.message)
    return NextResponse.json({ error: "Failed to suggest metadata" }, { status: 500 })
  }
}
