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
  category: "category",
  muscleGroups: "muscle_groups",
  workoutMethods: "workout_methods",
  // Legacy aliases (kept for backward compat)
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
    return []
  }
}

/**
 * A video needs (re)filling if ANY of these key fields is missing.
 * Written as a literal helper to avoid sql-fragment composition issues —
 * we inline the exact same SQL text in every query that needs it.
 *
 * NOTE: We intentionally do NOT include ai_generated_at IS NULL here.
 * A video with ai_generated_at set but missing movement_pattern, intensity,
 * or muscle_groups still needs processing.  The old code stamped
 * ai_generated_at on rate-limit errors without filling the fields, which
 * caused those videos to fall out of the "needs fill" set prematurely.
 */
function needsFillRows(limit: number) {
  return sql`
    SELECT * FROM videos
    WHERE (
      movement_pattern IS NULL OR movement_pattern = ''
      OR intensity IS NULL OR intensity = ''
      OR (muscle_groups IS NULL OR array_length(muscle_groups, 1) IS NULL OR array_length(muscle_groups, 1) = 0)
    )
    ORDER BY
      (CASE WHEN ai_generated_at IS NULL THEN 0 ELSE 1 END) ASC,
      id ASC
    LIMIT ${limit}
  `
}

function countNeedsFill() {
  return sql`
    SELECT COUNT(*)::int AS c FROM videos
    WHERE (
      movement_pattern IS NULL OR movement_pattern = ''
      OR intensity IS NULL OR intensity = ''
      OR (muscle_groups IS NULL OR array_length(muscle_groups, 1) IS NULL OR array_length(muscle_groups, 1) = 0)
    )
  `
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const mode: "fill" | "regenerate" = body.mode === "regenerate" ? "regenerate" : "fill"
    const ids: number[] | undefined = Array.isArray(body.ids)
      ? body.ids.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n))
      : undefined
    // Always process ONE video per request to avoid hitting Vercel AI Gateway
    // rate limits. Concurrent AI calls (even within the same request) share
    // the same per-minute token quota — firing 5 at once exhausts it instantly.
    // The client loops calling this endpoint, creating natural pacing.
    const batchSize = 1

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
      // Fill mode: inline conditions to avoid sql-fragment composition issues.
      batch = await needsFillRows(batchSize)
      const countRows = await countNeedsFill()
      totalMatching = countRows[0]?.c ?? 0
    }

    const processed: any[] = []
    const errors: { id: number; error: string }[] = []
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
            category: row.category ?? undefined,
            muscleGroups: Array.isArray(row.muscle_groups) && row.muscle_groups.length > 0
              ? row.muscle_groups
              : undefined,
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

        // Apply HIIT type + category rule AFTER generation.
        const isHiit =
          meta.exerciseType === "HIIT" ||
          meta.category === "HIIT" ||
          isBoxingExercise(row, meta.boxingType)

        const resolvedExerciseType = isHiit ? "HIIT" : meta.exerciseType
        const resolvedCategory = isHiit ? "HIIT" : (meta.category ?? meta.exerciseType)

        const resolvedMuscleGroups: string[] =
          Array.isArray(meta.muscleGroups) && meta.muscleGroups.length > 0
            ? meta.muscleGroups
            : []

        const resolvedWorkoutMethods: string[] = Array.isArray(meta.workoutMethods)
          ? (meta.workoutMethods.includes("Standard") ? meta.workoutMethods : ["Standard", ...meta.workoutMethods])
          : ["Standard"]

        const aiValues: Record<string, any> = {
          movementPattern: meta.movementPattern,
          intensity: resolvedIntensity,
          exerciseType: resolvedExerciseType,
          explosive: meta.explosive,
          weightRequired: meta.weightRequired,
          spaceRequirement: meta.spaceRequirement,
          boxingType: meta.boxingType,
          category: resolvedCategory,
          muscleGroups: resolvedMuscleGroups,
          workoutMethods: resolvedWorkoutMethods,
        }

        const v = (key: string) =>
          manualFields.includes(key) ? row[FIELD_TO_COLUMN[key]] : aiValues[key]

        const isRegenerate = mode === "regenerate"

        const isMissingMovement = !row.movement_pattern || row.movement_pattern === ""
        const isMissingIntensity = !row.intensity || row.intensity === ""
        const isMissingMuscles = !row.muscle_groups || row.muscle_groups.length === 0

        const shouldUpdateMovement =
          !manualFields.includes("movementPattern") && (isRegenerate || isMissingMovement)
        const shouldUpdateIntensity =
          !manualFields.includes("intensity") && (isRegenerate || isMissingIntensity)
        const shouldUpdateExerciseType =
          !manualFields.includes("exerciseType") && (isRegenerate || !row.exercise_type || row.exercise_type === "")

        const shouldUpdateCategory =
          !manualFields.includes("category") &&
          resolvedCategory != null &&
          (isRegenerate || isHiit || !row.category || row.category === "General" || row.category === "")

        const shouldUpdateMuscleGroups =
          !manualFields.includes("muscleGroups") &&
          resolvedMuscleGroups.length > 0 &&
          (isRegenerate || isMissingMuscles)

        const shouldUpdateWorkoutMethods =
          !manualFields.includes("workoutMethods") &&
          resolvedWorkoutMethods.length > 0 &&
          (isRegenerate || !row.workout_methods || row.workout_methods.length === 0)

        const updated = await sql`
          UPDATE videos SET
            movement_pattern = CASE WHEN ${shouldUpdateMovement} THEN ${v("movementPattern")} ELSE movement_pattern END,
            intensity = CASE WHEN ${shouldUpdateIntensity} THEN ${v("intensity")} ELSE intensity END,
            exercise_type = CASE WHEN ${shouldUpdateExerciseType} THEN ${v("exerciseType")} ELSE exercise_type END,
            explosive = ${v("explosive")},
            weight_required = ${v("weightRequired")},
            space_requirement = ${v("spaceRequirement")},
            boxing_type = ${v("boxingType")},
            category = CASE WHEN ${shouldUpdateCategory} THEN ${resolvedCategory} ELSE category END,
            body_part = CASE WHEN ${shouldUpdateCategory} THEN ${resolvedCategory} ELSE body_part END,
            muscle_groups = CASE WHEN ${shouldUpdateMuscleGroups} THEN ${resolvedMuscleGroups}::text[] ELSE muscle_groups END,
            workout_methods = CASE WHEN ${shouldUpdateWorkoutMethods} THEN ${resolvedWorkoutMethods}::text[] ELSE workout_methods END,
            ai_confidence = ${Math.round(meta.confidence)},
            ai_generated_at = NOW()
          WHERE id = ${row.id}
          RETURNING *
        `
        if (updated[0]) processed.push(mapVideo(updated[0]))
      } catch (err: any) {
        console.error(`[v0] AI metadata failed for video ${row.id}:`, err?.message)
        errors.push({ id: row.id, error: err?.message ?? "unknown error" })
        // IMPORTANT: Do NOT stamp ai_generated_at on errors.
        // Doing so would hide the video from future "needs fill" queries
        // even though its movement_pattern / intensity / muscle_groups are
        // still empty.  The video will be retried on the next batch.
      }
    }

    // Re-query the true remaining count AFTER all updates.
    const remainingRows = await countNeedsFill()
    const remaining = remainingRows[0]?.c ?? 0
    const unknownTerms = Object.values(unknownTermMap)

    return NextResponse.json({
      processedCount: processed.length,
      processed,
      errors,
      remaining,
      // Signal done only when nothing is genuinely left.
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
    const rows = await countNeedsFill()
    return NextResponse.json({ needsReview: rows[0]?.c ?? 0 })
  } catch (error) {
    console.error("[v0] /api/videos/ai-metadata GET error:", error)
    return NextResponse.json({ needsReview: 0 })
  }
}
