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
  primaryMuscles: "body_part",
  secondaryMuscles: "secondary_muscle",
}

/**
 * Boxing-related equipment tokens and exercise types that trigger the
 * "always High intensity" business rule.
 */
const BOXING_EQUIPMENT_TOKENS = ["BOXING", "GLOVES", "PADS", "BAG", "HEAVYBAG", "SPEEDBAG"]

function isBoxingExercise(row: any, boxingType: string | null): boolean {
  if (boxingType) return true
  const equipment: string = (row.equipment ?? "").toUpperCase()
  if (BOXING_EQUIPMENT_TOKENS.some((t) => equipment.includes(t))) return true
  const exerciseType: string = (row.exercise_type ?? "").toLowerCase()
  return exerciseType === "skill" && equipment.includes("BOXING")
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

        // Apply boxing → always High intensity business rule AFTER generation.
        const resolvedIntensity =
          isBoxingExercise(row, meta.boxingType) ? "High" : meta.intensity

        // Apply HIIT type + Cardio primary rule AFTER generation.
        // Boxing and cardio-dominant exercises are HIIT; their primary muscle
        // is always "Cardio" with actual muscles pushed to secondary.
        const isHiit =
          meta.exerciseType === "HIIT" ||
          meta.exerciseType === "Cardio" || // guard against model using old enum value
          isBoxingExercise(row, meta.boxingType)

        const resolvedExerciseType = isHiit ? "HIIT" : meta.exerciseType

        // For HIIT exercises, primaryMuscles = ["Cardio"], real muscles go to secondary.
        // Merge AI primary muscles into secondary when they're not already there.
        let resolvedPrimary = meta.primaryMuscles
        let resolvedSecondary = meta.secondaryMuscles

        if (isHiit) {
          // Move any non-"Cardio" primary muscles into secondary (deduped)
          const extraMuscles = meta.primaryMuscles.filter(
            (m) => m.toLowerCase() !== "cardio",
          )
          resolvedPrimary = ["Cardio"]
          resolvedSecondary = [
            ...new Set([...extraMuscles, ...meta.secondaryMuscles]),
          ].filter((m) => m.toLowerCase() !== "cardio")
        }

        // Normalise muscle arrays to comma-separated strings (matching existing column format)
        const primaryMusclesStr =
          resolvedPrimary.length > 0 ? resolvedPrimary.join(", ") : null
        const secondaryMusclesStr =
          resolvedSecondary.length > 0 ? resolvedSecondary.join(", ") : null

        const aiValues: Record<string, any> = {
          movementPattern: meta.movementPattern,
          intensity: resolvedIntensity,
          exerciseType: resolvedExerciseType,
          explosive: meta.explosive,
          weightRequired: meta.weightRequired,
          spaceRequirement: meta.spaceRequirement,
          boxingType: meta.boxingType,
          // Only write muscles if the trainer hasn't manually set them
          primaryMuscles: primaryMusclesStr,
          secondaryMuscles: secondaryMusclesStr,
        }

        const v = (key: string) =>
          manualFields.includes(key) ? row[FIELD_TO_COLUMN[key]] : aiValues[key]

        // Determine if body_part/secondary_muscle should be updated.
        // For HIIT exercises we always write "Cardio" as primary (unless the
        // trainer manually set it) — it's a deliberate structural rule, not just
        // a fill-in-the-blanks operation.
        const shouldUpdateBodyPart =
          !manualFields.includes("primaryMuscles") &&
          primaryMusclesStr !== null &&
          (isHiit || !row.body_part || row.body_part === "General" || row.body_part === "")

        // For HIIT exercises also always refresh secondary so the actual muscles
        // are populated correctly. Otherwise only update when it's a placeholder.
        const secondaryIsPlaceholder =
          !row.secondary_muscle ||
          row.secondary_muscle.trim() === "" ||
          row.secondary_muscle.trim().toLowerCase() === (row.body_part ?? "").trim().toLowerCase()

        const shouldUpdateSecondary =
          !manualFields.includes("secondaryMuscles") &&
          secondaryMusclesStr !== null &&
          (isHiit || secondaryIsPlaceholder)

        const updated = await sql`
          UPDATE videos SET
            movement_pattern = ${v("movementPattern")},
            intensity = ${v("intensity")},
            exercise_type = ${v("exerciseType")},
            explosive = ${v("explosive")},
            weight_required = ${v("weightRequired")},
            space_requirement = ${v("spaceRequirement")},
            boxing_type = ${v("boxingType")},
            body_part = CASE WHEN ${shouldUpdateBodyPart} THEN ${primaryMusclesStr} ELSE body_part END,
            secondary_muscle = CASE WHEN ${shouldUpdateSecondary} THEN ${secondaryMusclesStr} ELSE secondary_muscle END,
            ai_confidence = ${Math.round(meta.confidence)},
            ai_generated_at = NOW()
          WHERE id = ${row.id}
          RETURNING *
        `
        if (updated[0]) processed.push(mapVideo(updated[0]))
      } catch (err: any) {
        console.error(`[v0] AI metadata failed for video ${row.id}:`, err?.message)
        errors.push({ id: row.id, error: err?.message ?? "unknown error" })

        // If this was a rate-limit error, stamp ai_generated_at so the video
        // is not re-fetched in every subsequent batch, causing an infinite loop.
        // The video will still show ai_confidence = null so a trainer can spot it.
        const isRateLimit =
          err?.message?.includes("rate-limit") ||
          err?.message?.includes("429") ||
          err?.name === "GatewayRateLimitError"
        if (isRateLimit) {
          try {
            await sql`
              UPDATE videos
              SET ai_generated_at = NOW()
              WHERE id = ${row.id} AND ai_generated_at IS NULL
            `
          } catch {}
        }
      }
    }

    // Re-query the true remaining count AFTER all updates (including rate-limit
    // stamps) so the client gets an accurate picture and doesn't stop early.
    const remainingRows = await sql`
      SELECT COUNT(*)::int AS c FROM videos WHERE ai_generated_at IS NULL
    `
    const remaining = remainingRows[0]?.c ?? 0
    const unknownTerms = Object.values(unknownTermMap)

    return NextResponse.json({
      processedCount: processed.length,
      processed,
      errors,
      remaining,
      // Only signal done when there is genuinely nothing left — never stop
      // just because this batch had zero successes (e.g. all rate-limited).
      done: remaining === 0,
      unknownTerms,
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
