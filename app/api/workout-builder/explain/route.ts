export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

import { type NextRequest, NextResponse } from "next/server"
import { polishExplanations } from "@/lib/workout-builder/polish"
import type { WorkoutDraft } from "@/lib/workout-builder/types"

// POST { draft } -> returns the same draft with AI-polished explanation text.
// Always returns a valid draft even if the AI call fails (graceful fallback).
export async function POST(request: NextRequest) {
  try {
    const { draft } = (await request.json()) as { draft: WorkoutDraft }
    if (!draft) {
      return NextResponse.json({ message: "draft is required" }, { status: 400 })
    }
    const polished = await polishExplanations(draft)
    return NextResponse.json(polished)
  } catch (error) {
    console.error("[v0] Failed to polish explanations:", error)
    // Return the original draft unmodified rather than failing the request.
    try {
      const { draft } = await request.clone().json()
      return NextResponse.json(draft)
    } catch {
      return NextResponse.json({ message: "Failed to explain" }, { status: 500 })
    }
  }
}
