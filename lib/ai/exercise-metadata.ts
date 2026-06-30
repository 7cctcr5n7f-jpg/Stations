import { generateObject } from "ai"
import { z } from "zod"

// Structured metadata the model infers from an exercise name (and any known equipment/body part).
export const exerciseMetadataSchema = z.object({
  movementPattern: z
    .string()
    .describe(
      "Primary movement pattern, e.g. Squat, Hinge, Lunge, Push, Pull, Carry, Rotation, Gait/Locomotion, Punch, Kick, Jump/Plyometric.",
    ),
  intensity: z.enum(["Low", "Medium", "High"]).describe("Typical cardiovascular/effort intensity of the exercise."),
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

/**
 * Generate structured metadata for a single exercise from its name and any
 * known attributes. Uses the Vercel AI Gateway (zero-config in v0).
 */
export async function generateExerciseMetadata(video: VideoForAI): Promise<ExerciseMetadata> {
  const known: string[] = []
  if (video.bodyPart) known.push(`Body part / primary muscle: ${video.bodyPart}`)
  if (video.secondaryMuscle) known.push(`Secondary muscle: ${video.secondaryMuscle}`)
  if (video.equipment) known.push(`Equipment: ${video.equipment}`)

  const { object } = await generateObject({
    model: AI_MODEL,
    schema: exerciseMetadataSchema,
    system:
      "You are a strength & conditioning and boxing coach classifying gym exercises for a HIIT/boxing studio. " +
      "Given an exercise name, infer structured training metadata. Be decisive but set a realistic confidence. " +
      "If the name is ambiguous or generic, lower the confidence accordingly.",
    prompt:
      `Classify this exercise.\n\nName: "${video.title}"` +
      (known.length ? `\nKnown attributes:\n- ${known.join("\n- ")}` : "") +
      `\n\nReturn the structured metadata.`,
  })

  return object
}
