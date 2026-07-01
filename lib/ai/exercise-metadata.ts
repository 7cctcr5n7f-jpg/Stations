import { generateObject } from "ai"
import { z } from "zod"

// Structured metadata the model infers from an exercise name (and any known equipment/body part).
export const exerciseMetadataSchema = z.object({
  movementPattern: z
    .string()
    .describe(
      "Primary movement pattern, e.g. Squat, Hinge, Lunge, Push, Pull, Carry, Rotation, Gait/Locomotion, Punch, Kick, Jump/Plyometric.",
    ),
  intensity: z
    .enum(["Low", "Medium", "High"])
    .describe(
      "Intensity based SOLELY on how much the exercise elevates heart rate during steady-state performance. " +
      "Low = heart rate barely rises (isolated strength moves: chest fly, bicep curl, tricep extension, lateral raise, leg extension, etc.). " +
      "Medium = moderate cardiovascular demand — heart rate elevates but stays sub-threshold (compound lifts: squat, deadlift, bench press, row, overhead press, lunges). " +
      "High = significant heart rate spike (HIIT, conditioning, battle ropes, burpees, jump rope, sprints, sled, circuits, boxing/striking). " +
      "NOTE: Muscle engagement and effort level do NOT determine intensity — only heart rate spike does. " +
      "Isolation exercises are ALWAYS Low even when they feel hard.",
    ),
  exerciseType: z
    .enum(["Strength", "Cardio", "Conditioning", "Skill", "Mobility"])
    .describe("The primary training category for the exercise."),
  explosive: z.boolean().describe("True if the movement is explosive/plyometric or power-focused."),
  weightRequired: z.boolean().describe("True if the exercise typically requires added weight or a loaded implement."),
  spaceRequirement: z
    .enum(["Stationary", "Small", "Large"])
    .describe("How much floor space the exercise needs. Stationary = on the spot, Small = a few steps, Large = travelling."),
  boxingType: z
    .string()
    .nullable()
    .describe(
      "If this is a boxing/striking drill, the type (e.g. Combination, Defense, Footwork, Pad Work, Bag Work). Otherwise null.",
    ),
  primaryMuscles: z
    .array(z.string())
    .describe(
      "List of primary muscles worked, e.g. ['Glutes', 'Quadriceps']. For boxing/punching drills include relevant muscles such as ['Shoulders', 'Core', 'Chest']. Use standard anatomical names.",
    ),
  secondaryMuscles: z
    .array(z.string())
    .describe(
      "List of secondary/stabiliser muscles worked, e.g. ['Hamstrings', 'Calves']. Can be empty if none are notable.",
    ),
  confidence: z
    .number()
    .min(0)
    .max(100)
    .describe("Your confidence (0-100) that this classification is correct given only the exercise name."),
})

export type ExerciseMetadata = z.infer<typeof exerciseMetadataSchema>

export const AI_MODEL = "openai/gpt-4o-mini"

export interface VideoForAI {
  id: number
  title: string
  bodyPart?: string | null
  equipment?: string | null
  secondaryMuscle?: string | null
}

/** A resolved entry from the exercise dictionary. */
export interface DictionaryGlossaryEntry {
  alias: string
  canonical: string
  category: string
}

/** Result returned by generateExerciseMetadata — metadata plus any unknown tokens found in the title. */
export interface ExerciseMetadataResult {
  metadata: ExerciseMetadata
  unknownTerms: string[]  // abbreviation-like tokens NOT found in the dictionary
}

/**
 * Tokenise a title into potential abbreviation-like terms.
 * A term qualifies if it is:
 *   - all uppercase (1–6 chars), e.g. "HK", "DB", "HIIT"
 *   - hyphenated with an uppercase component, e.g. "S-BALL", "L&R"
 *   - a number-prefixed shorthand, e.g. "10x", "4xHK"
 * Common English words and numbers are excluded.
 */
const COMMON_WORDS = new Set([
  "A","AN","THE","AND","OR","BUT","FOR","TO","OF","IN","ON","AT","BY","WITH",
  "FROM","IS","IT","BE","DO","UP","AS","NO","GO","HI","OK","VS","PM","AM",
])

function extractAbbreviations(title: string): string[] {
  // Split on whitespace and punctuation but keep hyphens/ampersands within tokens
  const tokens = title.split(/[\s,.()\[\]\/\\]+/).filter(Boolean)
  const candidates: string[] = []

  for (const raw of tokens) {
    const token = raw.trim().replace(/[^A-Za-z0-9\-&]/g, "")
    if (!token) continue

    // Must be at least 1 char and either all-caps or contains a hyphen/& with uppercase
    const upperToken = token.toUpperCase()
    const isAllUpper = token === upperToken && /[A-Z]/.test(token)
    const hasHyphenOrAmp = /[-&]/.test(token) && /[A-Z]/.test(token)

    if ((isAllUpper || hasHyphenOrAmp) && token.length >= 1 && token.length <= 8) {
      if (!COMMON_WORDS.has(upperToken) && !/^\d+$/.test(token)) {
        candidates.push(upperToken)
      }
    }
  }

  return [...new Set(candidates)]
}

/**
 * Generate structured metadata for a single exercise from its name and any
 * known attributes. Accepts an optional dictionary glossary to inject into
 * the prompt and detect unknown abbreviations.
 */
export async function generateExerciseMetadata(
  video: VideoForAI,
  glossary: DictionaryGlossaryEntry[] = [],
): Promise<ExerciseMetadataResult> {
  const known: string[] = []
  if (video.bodyPart) known.push(`Body part / primary muscle: ${video.bodyPart}`)
  if (video.secondaryMuscle) known.push(`Secondary muscle: ${video.secondaryMuscle}`)
  if (video.equipment) known.push(`Equipment: ${video.equipment}`)

  // Build a glossary lookup for unknown-term detection
  const glossaryAliasSet = new Set(glossary.map((e) => e.alias.toUpperCase()))

  // Find abbreviation-like tokens in the title not covered by the dictionary
  const titleTokens = extractAbbreviations(video.title)
  const unknownTerms = titleTokens.filter((t) => !glossaryAliasSet.has(t))

  // Build the glossary block injected into the system prompt
  const glossaryBlock =
    glossary.length > 0
      ? "\n\nExercise Dictionary (studio-specific abbreviations — treat these as ground truth):\n" +
        glossary
          .map((e) => `  ${e.alias} = ${e.canonical} (${e.category})`)
          .join("\n")
      : ""

  const { object } = await generateObject({
    model: AI_MODEL,
    schema: exerciseMetadataSchema,
    system:
      "You are a strength & conditioning and boxing coach classifying gym exercises for a HIIT/boxing studio. " +
      "Given an exercise name, infer structured training metadata. Be decisive but set a realistic confidence. " +
      "If the name is ambiguous or generic, lower the confidence accordingly. " +
      "Always use the provided Exercise Dictionary to resolve abbreviations before guessing.\n\n" +
      "HARD RULES (non-negotiable):\n" +
      "- Intensity is determined ONLY by heart rate spike, not by muscular effort or perceived difficulty.\n" +
      "  Low: isolation/accessory movements (fly, curl, extension, raise, press isolations) — heart rate barely moves.\n" +
      "  Medium: compound strength movements (squat, deadlift, bench press, row, overhead press, lunge) — moderate heart rate.\n" +
      "  High: conditioning/HIIT/boxing (battle ropes, burpees, sprints, circuits, any striking drill) — significant heart rate spike.\n" +
      "- Any boxing or striking exercise MUST have intensity = 'High'.\n" +
      "- Always populate primaryMuscles and secondaryMuscles with realistic anatomical muscles — never return empty arrays. " +
      "For a chest fly, secondaryMuscles should include ['Anterior Deltoid', 'Biceps'] even if minor." +
      glossaryBlock,
    prompt:
      `Classify this exercise.\n\nName: "${video.title}"` +
      (known.length ? `\nKnown attributes:\n- ${known.join("\n- ")}` : "") +
      `\n\nReturn the structured metadata.`,
  })

  return { metadata: object, unknownTerms }
}
