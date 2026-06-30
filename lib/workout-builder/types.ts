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

// A single generated round in a workout draft.
export interface GeneratedRound {
  roomId: number
  roomNumber: number
  roomName: string
  videoId: number | null
  video: Video | null
  heartRate: HeartRate | null
  reps: number | null
  locked: boolean
  score: number // 0-100 for this individual pick
  reasons: string[] // human-readable explanation bullets
  warnings: string[] // constraint issues (e.g. "no candidate matched, relaxed rule")
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
}
