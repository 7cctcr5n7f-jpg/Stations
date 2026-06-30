import { type NextRequest, NextResponse } from "next/server"
import { sql, mapVideo } from "@/lib/db"
import { generateExerciseMetadata, type DictionaryGlossaryEntry } from "@/lib/ai/exercise-metadata"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// Each AI call takes a couple of seconds; allow a generous batch window.
export const maxDuration = 60

// Metadata key -> DB column (used to preserve trainer-edited "manual" fields).
const FIELD_TO_COLUMN: Record<string, string> = {
  movementPattern: "movement_pattern",
  intensity: "intensity",
  exerciseType: "exercise_type",
  explosive: "explosive",
  weightRequired: "weight_required",
  spaceRequirement: "space_requirement",
  boxingType: "boxing_type",
}

/** Load the full exercise dictionary as a flat glossary for the AI prompt. */
async function loadGlossary(): Promise<DictionaryGlossaryEntry[]> {
  try {
    const rows = await sql`
      SELECT alias, canonical, category FROM exercise_dictionary ORDER BY lower(alias)
    `
    return rows.map((r: any) => ({ alias: r.alias, canonical: r.canonical, category: r.category }))
  } catch {
    // Table may not exist on first run — non-fatal, AI falls back to general knowledge
    return []
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const mode: "fill" | "regenerate" = body.mode === "regenerate" ? "regenerate" : "fill"
    const ids: number[] | undefined = Array.isArray(body.ids)
      ? body.ids.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n))
      : undefined
    const batchSize: number = Math.min(Math.max(Number(body.batchSize) || 8, 1), 15)

    // Load the exercise dictionary once for the whole batch
    const glossary = await loadGlossary()

    // Determine which videos to process this batch.
    let batch: any[]
    let totalMatching = 0

    if (mode === "regenerate" && ids && ids.length > 0) {
      batch = await sql`
        SELECT * FROM videos
        WHERE id = ANY(${ids}::int[])
        ORDER BY id ASC LIMIT ${batchSize}
      `
      const countRows = await sql`
        SELECT COUNT(*)::int AS c FROM videos WHERE id = ANY(${ids}::int[])
      `
      totalMatching = countRows[0]?.c ?? 0
    } else {
      batch = await sql`
        SELECT * FROM videos
        WHERE ai_generated_at IS NULL
        ORDER BY id ASC LIMIT ${batchSize}
      `
      const countRows = await sql`
        SELECT COUNT(*)::int AS c FROM videos WHERE ai_generated_at IS NULL
      `
      totalMatching = countRows[0]?.c ?? 0
    }

    const processed: any[] = []
    const errors: { id: number; error: string }[] = []
    // Accumulate unknown terms across the whole batch, keyed by term for dedup
    const unknownTermMap: Record<string, { term: string; videoIds: number[]; videoTitles: string[] }> = {}

    for (const row of batch) {
      try {
        const result = await generateExerciseMetadata(
          {
            id: row.id,
            title: row.title,
            bodyPart: row.body_part,
            equipment: row.equipment,
            secondaryMuscle: row.secondary_muscle,
          },
          glossary,
        )

        const { metadata: meta, unknownTerms } = result

        // Accumulate unknown terms for the batch response
        for (const term of unknownTerms) {
          if (!unknownTermMap[term]) {
            unknownTermMap[term] = { term, videoIds: [], videoTitles: [] }
          }
          if (!unknownTermMap[term].videoIds.includes(row.id)) {
            unknownTermMap[term].videoIds.push(row.id)
            unknownTermMap[term].videoTitles.push(row.title)
          }
        }

        // Respect manually edited fields — never overwrite them.
        const manualFields: string[] = Array.isArray(row.manual_fields)
          ? row.manual_fields
          : row.manual_fields
            ? JSON.parse(row.manual_fields)
            : []

        const aiValues: Record<string, any> = {
          movementPattern: meta.movementPattern,
          intensity: meta.intensity,
          exerciseType: meta.exerciseType,
          explosive: meta.explosive,
          weightRequired: meta.weightRequired,
          spaceRequirement: meta.spaceRequirement,
          boxingType: meta.boxingType,
        }

        const v = (key: string) =>
          manualFields.includes(key) ? row[FIELD_TO_COLUMN[key]] : aiValues[key]

        const updated = await sql`
          UPDATE videos SET
            movement_pattern = ${v("movementPattern")},
            intensity = ${v("intensity")},
            exercise_type = ${v("exerciseType")},
            explosive = ${v("explosive")},
            weight_required = ${v("weightRequired")},
            space_requirement = ${v("spaceRequirement")},
            boxing_type = ${v("boxingType")},
            ai_confidence = ${Math.round(meta.confidence)},
            ai_generated_at = NOW()
          WHERE id = ${row.id}
          RETURNING *
        `
        if (updated[0]) processed.push(mapVideo(updated[0]))
      } catch (err: any) {
        console.error(`[v0] AI metadata failed for video ${row.id}:`, err?.message)
        errors.push({ id: row.id, error: err?.message ?? "unknown error" })
      }
    }

    const remaining = Math.max(totalMatching - processed.length, 0)
    const unknownTerms = Object.values(unknownTermMap)

    return NextResponse.json({
      processedCount: processed.length,
      processed,
      errors,
      remaining,
      done: processed.length === 0 || remaining === 0,
      unknownTerms,       // [ { term, videoIds, videoTitles } ]
      glossarySize: glossary.length,
    })
  } catch (error: any) {
    console.error("[v0] /api/videos/ai-metadata error:", error?.message)
    return NextResponse.json({ error: "Failed to generate AI metadata" }, { status: 500 })
  }
}

export async function GET() {
  try {
    const rows = await sql`
      SELECT COUNT(*)::int AS c FROM videos WHERE ai_generated_at IS NULL
    `
    return NextResponse.json({ needsReview: rows[0]?.c ?? 0 })
  } catch (error) {
    console.error("[v0] /api/videos/ai-metadata GET error:", error)
    return NextResponse.json({ needsReview: 0 })
  }
}
