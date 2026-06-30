import { type NextRequest, NextResponse } from "next/server"
import { sql as sqlBase, mapVideo } from "@/lib/db"
import { generateExerciseMetadata } from "@/lib/ai/exercise-metadata"

// db.ts forwards a `.query(text, params)` helper for parameterized queries,
// but the Neon type doesn't expose it. Cast once here.
const sql = sqlBase as typeof sqlBase & {
  query: (text: string, params?: any[]) => Promise<any[]>
}

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// Each AI call takes a couple of seconds; allow a generous batch window.
export const maxDuration = 60

const CONFIDENCE_THRESHOLD = 70

// Map metadata keys -> DB columns so we can skip trainer-edited (manual) fields.
const FIELD_TO_COLUMN: Record<string, string> = {
  movementPattern: "movement_pattern",
  intensity: "intensity",
  exerciseType: "exercise_type",
  explosive: "explosive",
  weightRequired: "weight_required",
  spaceRequirement: "space_requirement",
  boxingType: "boxing_type",
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const mode: "fill" | "regenerate" = body.mode === "regenerate" ? "regenerate" : "fill"
    const ids: number[] | undefined = Array.isArray(body.ids)
      ? body.ids.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n))
      : undefined
    const batchSize: number = Math.min(Math.max(Number(body.batchSize) || 8, 1), 15)

    // Determine which videos to process this batch.
    let batch: any[]
    let remaining = 0

    if (mode === "regenerate" && ids && ids.length > 0) {
      // Regenerate overwrites everything (except manual fields) for the given ids.
      batch = await sql.query(
        `SELECT * FROM videos WHERE id = ANY($1::int[]) ORDER BY id ASC LIMIT $2`,
        [ids, batchSize],
      )
      const remainingRows = await sql.query(
        `SELECT COUNT(*)::int AS c FROM videos WHERE id = ANY($1::int[])`,
        [ids],
      )
      remaining = Math.max((remainingRows[0]?.c ?? 0) - batch.length, 0)
    } else {
      // Fill mode: only videos with no AI metadata yet or below the confidence threshold.
      batch = await sql.query(
        `SELECT * FROM videos
         WHERE ai_confidence IS NULL OR ai_confidence < $1
         ORDER BY id ASC LIMIT $2`,
        [CONFIDENCE_THRESHOLD, batchSize],
      )
      const remainingRows = await sql.query(
        `SELECT COUNT(*)::int AS c FROM videos WHERE ai_confidence IS NULL OR ai_confidence < $1`,
        [CONFIDENCE_THRESHOLD],
      )
      remaining = Math.max((remainingRows[0]?.c ?? 0) - batch.length, 0)
    }

    const processed: any[] = []
    const errors: { id: number; error: string }[] = []

    for (const row of batch) {
      try {
        const meta = await generateExerciseMetadata({
          id: row.id,
          title: row.title,
          bodyPart: row.body_part,
          equipment: row.equipment,
          secondaryMuscle: row.secondary_muscle,
        })

        // Respect manually edited fields — never overwrite them.
        const manualFields: string[] = Array.isArray(row.manual_fields)
          ? row.manual_fields
          : row.manual_fields
            ? JSON.parse(row.manual_fields)
            : []

        const updates: Record<string, any> = {
          movementPattern: meta.movementPattern,
          intensity: meta.intensity,
          exerciseType: meta.exerciseType,
          explosive: meta.explosive,
          weightRequired: meta.weightRequired,
          spaceRequirement: meta.spaceRequirement,
          boxingType: meta.boxingType,
        }

        const sets: string[] = []
        const values: any[] = []
        let i = 1
        for (const [key, col] of Object.entries(FIELD_TO_COLUMN)) {
          if (manualFields.includes(key)) continue
          sets.push(`${col} = $${i++}`)
          values.push(updates[key])
        }
        // Always record confidence + timestamp.
        sets.push(`ai_confidence = $${i++}`)
        values.push(Math.round(meta.confidence))
        sets.push(`ai_generated_at = NOW()`)

        values.push(row.id)
        const text = `UPDATE videos SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`
        const updated = await sql.query(text, values)
        if (updated[0]) processed.push(mapVideo(updated[0]))
      } catch (err: any) {
        console.error(`[v0] AI metadata failed for video ${row.id}:`, err?.message)
        errors.push({ id: row.id, error: err?.message ?? "unknown error" })
      }
    }

    return NextResponse.json({
      processedCount: processed.length,
      processed,
      errors,
      remaining,
      done: remaining === 0,
    })
  } catch (error: any) {
    console.error("[v0] /api/videos/ai-metadata error:", error?.message)
    return NextResponse.json({ error: "Failed to generate AI metadata" }, { status: 500 })
  }
}

// GET returns how many videos still need AI metadata (fill mode count).
export async function GET() {
  try {
    const rows = await sql`SELECT COUNT(*)::int AS c FROM videos WHERE ai_confidence IS NULL OR ai_confidence < ${CONFIDENCE_THRESHOLD}`
    return NextResponse.json({ needsReview: rows[0]?.c ?? 0 })
  } catch (error) {
    console.error("[v0] /api/videos/ai-metadata GET error:", error)
    return NextResponse.json({ needsReview: 0 })
  }
}
