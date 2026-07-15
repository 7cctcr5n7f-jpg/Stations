import type { Video } from "@/lib/shared/schema"

// Heart-rate zones map to the existing schedule colors:
//   green = Low, orange = Medium, red = High
export type HeartRate = "green" | "orange" | "red"
export type Intensity = "Low" | "Medium" | "High"

// Dynamic role assigned to each station per workout by the engine.
// Roles drive exercise selection and hybrid pairing logic.
export type StationRole =
  | "Warm-up"
  | "Strength"
  | "Hybrid"
  | "Boxing"
  | "HIIT Spike"
  | "Core"
  | "Recovery"
  | "Conditioning"

// Movement patterns used to enforce variation between mirror days (Mon/Thu, Tue/Fri, Wed/Sat).
export type MovementPatternCategory =
  | "horizontal_push"
  | "vertical_push"
  | "horizontal_pull"
  | "vertical_pull"
  | "hinge"
  | "squat"
  | "bilateral"
  | "unilateral"
  | "plyo"
  | "boxing"
  | "core"
  | "other"

// Per-category scoring used in the weekly quality validation report.
export interface WeeklyValidationCategory {
  score: number   // 0-100
  label: string
  notes: string[]
}

// Full weekly quality report produced after week generation.
export interface WeeklyValidationReport {
  muscleAccuracy: WeeklyValidationCategory
  equipmentBalance: WeeklyValidationCategory
  stationCompatibility: WeeklyValidationCategory
  exerciseVariety: WeeklyValidationCategory
  heartRateDistribution: WeeklyValidationCategory
  boxingExperience: WeeklyValidationCategory
  movementPatternBalance: WeeklyValidationCategory
  recoveryBalance: WeeklyValidationCategory
  overall: number          // 0-100 weighted average
  recommendations: string[]
  passesThreshold: boolean // true if every category >= 90
}

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
  /** Static config label. Engine ignores this for role assignment — it derives roles dynamically. */
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
  alternativeExercises: AlternativeExercisesConfig
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
  movementPatterns: MovementPatternCategory[]  // patterns this exercise uses
  // Optional coaching variation shown as a secondary alternative to the main move.
  isAlternative?: boolean
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
  // Dynamically assigned station role for this round.
  assignedRole: StationRole
  // Estimated kcal burned in this 2.5-min round based on HR zone.
  estimatedCalories: number
  // All movement pattern categories used in this round.
  movementPatterns: MovementPatternCategory[]
}

/** Structured muscle breakdown computed from all exercises in the workout. */
export interface MuscleBreakdown {
  /** Exercise titles / muscle names classified as push-pattern movements. */
  pushCount: number
  /** Exercise titles / muscle names classified as pull-pattern movements. */
  pullCount: number
  /** All unique muscle groups activated across the whole day, sorted by frequency. */
  muscles: string[]
}

export interface WorkoutDraft {
  date: string // yyyy-mm-dd
  weekday: number
  label: string | null
  rounds: GeneratedRound[]
  score: number // overall 0-100
  summary: string[] // overall explanation bullets
  muscleBreakdown: MuscleBreakdown
  warnings: string[]
  /** Heart-rate zone for each round in order (one per round). Used for the HR curve visualization. */
  hrCurve: HeartRate[]
  /** Estimated total kcal burned in the full 30-minute workout. */
  estimatedCalories: number
}

// ---- Builder session parameters (chosen in the UI per-generation) ----------

export type GenerationMode = "single" | "week" | "custom"

export type WorkoutFocus =
  | "Balanced"
  | "HIIT Focused"
  | "Functional Fitness"
  | "Boxing Focused"

/** Parameters the trainer picks in the Builder UI for a single generation run.
 *  These layer on top of (and never replace) the permanent BuilderConfig rules. */
export interface BuilderParams {
  mode: GenerationMode
  /** Start date: yyyy-mm-dd. For single = target day; for week/custom = Monday of the week. */
  startDate: string
  /** Which days to generate (0=Mon through 5=Sat). Used by "custom" mode. */
  selectedDays: number[]
  /** When true, generate a single exercise per room for a dropset week. */
  dropsetWeek: boolean
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

export type AlternativeMode = "Intelligent"

export type AlternativeFocus =
  | "Lower Body"
  | "Core"
  | "Functional Conditioning"
  | "Mobility"
  | "Low-Impact Options"

export interface AlternativeExercisesConfig {
  enabled: boolean
  mode: AlternativeMode
  maximumPerWorkout: number
  preferredFocus: AlternativeFocus[]
}

export const DEFAULT_ALTERNATIVE_EXERCISES_CONFIG: AlternativeExercisesConfig = {
  enabled: true,
  mode: "Intelligent",
  maximumPerWorkout: 2,
  preferredFocus: ["Lower Body", "Core"],
}

export const DEFAULT_BUILDER_PARAMS: BuilderParams = {
  mode: "week",
  startDate: "",
  selectedDays: [0, 1, 2, 3, 4, 5],
  dropsetWeek: false,
  focus: "Balanced" as WorkoutFocus,
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
  // Movement patterns used by the mirror day (Mon→Thu, Tue→Fri, Wed→Sat) to enforce variation.
  mirrorDayMovementPatterns?: MovementPatternCategory[]
  // Pre-planned HR spike room numbers (from week-level planning). Engine plans its own if absent.
  plannedSpikeRoomNumbers?: number[]
}
