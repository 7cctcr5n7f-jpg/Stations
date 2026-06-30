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
export type ExerciseType = "Strength" | "Cardio" | "Conditioning" | "Skill" | "Mobility"

export interface Video {
  id: number
  title: string
  url: string
  duration?: string | null
  bodyPart: string
  equipment: string
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

// Insert helper types
export type InsertRoom = Omit<Room, "id">
export type InsertVideo = Omit<Video, "id">
export type InsertSchedule = Omit<Schedule, "id">
export type InsertRoomAssignment = Omit<RoomAssignment, "id">
