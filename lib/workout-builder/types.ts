import type { Video } from "@/lib/shared/schema"

// Heart-rate zones map to the existing schedule colors:
//   green = Low, orange = Medium, red = High
export type HeartRate = "green" | "orange" | "red"
export type Intensity = "Low" | "Medium" | "High"

export interface WeeklyTemplate {
  weekday: number // 0 = Sunday ... 6 = Saturday
  label: string | null
  primaryMuscles: string[]
  secondaryMuscles: string[]
  workoutStyle: string | null
  goals: Record<string, unknown>
}

export interface RoundConfig {
  roomId: number
  roomNumber?: number
  stationName: string | null
  stationRole: string | null
  preferredEquipment: string[]
  allowedEquipment: string[]
  avoidEquipment: string[]
  preferredCategories: string[]
  preferredHeartRate: HeartRate | null
  preferredIntensity: Intensity | null
  availableSpace: string | null
  coreOnly: boolean
}

export interface EquipmentLimit {
  equipment: string
  maxStations: number
}

export interface BuilderSettings {
  reuseWeeks: number
  minScore: number
  autoRegen: boolean
  weeklyChallenge: Record<string, unknown>
}

// A single exercise within a round. A round normally has two exercises,
// or one when the engine proposes a dropset (or a single boxing block).
export interface RoundExercise {
  videoId: number
  video: Video
  heartRate: HeartRate | null
  /** Published reps value. A number string (e.g. "10") or text like "Dropset" or "AMRAP". */
  reps: string | null
  score: number // 0-100 for this individual pick
  reasons: string[]
  warnings: string[]
  isBoxing: boolean
  gloveCompatible: boolean
}

// A single generated round in a workout draft.
export interface GeneratedRound {
  roomId: number
  roomNumber: number
  roomName: string
  exercises: RoundExercise[]
  // True when this round is a boxing station (members keep gloves on).
  isBoxingRound: boolean
  // True when gloves are on for this round (a boxing exercise is present),
  // so any second exercise must be glove-compatible.
  glovesOn: boolean
  // True when the round is a single-exercise dropset instead of two exercises.
  dropset: boolean
  locked: boolean
  score: number // 0-100 round average
  reasons: string[] // round-level explanation bullets
  warnings: string[]
}

export interface WorkoutDraft {
  date: string // yyyy-mm-dd
  weekday: number
  label: string | null
  rounds: GeneratedRound[]
  score: number // overall 0-100
  summary: string[] // overall explanation bullets
  warnings: string[]
}

// ---- Builder session parameters (chosen in the UI per-generation) ----------

export type GenerationMode = "single" | "week"

export type WorkoutFocus =
  | "Balanced"
  | "HIIT Focused"
  | "Strength Focused"
  | "Functional Fitness"
  | "Boxing Focused"
  | "Conditioning Focused"
  | "Endurance Focused"

/** Parameters the trainer picks in the Builder UI for a single generation run.
 *  These layer on top of (and never replace) the permanent BuilderConfig rules. */
export interface BuilderParams {
  mode: GenerationMode
  /** Start date: yyyy-mm-dd. For single = target day; for week = Monday of the week. */
  startDate: string
  focus: WorkoutFocus
  /** 0 = 100% Strength, 100 = 100% HIIT. Default 60. */
  hiitStrengthRatio: number
  /** 0–100. Influences how many boxing combos are included. Default 50. */
  boxingVolume: number
  /** 0–100. Influences functional / movement-pattern variety. Default 50. */
  functionalTraining: number
  includeWeeklyChallenge: boolean
  /** Minimum acceptable programme score (per day). Default 80. */
  minScore: number
}

export const DEFAULT_BUILDER_PARAMS: BuilderParams = {
  mode: "week",
  startDate: "",
  focus: "Balanced",
  hiitStrengthRatio: 60,
  boxingVolume: 50,
  functionalTraining: 50,
  includeWeeklyChallenge: true,
  minScore: 80,
}

// Inputs the engine needs to generate a workout.
export interface EngineInput {
  date: string
  weekday: number
  template: WeeklyTemplate | null
  roundConfigs: RoundConfig[]
  equipmentLimits: EquipmentLimit[]
  settings: BuilderSettings
  videos: Video[]
  // videoId -> most recent ISO date that video was scheduled (for rotation freshness)
  lastScheduledById: Record<number, string | null>
  // Existing rounds to preserve (locked picks) keyed by roomId
  lockedByRoomId?: Record<number, GeneratedRound>
  // Optional session parameters from the builder UI
  params?: BuilderParams
}
