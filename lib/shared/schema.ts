// Shared domain types for the TENROUNDS Stations app.
// Mirrors the database columns (camelCase as returned by the API layer).

export interface Room {
  id: number
  number: number
  name: string
  description?: string | null
  isActive: boolean
}

export type Intensity = "Low" | "Medium" | "High"
export type SpaceRequirement = "Stationary" | "Small" | "Large"
export type ExerciseType = "Strength" | "HIIT" | "Conditioning" | "Skill" | "Mobility"

// Allowed Category values (single value per exercise).
export const EXERCISE_CATEGORIES = [
  "HIIT",
  "Chest",
  "Back",
  "Shoulders",
  "Biceps",
  "Triceps",
  "Legs",
  "Core",
  "Abs",
] as const
export type ExerciseCategory = (typeof EXERCISE_CATEGORIES)[number]

// Supported Workout Methods per exercise.
export const WORKOUT_METHODS = [
  "Standard",
  "Exercise Combination",
  "Boxing Combination",
  "Dropset",
  "Superset",
  "AMRAP",
] as const
export type WorkoutMethod = (typeof WORKOUT_METHODS)[number]

export interface Video {
  id: number
  title: string
  url: string
  duration?: string | null
  /** Category — the single primary workout category (HIIT / Chest / Back / etc.). */
  category: string
  /**
   * Muscle Groups — every muscle activated during the exercise (array).
   * Used for recovery/analytics only; never used for category validation.
   */
  muscleGroups: string[]
  /** Supported Workout Methods for this exercise. */
  workoutMethods: string[]
  equipment: string
  // ---- Deprecated aliases kept for backward compat (schedule/room code) ----
  /** @deprecated use category */
  bodyPart: string
  /** @deprecated use muscleGroups */
  secondaryMuscle?: string | null
  thumbnailUrl?: string | null
  lastUsed?: string | null
  nextScheduled?: string | null
  timesUsed?: number
  // AI-generated / trainer-editable metadata
  movementPattern?: string | null
  intensity?: Intensity | null
  exerciseType?: ExerciseType | string | null
  explosive?: boolean
  weightRequired?: boolean
  spaceRequirement?: SpaceRequirement | string | null
  boxingType?: string | null
  aiConfidence?: number | null
  aiGeneratedAt?: string | null
  // Names of fields a trainer has manually set; the AI generator must not overwrite these
  manualFields?: string[]
}

export interface Schedule {
  id: number
  roomId: number
  videoId: number
  scheduleDate: string
  reps?: string | null
  position: number
  displayTitle?: string | null
  displayEquipment?: string | null
  zoomLevel?: string | null
  verticalPosition?: string | null
  sets?: number | null
  restTime?: number | null
  isActive?: boolean | null
  heartRateZone?: string | null
}

export interface RoomAssignment {
  id: number
  roomId: number
  videoId: number
}

// Exercise Dictionary — AI knowledge base for studio-specific abbreviations/terms
export interface DictionaryEntry {
  id: number
  alias: string        // abbreviation or alternate name, e.g. "HK"
  canonical: string    // resolved canonical term, e.g. "Hook"
  category: string     // Punch | Equipment | Exercise | Modifier | Category | Format | Defence | BoxingDrill
  tags: string[]       // free-form tags for filtering
  notes: string | null // optional trainer notes
  createdAt: string | null
  updatedAt: string | null
}

export type InsertDictionaryEntry = Omit<DictionaryEntry, "id" | "createdAt" | "updatedAt">

// Insert helper types
export type InsertRoom = Omit<Room, "id">
export type InsertVideo = Omit<Video, "id">
export type InsertSchedule = Omit<Schedule, "id">
export type InsertRoomAssignment = Omit<RoomAssignment, "id">
