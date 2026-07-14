import type { Video } from "@/lib/shared/schema"
import { DEFAULT_ALTERNATIVE_EXERCISES_CONFIG } from "./types"
import type {
  AlternativeExercisesConfig,
  BuilderParams,
  EngineInput,
  GeneratedRound,
  HeartRate,
  Intensity,
  MovementPatternCategory,
  MuscleBreakdown,
  RoundConfig,
  RoundExercise,
  StationRole,
  WeeklyTemplate,
  WorkoutDraft,
} from "./types"

// ---- helpers ---------------------------------------------------------------

const INTENSITY_TO_HR: Record<Intensity, HeartRate> = {
  Low: "green",
  Medium: "orange",
  High: "red",
}

const HR_LABEL: Record<HeartRate, string> = {
  green: "Low",
  orange: "Medium",
  red: "High",
}

const HR_CALORIES: Record<HeartRate, number> = {
  green: 35,
  orange: 45,
  red: 55,
}

// Backward compatibility only. The engine derives boxing dynamically from station capabilities.
export const BOXING_ROUND_NUMBERS = [4, 5, 7, 10]

interface StationCapabilities {
  supportsActivation: boolean
  supportsStrength: boolean
  supportsConditioning: boolean
  supportsBoxing: boolean
  supportsCore: boolean
  supportsOpenFloor: boolean
  supportsFinisher: boolean
}

const STATION_CAPABILITIES_BY_ROOM: Record<number, Partial<StationCapabilities>> = {
  1: { supportsActivation: true, supportsOpenFloor: true },
  2: { supportsStrength: true },
  3: { supportsStrength: true, supportsConditioning: true, supportsOpenFloor: true },
  4: { supportsBoxing: true },
  5: { supportsBoxing: true },
  6: { supportsStrength: true, supportsConditioning: true },
  7: { supportsBoxing: true },
  8: { supportsCore: true },
  9: { supportsStrength: true },
  10: { supportsBoxing: true, supportsConditioning: true, supportsFinisher: true },
}

const GRIP_EQUIPMENT = [
  "db", "dumbbell", "dumbbells", "bb", "barbell", "kb", "kettlebell", "cable",
  "r.tube", "tube", "band", "resistance band", "b-rope", "battle rope", "rope",
  "jump rope", "trx", "plate", "bar", "ez bar", "ez-bar", "med ball", "medicine ball",
  "slam ball", "wall ball", "landmine", "rack",
]

const TEMPLATE_FAMILY_KEYWORDS: Record<string, string[]> = {
  chest: ["chest", "pec", "bench", "push"],
  back: ["back", "lat", "row", "pull"],
  shoulders: ["shoulder", "deltoid", "overhead"],
  arms: ["arm", "bicep", "tricep", "curl", "extension"],
  biceps: ["bicep", "curl"],
  triceps: ["tricep", "extension", "dip"],
  legs: ["leg", "quad", "hamstring", "glute", "calf", "lunge", "squat", "hinge"],
  glutes: ["glute", "hip thrust"],
  quads: ["quad", "squat", "lunge"],
  hamstrings: ["hamstring", "rdl", "hinge", "deadlift"],
  calves: ["calf"],
  core: ["core", "abs", "oblique", "rotation", "plank"],
  abs: ["abs", "core", "oblique", "plank"],
}

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase()
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function roomNumberOf(cfg: RoundConfig): number {
  return cfg.roomNumber ?? cfg.roomId
}

function equipmentTokens(v: Video): string[] {
  return norm(v.equipment)
    .split(/[,/]/)
    .map((t) => t.trim())
    .filter(Boolean)
}

function muscleTokens(v: Video): string[] {
  const out: string[] = []
  if (Array.isArray(v.muscleGroups) && v.muscleGroups.length > 0) {
    for (const m of v.muscleGroups) {
      const token = norm(m)
      if (token) out.push(token)
    }
  } else {
    if (v.bodyPart) out.push(norm(v.bodyPart))
    if (v.secondaryMuscle) {
      for (const m of v.secondaryMuscle.split(/[,/]/)) {
        const token = norm(m)
        if (token) out.push(token)
      }
    }
  }
  return unique(out)
}

function exerciseCategory(v: Video): string {
  return norm(v.category) || norm(v.bodyPart)
}

function videoText(v: Video): string {
  return [
    norm(v.title),
    norm(v.exerciseType),
    norm(v.movementPattern),
    norm(v.category),
    norm(v.bodyPart),
    norm(v.boxingType),
    norm(v.equipment),
    ...muscleTokens(v),
  ].join(" ")
}

function videoHr(video: Video): HeartRate | null {
  if (!video.intensity) return null
  return INTENSITY_TO_HR[video.intensity as Intensity] ?? null
}

function isCore(v: Video): boolean {
  const text = videoText(v)
  return /core|abs|oblique|plank|hollow|rotation/.test(text)
}

function isLowerBody(v: Video): boolean {
  const text = videoText(v)
  return /leg|quad|hamstring|glute|calf|lunge|squat|hinge|deadlift|step-up|split squat/.test(text)
}

function isMobility(v: Video): boolean {
  const text = videoText(v)
  return /mobility|stretch|recovery|activation|warm-up|warmup|reset/.test(text)
}

function isFunctionalConditioning(v: Video): boolean {
  const text = videoText(v)
  return /functional|conditioning|hiit|cardio|metcon|circuit|battle rope|trx/.test(text)
}

function isLowImpact(v: Video): boolean {
  const text = videoText(v)
  if (norm(v.intensity) === "low") return true
  return /march|step|tempo|control|slow|hold|mobility|stretch/.test(text)
}

function isPushDominant(v: Video): boolean {
  return /push|press|chest|tricep|shoulder press|dip|fly|bench/.test(videoText(v))
}

function isStrengthExercise(v: Video): boolean {
  const cat = exerciseCategory(v)
  const type = norm(v.exerciseType)
  const text = videoText(v)
  return (
    !isBoxingExercise(v) &&
    (
      type.includes("strength") ||
      type.includes("hypertrophy") ||
      v.weightRequired === true ||
      cat.includes("chest") ||
      cat.includes("back") ||
      cat.includes("shoulder") ||
      cat.includes("arm") ||
      cat.includes("bicep") ||
      cat.includes("tricep") ||
      cat.includes("leg") ||
      /bench|press|row|deadlift|squat|lunge|curl|extension|thrust/.test(text)
    )
  )
}

function isHiitExercise(v: Video): boolean {
  const cat = exerciseCategory(v)
  const type = norm(v.exerciseType)
  const text = videoText(v)
  return cat === "hiit" || type.includes("hiit") || /burpee|jump|sprint|skater|mountain climber/.test(text)
}

function isConditioningExercise(v: Video): boolean {
  const type = norm(v.exerciseType)
  return type.includes("conditioning") || isHiitExercise(v) || isFunctionalConditioning(v)
}

function hasBoxingEquipment(v: Video): boolean {
  const tokens = equipmentTokens(v)
  return tokens.some((t) => t.includes("boxing") || t.includes("w.bag") || t === "bag" || t.includes("pad"))
}

function isBoxingExercise(v: Video): boolean {
  if (hasBoxingEquipment(v)) return true
  if (v.boxingType && norm(v.boxingType)) return true
  return /box|punch|jab|cross|hook|uppercut|strik|bag|pad|spar|muay/.test(videoText(v))
}

function gloveCompatible(v: Video): boolean {
  if (isBoxingExercise(v)) return true
  const tokens = equipmentTokens(v)
  if (tokens.length === 0) return true
  return !tokens.some((t) => GRIP_EQUIPMENT.some((g) => t === g || t.includes(g)))
}

function daysSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  return Math.floor((now.getTime() - then) / (1000 * 60 * 60 * 24))
}

function classifyMovementPattern(video: Video): MovementPatternCategory[] {
  if (isBoxingExercise(video)) return ["boxing"]
  const text = videoText(video)
  const patterns: MovementPatternCategory[] = []

  if (isCore(video)) patterns.push("core")
  if (/bench|push-up|push up|chest press|fly|row|reverse fly/.test(text)) {
    if (/row|reverse fly/.test(text)) patterns.push("horizontal_pull")
    if (/bench|push-up|push up|chest press|fly/.test(text)) patterns.push("horizontal_push")
  }
  if (/shoulder press|overhead|landmine press|push press|thruster|pike/.test(text)) patterns.push("vertical_push")
  if (/pull-up|pull up|chin-up|chin up|pulldown|lat pull/.test(text)) patterns.push("vertical_pull")
  if (/deadlift|rdl|hinge|swing|good morning|hip thrust/.test(text)) patterns.push("hinge")
  if (/squat|lunge|split squat|step-up|step up|wall sit|thruster/.test(text)) patterns.push("squat")
  if (/single-arm|single arm|single-leg|single leg|unilateral|split squat|lunge|step-up|step up/.test(text)) {
    patterns.push("unilateral")
  }
  if (
    /jump|burpee|plyo|box jump|jump squat|skater|tuck jump|mountain climber|sprint|slam/.test(text)
  ) {
    patterns.push("plyo")
  }

  const hasPattern = patterns.length > 0
  if (!patterns.includes("unilateral") && /squat|deadlift|row|press|push-up|push up|plank|thrust/.test(text)) {
    patterns.push("bilateral")
  }
  if (!hasPattern && !patterns.length) patterns.push("other")

  return unique(patterns)
}

function estimateCalories(hr: HeartRate): number {
  return HR_CALORIES[hr]
}

function collectMovementPatterns(exercises: RoundExercise[]): MovementPatternCategory[] {
  return unique(exercises.flatMap((ex) => ex.movementPatterns))
}

function normalisePatternSet(patterns?: MovementPatternCategory[]): Set<MovementPatternCategory> {
  return new Set((patterns ?? []).filter(Boolean))
}

function extractTemplateFamilies(template: WeeklyTemplate | null): Set<string> {
  if (!template) return new Set()
  const out = new Set<string>()
  for (const value of [...template.primaryMuscles, ...template.secondaryMuscles]) {
    const token = norm(value)
    if (!token) continue
    for (const [family, keywords] of Object.entries(TEMPLATE_FAMILY_KEYWORDS)) {
      if (keywords.some((keyword) => token.includes(keyword) || keyword.includes(token))) {
        out.add(family)
      }
    }
  }
  return out
}

function extractVideoFamilies(video: Video): Set<string> {
  const text = `${exerciseCategory(video)} ${norm(video.bodyPart)} ${muscleTokens(video).join(" ")} ${norm(video.title)}`
  const out = new Set<string>()
  for (const [family, keywords] of Object.entries(TEMPLATE_FAMILY_KEYWORDS)) {
    if (keywords.some((keyword) => text.includes(keyword))) out.add(family)
  }
  return out
}

function shouldValidateMuscleGroups(role: StationRole): boolean {
  return role !== "Boxing" && role !== "Core" && role !== "HIIT Spike"
}

function matchesTemplateMuscles(video: Video, template: WeeklyTemplate | null, role: StationRole, strict: boolean): boolean {
  if (!template || !shouldValidateMuscleGroups(role)) return true

  const templateFamilies = extractTemplateFamilies(template)
  if (templateFamilies.size === 0) return true

  const videoFamilies = extractVideoFamilies(video)
  if (videoFamilies.size === 0) return !strict

  if (strict) {
    return [...videoFamilies].every((family) => templateFamilies.has(family))
  }

  return [...videoFamilies].some((family) => templateFamilies.has(family))
}

function resolveStationCapabilities(cfg: RoundConfig): StationCapabilities {
  const roomNumber = roomNumberOf(cfg)
  const fromRoom = STATION_CAPABILITIES_BY_ROOM[roomNumber] ?? {}
  const text = [
    norm(cfg.stationName),
    norm(cfg.stationRole),
    ...cfg.preferredEquipment.map(norm),
    ...cfg.allowedEquipment.map(norm),
    ...cfg.preferredCategories.map(norm),
  ].join(" ")

  return {
    supportsActivation: fromRoom.supportsActivation ?? /activation|warm/.test(text),
    supportsStrength: fromRoom.supportsStrength ?? /bench|db|dumbbell|bar|ez|calf|strength/.test(text),
    supportsConditioning: fromRoom.supportsConditioning ?? /rope|trx|open floor|conditioning|water/.test(text),
    supportsBoxing: fromRoom.supportsBoxing ?? /box|bag|muay|maze/.test(text),
    supportsCore: fromRoom.supportsCore ?? (cfg.coreOnly || /core/.test(text)),
    supportsOpenFloor: fromRoom.supportsOpenFloor ?? /open floor|floor/.test(text),
    supportsFinisher: fromRoom.supportsFinisher ?? /water bag|finisher/.test(text),
  }
}

function weekSeed(date: string): number {
  const d = new Date(`${date}T12:00:00`)
  const year = d.getUTCFullYear()
  const start = Date.UTC(year, 0, 1)
  const ordinal = Math.floor((d.getTime() - start) / (1000 * 60 * 60 * 24))
  return year * 100 + Math.floor(ordinal / 7)
}

function seededScore(seed: number, roomNumber: number): number {
  const value = Math.sin(seed * 97 + roomNumber * 31) * 10000
  return value - Math.floor(value)
}

// Intentionally creates 3-5 red-zone spikes with deterministic week-to-week variation.
function planHrSpikes(configs: RoundConfig[], input: EngineInput, mods: EngineModifiers): Set<number> {
  const requested = unique((input.plannedSpikeRoomNumbers ?? []).filter((value) => Number.isFinite(value)))
  if (requested.length > 0) return new Set(requested)

  const seed = weekSeed(input.date)
  const targetCount = Math.max(
    3,
    Math.min(
      5,
      mods.hiitFocused || mods.boxingFocused ? 5 : mods.functionalFocused ? 3 + (seed % 2) : 4,
    ),
  )

  const candidates = configs
    .map((cfg) => {
      const roomNumber = roomNumberOf(cfg)
      const capabilities = resolveStationCapabilities(cfg)
      let weight = 0
      if (capabilities.supportsFinisher) weight += 8
      if (capabilities.supportsBoxing) weight += 5
      if (capabilities.supportsConditioning) weight += 4
      if (capabilities.supportsStrength && capabilities.supportsOpenFloor) weight += 3
      if (capabilities.supportsActivation) weight -= 6
      if (capabilities.supportsCore) weight -= 8
      weight += seededScore(seed, roomNumber)
      return { roomNumber, capabilities, weight }
    })
    .filter(({ capabilities }) => !capabilities.supportsCore && !capabilities.supportsActivation)
    .sort((a, b) => b.weight - a.weight)

  const spikes = new Set<number>()
  for (const candidate of candidates) {
    const roomNumber = candidate.roomNumber
    const allowAdjacency = candidate.capabilities.supportsFinisher
    const tooClose = [...spikes].some((existing) => Math.abs(existing - roomNumber) <= 1)
    if (!allowAdjacency && tooClose) continue
    spikes.add(roomNumber)
    if (spikes.size >= targetCount) break
  }

  for (const candidate of candidates) {
    if (spikes.size >= targetCount) break
    spikes.add(candidate.roomNumber)
  }

  return spikes
}

function assignStationRoles(configs: RoundConfig[], spikeRoomNumbers: Set<number>, mods: EngineModifiers): Map<number, StationRole> {
  const roles = new Map<number, StationRole>()
  let recoveryAssigned = false

  for (const cfg of configs) {
    const roomNumber = roomNumberOf(cfg)
    const capabilities = resolveStationCapabilities(cfg)

    let role: StationRole
    if (capabilities.supportsCore) {
      role = "Core"
    } else if (capabilities.supportsBoxing) {
      role = "Boxing"
    } else if (capabilities.supportsActivation) {
      role = "Warm-up"
    } else if (spikeRoomNumbers.has(roomNumber) && !capabilities.supportsBoxing) {
      role = "HIIT Spike"
    } else if (
      capabilities.supportsStrength &&
      (capabilities.supportsConditioning || roomNumber === 6 || roomNumber === 3) &&
      (mods.hiitBias >= 0.45 || mods.hiitFocused || mods.functionalFocused)
    ) {
      role = "Hybrid"
    } else if (!recoveryAssigned && roomNumber === 3 && !mods.hiitFocused) {
      role = "Recovery"
      recoveryAssigned = true
    } else if (capabilities.supportsStrength) {
      role = "Strength"
    } else {
      role = "Conditioning"
    }

    roles.set(cfg.roomId, role)
  }

  return roles
}

function resolveTargetHr(role: StationRole, cfg: RoundConfig, capabilities: StationCapabilities, spikeRoomNumbers: Set<number>): HeartRate {
  const roomNumber = roomNumberOf(cfg)
  const preferred = cfg.preferredHeartRate ?? (cfg.preferredIntensity ? INTENSITY_TO_HR[cfg.preferredIntensity] : null)
  const isSpike = spikeRoomNumbers.has(roomNumber)

  if (preferred && role !== "HIIT Spike") {
    if (role === "Core") return "green"
    if (role === "Warm-up") return "green"
    if (role === "Recovery") return "green"
    if (role === "Boxing" && capabilities.supportsFinisher) return "red"
    return isSpike ? "red" : preferred
  }

  switch (role) {
    case "Warm-up":
    case "Recovery":
    case "Core":
      return "green"
    case "HIIT Spike":
      return "red"
    case "Hybrid":
      return isSpike ? "red" : "orange"
    case "Conditioning":
      return isSpike ? "red" : "orange"
    case "Strength":
      return isSpike ? "orange" : "green"
    case "Boxing":
      return capabilities.supportsFinisher || isSpike ? "red" : "orange"
    default:
      return "orange"
  }
}

function detectHybridOpportunity(args: {
  role: StationRole
  cfg: RoundConfig
  targetHr: HeartRate
  leadExercise: Video
}): boolean {
  if (args.role !== "Hybrid") return false
  if (!isStrengthExercise(args.leadExercise)) return false
  if (args.targetHr === "green") return false
  const patterns = classifyMovementPattern(args.leadExercise)
  return patterns.some((pattern) => ["horizontal_push", "vertical_push", "horizontal_pull", "vertical_pull", "hinge", "squat"].includes(pattern))
}

function passesSpaceRules(video: Video, cfg: RoundConfig): boolean {
  const roomSpace = norm(cfg.availableSpace)
  if (!roomSpace) return true
  const videoSpace = norm(video.spaceRequirement ?? "")
  if (!videoSpace) return true
  if (roomSpace === "large") return true
  if (roomSpace === "small") return videoSpace === "small" || videoSpace === "stationary"
  if (roomSpace === "stationary") return videoSpace === "stationary"
  return true
}

function matchesRoleLead(video: Video, role: StationRole): boolean {
  switch (role) {
    case "Warm-up":
      return !isBoxingExercise(video) && (isLowImpact(video) || isMobility(video) || videoHr(video) === "green")
    case "Strength":
      return isStrengthExercise(video)
    case "Hybrid":
      return isStrengthExercise(video)
    case "Boxing":
      return isBoxingExercise(video) || hasBoxingEquipment(video)
    case "HIIT Spike":
      return !isBoxingExercise(video) && (isHiitExercise(video) || isConditioningExercise(video) || classifyMovementPattern(video).includes("plyo"))
    case "Core":
      return isCore(video)
    case "Recovery":
      return !isBoxingExercise(video) && (isMobility(video) || isLowImpact(video) || videoHr(video) === "green")
    case "Conditioning":
      return !isBoxingExercise(video) && (isConditioningExercise(video) || isHiitExercise(video) || isFunctionalConditioning(video))
    default:
      return true
  }
}

function patternsShareLowerBody(patterns: MovementPatternCategory[]): boolean {
  return patterns.some((pattern) => pattern === "hinge" || pattern === "squat" || pattern === "unilateral")
}

function compatibleHybridPair(lead: Video, candidate: Video): boolean {
  const leadPatterns = classifyMovementPattern(lead)
  const candidatePatterns = classifyMovementPattern(candidate)
  if (isLowImpact(candidate) || isMobility(candidate) || candidatePatterns.includes("core")) return false
  if (!isHiitExercise(candidate) && !isConditioningExercise(candidate) && !candidatePatterns.includes("plyo")) return false

  const lowerBodyLead = patternsShareLowerBody(leadPatterns)
  if (lowerBodyLead) {
    return candidatePatterns.includes("plyo") || patternsShareLowerBody(candidatePatterns)
  }

  if (leadPatterns.some((pattern) => pattern === "horizontal_push" || pattern === "vertical_push")) {
    return candidatePatterns.includes("plyo") || isConditioningExercise(candidate)
  }

  if (leadPatterns.some((pattern) => pattern === "horizontal_pull" || pattern === "vertical_pull")) {
    return candidatePatterns.includes("plyo") || isConditioningExercise(candidate)
  }

  return isConditioningExercise(candidate)
}

function matchesRoleSecondary(video: Video, role: StationRole, leadExercise: Video, glovesOn: boolean): boolean {
  if (glovesOn && !gloveCompatible(video)) return false

  switch (role) {
    case "Warm-up":
    case "Recovery":
      return !isBoxingExercise(video) && (isLowImpact(video) || isMobility(video) || videoHr(video) === "green")
    case "Strength":
      return !isBoxingExercise(video) && (isStrengthExercise(video) || isConditioningExercise(video))
    case "Hybrid":
      return compatibleHybridPair(leadExercise, video)
    case "Boxing":
      return glovesOn ? gloveCompatible(video) && (isBoxingExercise(video) || videoHr(video) !== "green") : isBoxingExercise(video)
    case "HIIT Spike":
      return !isBoxingExercise(video) && (isHiitExercise(video) || isConditioningExercise(video) || classifyMovementPattern(video).includes("plyo"))
    case "Core":
      return isCore(video)
    case "Conditioning":
      return !isBoxingExercise(video) && (isConditioningExercise(video) || isHiitExercise(video) || classifyMovementPattern(video).includes("plyo"))
    default:
      return true
  }
}

function pairingBonus(leadExercise: Video, candidate: Video, role: StationRole, targetHr: HeartRate): number {
  const leadPatterns = classifyMovementPattern(leadExercise)
  const candidatePatterns = classifyMovementPattern(candidate)
  let bonus = 0

  if (role === "Hybrid") {
    if (compatibleHybridPair(leadExercise, candidate)) bonus += 18
    if (targetHr !== "green" && videoHr(candidate) === "red") bonus += 6
    if (isLowImpact(candidate) || isMobility(candidate)) bonus -= 30
  }

  if (role === "Strength") {
    if (leadPatterns.some((pattern) => !candidatePatterns.includes(pattern))) bonus += 5
    if (targetHr !== "green" && isConditioningExercise(candidate)) bonus += 4
  }

  if (role === "Conditioning" || role === "HIIT Spike") {
    if (candidatePatterns.includes("plyo")) bonus += 8
    if (videoHr(candidate) === "red") bonus += 4
  }

  if (role === "Boxing") {
    if (isBoxingExercise(candidate)) bonus += 8
    if (targetHr === "red" && videoHr(candidate) === "green") bonus -= 20
  }

  return bonus
}

// ---- params-derived modifiers ----------------------------------------------

interface EngineModifiers {
  hiitBias: number
  boxingFocused: boolean
  hiitFocused: boolean
  functionalFocused: boolean
  balanced: boolean
  intensityOverride: HeartRate | null
  boxingVolumeFraction: number
  functionalRoomNumbers: Set<number>
}

function resolveModifiers(params: BuilderParams | undefined): EngineModifiers {
  const base: EngineModifiers = {
    hiitBias: 0.6,
    boxingFocused: false,
    hiitFocused: false,
    functionalFocused: false,
    balanced: true,
    intensityOverride: null,
    boxingVolumeFraction: 0.5,
    functionalRoomNumbers: new Set(),
  }
  if (!params) return base

  return {
    hiitBias: params.hiitStrengthRatio / 100,
    boxingFocused: params.focus === "Boxing Focused",
    hiitFocused: params.focus === "HIIT Focused",
    functionalFocused: params.focus === "Functional Fitness",
    balanced: params.focus === "Balanced",
    intensityOverride: null,
    boxingVolumeFraction: params.boxingVolume / 100,
    functionalRoomNumbers: params.focus === "Functional Fitness" ? new Set([2, 3, 6, 9]) : new Set(),
  }
}

// ---- scoring ---------------------------------------------------------------

interface ScoredCandidate {
  video: Video
  score: number
  reasons: string[]
  movementPatterns: MovementPatternCategory[]
}

interface ScoreCandidateContext {
  cfg: RoundConfig
  template: WeeklyTemplate | null
  reuseWeeks: number
  lastScheduledIso: string | null
  usedEquipmentCounts: Record<string, number>
  usedMovementPatterns: Set<MovementPatternCategory>
  mirrorDayMovementPatterns: Set<MovementPatternCategory>
  now: Date
  mods: EngineModifiers
  targetHr: HeartRate | null
  role: StationRole
}

const W = {
  templateMuscle: 30,
  rotationFreshness: 25,
  equipmentPref: 15,
  intensityFit: 15,
  category: 10,
  variety: 5,
  movementVariety: 10,
}

function scoreCandidate(video: Video, context: ScoreCandidateContext): ScoredCandidate {
  const {
    cfg,
    template,
    reuseWeeks,
    lastScheduledIso,
    usedEquipmentCounts,
    usedMovementPatterns,
    mirrorDayMovementPatterns,
    now,
    mods,
    targetHr,
    role,
  } = context

  const reasons: string[] = []
  let score = 0

  const cat = exerciseCategory(video)
  const isHiit = isHiitExercise(video)
  const isStrength = isStrengthExercise(video)
  const isBoxingEx = isBoxingExercise(video)
  const isFunctional = isFunctionalConditioning(video)
  const movementPatterns = classifyMovementPattern(video)

  if (template && (template.primaryMuscles.length || template.secondaryMuscles.length)) {
    const mt = muscleTokens(video)
    const primaryHit = template.primaryMuscles.some((m) => mt.some((t) => t.includes(norm(m)) || norm(m).includes(t)))
    const secondaryHit = template.secondaryMuscles.some((m) => mt.some((t) => t.includes(norm(m)) || norm(m).includes(t)))
    if (primaryHit) {
      score += W.templateMuscle
      reasons.push(`Targets today's primary muscle group (${video.category || video.bodyPart})`)
    } else if (secondaryHit) {
      score += W.templateMuscle * 0.5
      reasons.push("Hits a secondary muscle group for today")
    }
  } else {
    score += W.templateMuscle * 0.4
  }

  const windowDays = reuseWeeks * 7
  const since = daysSince(lastScheduledIso, now)
  if (since === null) {
    score += W.rotationFreshness
    reasons.push("Never scheduled before — fresh for members")
  } else if (since >= windowDays) {
    score += W.rotationFreshness
    reasons.push(`Last used ${since}d ago (outside ${reuseWeeks}-week rotation)`)
  } else {
    const frac = since / Math.max(1, windowDays)
    score += W.rotationFreshness * frac
    reasons.push(`Used ${since}d ago — partially fresh`)
  }

  const tokens = equipmentTokens(video)
  const pref = cfg.preferredEquipment.map(norm)
  const avoid = cfg.avoidEquipment.map(norm)
  if (avoid.length && tokens.some((t) => avoid.includes(t))) {
    score -= W.equipmentPref
    reasons.push("Uses avoided equipment")
  } else if (pref.length && tokens.some((t) => pref.includes(t))) {
    score += W.equipmentPref
    reasons.push("Uses preferred equipment for this station")
  } else {
    score += W.equipmentPref * 0.5
  }

  const desiredHr = targetHr ?? mods.intensityOverride ?? cfg.preferredHeartRate ?? (cfg.preferredIntensity ? INTENSITY_TO_HR[cfg.preferredIntensity] : null)
  const candidateHr = videoHr(video)
  if (desiredHr && candidateHr) {
    if (desiredHr === candidateHr) {
      score += W.intensityFit
      reasons.push(`Matches target heart-rate zone (${HR_LABEL[desiredHr]})`)
    } else if ((desiredHr === "red" && candidateHr === "orange") || (desiredHr === "orange" && candidateHr === "green")) {
      score += W.intensityFit * 0.55
    } else {
      score += W.intensityFit * 0.25
    }
  } else {
    score += W.intensityFit * 0.5
  }

  if (cfg.preferredCategories.length) {
    const cats = cfg.preferredCategories.map(norm)
    const vt = [norm(video.exerciseType), norm(video.movementPattern), norm(video.boxingType), cat]
    if (vt.some((t) => t && cats.includes(t))) {
      score += W.category
      reasons.push("Matches preferred station category")
    }
  } else {
    score += W.category * 0.5
  }

  const overused = tokens.filter((t) => (usedEquipmentCounts[t] ?? 0) > 0)
  if (overused.length === 0) score += W.variety
  else score += W.variety * 0.4

  const overlapsUsed = movementPatterns.filter((pattern) => usedMovementPatterns.has(pattern))
  const overlapsMirror = movementPatterns.filter((pattern) => mirrorDayMovementPatterns.has(pattern))
  if (overlapsUsed.length === 0) {
    score += W.movementVariety * 0.6
    reasons.push("Adds movement-pattern variety")
  } else {
    score += W.movementVariety * 0.2
  }
  if (overlapsMirror.length > 0) {
    score -= 8
  } else if (mirrorDayMovementPatterns.size > 0) {
    score += 4
    reasons.push("Differentiates from the mirror day movement pattern mix")
  }

  switch (role) {
    case "Boxing":
      if (isBoxingEx) {
        score += 12
        reasons.push("Fits the boxing station role")
      }
      break
    case "Strength":
      if (isStrength) score += 10
      else if (isHiit) score -= 8
      break
    case "Hybrid":
      if (isStrength || isHiit || isFunctional) score += 10
      break
    case "HIIT Spike":
      if (isHiit || candidateHr === "red") score += 12
      break
    case "Core":
      if (isCore(video)) score += 12
      break
    case "Recovery":
      if (isLowImpact(video) || isMobility(video) || candidateHr === "green") score += 10
      break
    case "Conditioning":
      if (isConditioningExercise(video) || isHiit) score += 10
      break
    case "Warm-up":
      if (isLowImpact(video) || isMobility(video)) score += 8
      break
  }

  if (mods.hiitFocused) {
    if (isHiit || candidateHr === "red") {
      score += 10
      reasons.push("Fits HIIT-focused programme")
    } else if (isStrength && !isBoxingEx) {
      score -= 5
    }
  }

  if (mods.boxingFocused && isBoxingEx) {
    score += 10
    reasons.push("Boxing-focused programme")
  }

  if (mods.functionalFocused && isFunctional) {
    score += 8
    reasons.push("Functional Fitness programme")
  }

  if (mods.balanced && isHiit && mods.hiitBias > 0.5) {
    score += Math.round((mods.hiitBias - 0.5) * 12)
  }

  score = Math.max(0, Math.min(100, Math.round(score)))
  return { video, score, reasons, movementPatterns }
}

// ---- alternative exercises pass --------------------------------------------

function defaultReps(video: Video): string {
  const methods = (video.workoutMethods ?? []).map((m) => m.toLowerCase())
  if (methods.includes("amrap")) return "AMRAP"
  if (methods.includes("dropset")) return "Dropset"

  const cat = norm(video.category ?? "")
  const type = norm(video.exerciseType ?? "")
  const isBoxing = isBoxingExercise(video)
  const isSuperSet = methods.includes("superset")

  if (isBoxing) {
    const comboText = `${video.title ?? ""} ${video.boxingType ?? ""}`.toLowerCase()
    const punchWords = ["jab", "cross", "hook", "uppercut", "left", "right", "1", "2", "3", "4", "5", "6"]
    const punchCount = punchWords.filter((word) => comboText.includes(word)).length
    return punchCount <= 3 ? "10-20 rounds" : "5 rounds min"
  }

  if (cat === "hiit" || type === "hiit" || type === "conditioning") return "AMRAP"
  if (cat === "core" || cat === "abs") return "20"
  if (["chest", "back", "shoulders", "arms", "biceps", "triceps", "legs"].includes(cat)) {
    return isSuperSet ? "10-12" : "12"
  }

  return "10"
}

function makeExercise(scored: ScoredCandidate, targetHr: HeartRate | null): RoundExercise {
  return {
    videoId: scored.video.id,
    video: scored.video,
    heartRate: targetHr ?? videoHr(scored.video),
    reps: defaultReps(scored.video),
    score: scored.score,
    reasons: [...scored.reasons],
    warnings: [],
    isBoxing: isBoxingExercise(scored.video),
    gloveCompatible: gloveCompatible(scored.video),
    movementPatterns: scored.movementPatterns,
  }
}

function recalculateRoundScore(round: GeneratedRound): number {
  const scoringSet = round.exercises.filter((exercise) => !exercise.isAlternative)
  const source = scoringSet.length ? scoringSet : round.exercises
  if (!source.length) return 0
  return Math.round(source.reduce((sum, exercise) => sum + exercise.score, 0) / source.length)
}

function addEquipmentUsage(usedEquipmentCounts: Record<string, number>, video: Video) {
  for (const token of equipmentTokens(video)) {
    usedEquipmentCounts[token] = (usedEquipmentCounts[token] ?? 0) + 1
  }
}

function removeEquipmentUsage(usedEquipmentCounts: Record<string, number>, video: Video) {
  for (const token of equipmentTokens(video)) {
    const current = usedEquipmentCounts[token] ?? 0
    if (current <= 1) delete usedEquipmentCounts[token]
    else usedEquipmentCounts[token] = current - 1
  }
}

function refreshRoundDerivedFields(round: GeneratedRound): GeneratedRound {
  const movementPatterns = collectMovementPatterns(round.exercises)
  return {
    ...round,
    score: recalculateRoundScore(round),
    movementPatterns,
  }
}

function normaliseAlternativeSettings(settings: EngineInput["settings"]): AlternativeExercisesConfig {
  const fromSettings = settings.alternativeExercises ?? DEFAULT_ALTERNATIVE_EXERCISES_CONFIG
  const weeklyChallenge = settings.weeklyChallenge as Record<string, unknown> | null
  const fromWeeklyChallenge = (weeklyChallenge?.alternativeExercises ?? {}) as Partial<AlternativeExercisesConfig>
  const preferredFocus = Array.isArray(fromWeeklyChallenge.preferredFocus)
    ? fromWeeklyChallenge.preferredFocus
    : fromSettings.preferredFocus

  return {
    ...DEFAULT_ALTERNATIVE_EXERCISES_CONFIG,
    ...fromSettings,
    ...fromWeeklyChallenge,
    mode: "Intelligent",
    maximumPerWorkout: Math.max(
      0,
      Math.min(
        5,
        Number.isFinite(Number(fromWeeklyChallenge.maximumPerWorkout))
          ? Number(fromWeeklyChallenge.maximumPerWorkout)
          : fromSettings.maximumPerWorkout,
      ),
    ),
    preferredFocus: (Array.isArray(preferredFocus) ? preferredFocus : DEFAULT_ALTERNATIVE_EXERCISES_CONFIG.preferredFocus).filter(
      (focus): focus is AlternativeExercisesConfig["preferredFocus"][number] => typeof focus === "string",
    ),
    enabled: typeof fromWeeklyChallenge.enabled === "boolean" ? fromWeeklyChallenge.enabled : fromSettings.enabled,
  }
}

function prefersAlternativeFocus(
  video: Video,
  preferredFocus: AlternativeExercisesConfig["preferredFocus"],
): boolean {
  if (!preferredFocus.length) return false
  return preferredFocus.some((focus) => {
    switch (focus) {
      case "Lower Body":
        return isLowerBody(video)
      case "Core":
        return isCore(video)
      case "Functional Conditioning":
        return isFunctionalConditioning(video)
      case "Mobility":
        return isMobility(video)
      case "Low-Impact Options":
        return isLowImpact(video)
      default:
        return false
    }
  })
}

function isUpperPushTemplate(template: WeeklyTemplate | null): boolean {
  if (!template) return false
  const label = `${norm(template.label)} ${norm(template.workoutStyle)}`
  const primary = template.primaryMuscles.map(norm)
  const hasPushPrimary = primary.some((m) => m.includes("chest") || m.includes("tricep") || m.includes("shoulder"))
  return label.includes("upper push") || (hasPushPrimary && primary.length <= 3)
}

function applyAlternativeExercises(input: {
  rounds: GeneratedRound[]
  roundConfigsById: Map<number, RoundConfig>
  template: WeeklyTemplate | null
  settings: EngineInput["settings"]
  params?: BuilderParams
  videos: Video[]
  lastScheduledById: Record<number, string | null>
  limits: Record<string, number>
  usedEquipmentCounts: Record<string, number>
  usedVideoIds: Set<number>
  usedMovementPatterns: Set<MovementPatternCategory>
  now: Date
  mods: EngineModifiers
}): number {
  const {
    rounds,
    roundConfigsById,
    template,
    settings,
    params,
    videos,
    lastScheduledById,
    limits,
    usedEquipmentCounts,
    usedVideoIds,
    usedMovementPatterns,
    now,
    mods,
  } = input

  if (params?.dropsetWeek) return 0

  const alternatives = normaliseAlternativeSettings(settings)
  if (!alternatives.enabled || alternatives.maximumPerWorkout <= 0) return 0

  const chestHeavyRounds = rounds.filter((round) =>
    round.exercises.some((exercise) => !exercise.isAlternative && isPushDominant(exercise.video)),
  )
  const pushCount = chestHeavyRounds.length
  const pullCount = rounds.filter((round) =>
    round.exercises.some((exercise) => !exercise.isAlternative && !isPushDominant(exercise.video)),
  ).length

  let desired = 0
  if (pushCount >= 4) desired = 2
  else if (pushCount >= 3) desired = 1
  if (isUpperPushTemplate(template) && pushCount >= 2) desired = Math.max(desired, 1)
  if (pushCount - pullCount >= 3) desired = Math.max(desired, 1)
  desired = Math.min(desired, alternatives.maximumPerWorkout)
  if (desired <= 0) return 0

  const candidateRounds = rounds
    .filter((round) => !round.dropset && !round.isBoxingRound && round.exercises.length >= 2)
    .filter((round) => round.exercises.some((exercise) => !exercise.isAlternative && isPushDominant(exercise.video)))
    .sort((a, b) => b.score - a.score)

  let applied = 0
  for (const round of candidateRounds) {
    if (applied >= desired) break

    const cfg = roundConfigsById.get(round.roomId)
    if (!cfg) continue

    const main = round.exercises.find((exercise) => !exercise.isAlternative) ?? round.exercises[0]
    const replacementIndex = round.exercises.findIndex((exercise, index) => index > 0 && !exercise.isAlternative)
    if (!main || replacementIndex < 0) continue

    const replaced = round.exercises[replacementIndex]
    removeEquipmentUsage(usedEquipmentCounts, replaced.video)

    const pool = videos.filter((video) => {
      if (usedVideoIds.has(video.id)) return false
      if (video.id === main.videoId || video.id === replaced.videoId) return false
      if (!passesHardRules(video, cfg, limits, usedEquipmentCounts)) return false
      if (!passesSpaceRules(video, cfg)) return false
      if (round.glovesOn && !gloveCompatible(video)) return false
      if (!matchesTemplateMuscles(video, template, round.assignedRole, false)) return false
      return true
    })

    const scoredAlternatives = pool
      .map((video) => {
        const base = scoreCandidate(video, {
          cfg,
          template,
          reuseWeeks: settings.reuseWeeks,
          lastScheduledIso: lastScheduledById[video.id] ?? null,
          usedEquipmentCounts,
          usedMovementPatterns,
          mirrorDayMovementPatterns: new Set(),
          now,
          mods,
          targetHr: replaced.heartRate ?? videoHr(replaced.video),
          role: round.assignedRole,
        })

        let score = base.score
        if (isPushDominant(video)) score -= 35
        if (isPushDominant(replaced.video) && !isPushDominant(video)) score += 15
        if (prefersAlternativeFocus(video, alternatives.preferredFocus)) score += 25
        if (isLowerBody(video) || isCore(video) || isFunctionalConditioning(video) || isMobility(video) || isLowImpact(video)) {
          score += 10
        }
        const targetHr = replaced.heartRate ?? videoHr(replaced.video)
        const candidateHr = videoHr(video)
        if (targetHr && candidateHr && targetHr !== candidateHr) score -= 6

        return { ...base, score }
      })
      .sort((a, b) => b.score - a.score)

    const choice = scoredAlternatives[0]
    if (!choice || choice.score < 55) {
      addEquipmentUsage(usedEquipmentCounts, replaced.video)
      continue
    }

    const alternativeExercise = makeExercise(choice, replaced.heartRate ?? round.exercises[0]?.heartRate ?? null)
    alternativeExercise.isAlternative = true
    alternativeExercise.reasons = [
      "Optional alternative added to balance overall muscle volume",
      ...alternativeExercise.reasons,
    ]

    round.exercises[replacementIndex] = alternativeExercise
    round.reasons = [
      "Optional alternative added for member preference and balanced loading",
      ...round.reasons,
    ]

    const refreshed = refreshRoundDerivedFields(round)
    round.score = refreshed.score
    round.movementPatterns = refreshed.movementPatterns

    usedVideoIds.add(alternativeExercise.videoId)
    addEquipmentUsage(usedEquipmentCounts, alternativeExercise.video)
    for (const pattern of alternativeExercise.movementPatterns) usedMovementPatterns.add(pattern)
    applied++
  }

  return applied
}

// ---- main generator --------------------------------------------------------

function passesHardRules(
  video: Video,
  cfg: RoundConfig,
  limits: Record<string, number>,
  usedEquipmentCounts: Record<string, number>,
  options: { ignoreAllowed?: boolean; ignoreEquipmentLimits?: boolean } = {},
): boolean {
  if (cfg.coreOnly && !isCore(video)) return false

  const tokens = equipmentTokens(video)
  if (!options.ignoreAllowed && cfg.allowedEquipment.length) {
    const allowed = cfg.allowedEquipment.map(norm)
    if (!tokens.every((token) => allowed.includes(token))) return false
  }

  if (cfg.avoidEquipment.length) {
    const avoid = cfg.avoidEquipment.map(norm)
    if (tokens.some((token) => avoid.includes(token))) return false
  }

  if (!options.ignoreEquipmentLimits) {
    for (const token of tokens) {
      const max = limits[token]
      if (max != null && (usedEquipmentCounts[token] ?? 0) >= max) return false
    }
  }

  return true
}

function buildRoundWarnings(labels: string[]): string[] {
  return unique(labels.filter(Boolean))
}

function normaliseLockedRound(
  locked: GeneratedRound,
  cfg: RoundConfig,
  role: StationRole,
  targetHr: HeartRate,
): GeneratedRound {
  const exercises = locked.exercises.map((exercise) => ({
    ...exercise,
    isBoxing: exercise.isBoxing || isBoxingExercise(exercise.video),
    gloveCompatible: exercise.gloveCompatible ?? gloveCompatible(exercise.video),
    movementPatterns: exercise.movementPatterns?.length ? exercise.movementPatterns : classifyMovementPattern(exercise.video),
    heartRate: exercise.heartRate ?? targetHr,
  }))

  return {
    ...locked,
    roomId: cfg.roomId,
    roomNumber: roomNumberOf(cfg),
    roomName: cfg.stationName ?? locked.roomName ?? "Round",
    exercises,
    isBoxingRound: locked.isBoxingRound || role === "Boxing" || exercises.some((exercise) => exercise.isBoxing),
    glovesOn: locked.glovesOn || exercises.some((exercise) => exercise.isBoxing),
    locked: true,
    assignedRole: role,
    estimatedCalories: locked.estimatedCalories || estimateCalories(targetHr),
    movementPatterns: locked.movementPatterns?.length ? locked.movementPatterns : collectMovementPatterns(exercises),
    score: locked.score || recalculateRoundScore({ ...locked, exercises } as GeneratedRound),
  }
}

function buildEmptyRound(cfg: RoundConfig, role: StationRole, targetHr: HeartRate, warning: string): GeneratedRound {
  return {
    roomId: cfg.roomId,
    roomNumber: roomNumberOf(cfg),
    roomName: cfg.stationName ?? "Round",
    exercises: [],
    isBoxingRound: role === "Boxing",
    glovesOn: false,
    dropset: false,
    locked: false,
    score: 0,
    reasons: [],
    warnings: [warning],
    assignedRole: role,
    estimatedCalories: estimateCalories(targetHr),
    movementPatterns: [],
  }
}

function buildSummary(rounds: GeneratedRound[], template: WeeklyTemplate | null, settings: { reuseWeeks: number }, hrCurve: HeartRate[], estimatedCalories: number): string[] {
  const out: string[] = []
  const primary = template?.primaryMuscles?.length ? template.primaryMuscles.join(" + ") : null
  if (primary) {
    const label = template?.label ? `${template.label} — ` : ""
    out.push(`${label}Primary focus: ${primary}.`)
  } else if (template?.label) {
    out.push(`Built for ${template.label}.`)
  }

  const red = hrCurve.filter((zone) => zone === "red").length
  const boxing = rounds.filter((round) => round.isBoxingRound).length
  const hybrid = rounds.filter((round) => round.assignedRole === "Hybrid").length
  out.push(`${red} planned HR spike${red !== 1 ? "s" : ""} · ${boxing} boxing round${boxing !== 1 ? "s" : ""}${hybrid ? ` · ${hybrid} hybrid station${hybrid !== 1 ? "s" : ""}` : ""}.`)

  out.push(`Estimated burn ~${estimatedCalories} kcal across the 10-round curve.`)
  out.push(`No repeats within the last ${settings.reuseWeeks} weeks where possible.`)

  return out
}

const PUSH_PATTERNS = ["push", "press", "extend", "extension", "fly", "flye", "dip", "bench", "chest", "tricep", "shoulder press"]
const PULL_PATTERNS = ["pull", "row", "curl", "chin", "lat", "deadlift", "shrug", "rear delt", "bicep", "hamstring", "rdl", "hinge"]

function classifyPushPull(video: Video): "push" | "pull" | "other" {
  const text = videoText(video)
  const isPush = PUSH_PATTERNS.some((pattern) => text.includes(pattern))
  const isPull = PULL_PATTERNS.some((pattern) => text.includes(pattern))
  if (isPush && !isPull) return "push"
  if (isPull && !isPush) return "pull"
  if (isPush && isPull) {
    const pushScore = PUSH_PATTERNS.filter((pattern) => text.includes(pattern)).length
    const pullScore = PULL_PATTERNS.filter((pattern) => text.includes(pattern)).length
    return pushScore >= pullScore ? "push" : "pull"
  }
  return "other"
}

function buildMuscleBreakdown(rounds: GeneratedRound[]): MuscleBreakdown {
  let pushCount = 0
  let pullCount = 0
  const muscleCounts: Record<string, number> = {}

  for (const round of rounds) {
    for (const exercise of round.exercises) {
      const direction = classifyPushPull(exercise.video)
      if (direction === "push") pushCount++
      else if (direction === "pull") pullCount++

      const groups: string[] = []
      if (Array.isArray(exercise.video.muscleGroups) && exercise.video.muscleGroups.length > 0) {
        groups.push(...exercise.video.muscleGroups)
      } else {
        if (exercise.video.bodyPart) groups.push(exercise.video.bodyPart)
        if (exercise.video.secondaryMuscle) {
          groups.push(...exercise.video.secondaryMuscle.split(/[,/]/).map((value) => value.trim()))
        }
      }

      for (const group of groups) {
        const key = group.trim()
        if (key) muscleCounts[key] = (muscleCounts[key] ?? 0) + 1
      }
    }
  }

  const muscles = Object.entries(muscleCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([muscle]) => muscle)

  return { pushCount, pullCount, muscles }
}

export function generateWorkout(input: EngineInput): WorkoutDraft {
  const now = new Date(`${input.date}T12:00:00`)
  const {
    template,
    roundConfigs,
    equipmentLimits,
    settings,
    videos,
    lastScheduledById,
    lockedByRoomId = {},
    params,
  } = input

  const mods = resolveModifiers(params)
  const limits: Record<string, number> = {}
  for (const limit of equipmentLimits) limits[norm(limit.equipment)] = limit.maxStations

  const configs = [...roundConfigs].sort((a, b) => roomNumberOf(a) - roomNumberOf(b))
  const roundConfigsById = new Map(configs.map((cfg) => [cfg.roomId, cfg]))
  const spikeRoomNumbers = planHrSpikes(configs, input, mods)
  const rolesByRoomId = assignStationRoles(configs, spikeRoomNumbers, mods)
  const capabilitiesByRoomId = new Map(configs.map((cfg) => [cfg.roomId, resolveStationCapabilities(cfg)]))
  const targetHrByRoomId = new Map(
    configs.map((cfg) => [
      cfg.roomId,
      resolveTargetHr(
        rolesByRoomId.get(cfg.roomId) ?? "Conditioning",
        cfg,
        capabilitiesByRoomId.get(cfg.roomId) ?? resolveStationCapabilities(cfg),
        spikeRoomNumbers,
      ),
    ]),
  )

  const usedEquipmentCounts: Record<string, number> = {}
  const usedVideoIds = new Set<number>()
  const usedMovementPatterns = new Set<MovementPatternCategory>()
  const mirrorDayPatterns = normalisePatternSet(input.mirrorDayMovementPatterns)
  const rounds: GeneratedRound[] = []
  const warnings: string[] = []

  for (const cfg of configs) {
    const locked = lockedByRoomId[cfg.roomId]
    if (!locked?.exercises?.length) continue
    for (const exercise of locked.exercises) {
      usedVideoIds.add(exercise.videoId)
      addEquipmentUsage(usedEquipmentCounts, exercise.video)
      for (const pattern of exercise.movementPatterns?.length ? exercise.movementPatterns : classifyMovementPattern(exercise.video)) {
        usedMovementPatterns.add(pattern)
      }
    }
  }

  const commit = (video: Video, movementPatterns: MovementPatternCategory[]) => {
    usedVideoIds.add(video.id)
    addEquipmentUsage(usedEquipmentCounts, video)
    for (const pattern of movementPatterns) usedMovementPatterns.add(pattern)
  }

  const scoreAll = (pool: Video[], cfg: RoundConfig, role: StationRole, targetHr: HeartRate) =>
    pool
      .map((video) =>
        scoreCandidate(video, {
          cfg,
          template,
          reuseWeeks: settings.reuseWeeks,
          lastScheduledIso: lastScheduledById[video.id] ?? null,
          usedEquipmentCounts,
          usedMovementPatterns,
          mirrorDayMovementPatterns: mirrorDayPatterns,
          now,
          mods,
          targetHr,
          role,
        }),
      )
      .sort((a, b) => b.score - a.score)

  for (const cfg of configs) {
    const role = rolesByRoomId.get(cfg.roomId) ?? "Conditioning"
    const capabilities = capabilitiesByRoomId.get(cfg.roomId) ?? resolveStationCapabilities(cfg)
    const targetHr = targetHrByRoomId.get(cfg.roomId) ?? "orange"
    const locked = lockedByRoomId[cfg.roomId]

    if (locked) {
      rounds.push(normaliseLockedRound(locked, cfg, role, targetHr))
      continue
    }

    const roundWarnings: string[] = []
    const roomNumber = roomNumberOf(cfg)
    const isFunctionalSlot = mods.functionalFocused && mods.functionalRoomNumbers.has(roomNumber)

    const unused = (video: Video) => !usedVideoIds.has(video.id)

    const strictLeadPool = videos.filter((video) => {
      if (!unused(video)) return false
      if (!passesHardRules(video, cfg, limits, usedEquipmentCounts, { ignoreAllowed: role === "Boxing" })) return false
      if (!passesSpaceRules(video, cfg)) return false
      if (!matchesRoleLead(video, role)) return false
      if (!matchesTemplateMuscles(video, template, role, true)) return false
      if (isFunctionalSlot && !(isStrengthExercise(video) || isFunctionalConditioning(video))) return false
      return true
    })

    let leadPool = strictLeadPool
    if (leadPool.length === 0) {
      leadPool = videos.filter((video) => {
        if (!unused(video)) return false
        if (!passesHardRules(video, cfg, limits, usedEquipmentCounts, { ignoreAllowed: role === "Boxing" })) return false
        if (!passesSpaceRules(video, cfg)) return false
        if (!matchesRoleLead(video, role)) return false
        if (!matchesTemplateMuscles(video, template, role, false)) return false
        return true
      })
      if (leadPool.length) roundWarnings.push("Relaxed strict muscle-group validation to fill this round")
    }
    if (leadPool.length === 0) {
      leadPool = videos.filter((video) => {
        if (!unused(video)) return false
        if (!passesHardRules(video, cfg, limits, usedEquipmentCounts, { ignoreAllowed: role === "Boxing" })) return false
        if (!passesSpaceRules(video, cfg)) return false
        if (role === "Boxing") return isBoxingExercise(video) || hasBoxingEquipment(video)
        return matchesRoleLead(video, role) || matchesRoleLead(video, "Conditioning") || matchesRoleLead(video, "Strength")
      })
      if (leadPool.length) roundWarnings.push("Relaxed station-role matching to keep workout flow intact")
    }
    if (leadPool.length === 0) {
      leadPool = videos.filter((video) => {
        if (!unused(video)) return false
        if (!passesHardRules(video, cfg, limits, usedEquipmentCounts, { ignoreAllowed: role === "Boxing", ignoreEquipmentLimits: true })) return false
        if (!passesSpaceRules(video, cfg)) return false
        return role === "Boxing" ? isBoxingExercise(video) || hasBoxingEquipment(video) : true
      })
      if (leadPool.length) roundWarnings.push("Relaxed equipment limits to fill this round")
    }
    if (leadPool.length === 0) {
      leadPool = videos.filter(unused)
      if (leadPool.length) roundWarnings.push("No ideal exercise available — used best remaining video")
    }
    if (leadPool.length === 0) {
      rounds.push(buildEmptyRound(cfg, role, targetHr, "No available videos to fill this round"))
      warnings.push(`Round ${roomNumber} could not be filled`)
      continue
    }

    let scoredLead = scoreAll(leadPool, cfg, role, targetHr)
    if (role === "Boxing") {
      const boxingOnly = scoredLead.filter((candidate) => candidate.video && (hasBoxingEquipment(candidate.video) || isBoxingExercise(candidate.video)))
      if (boxingOnly.length) scoredLead = boxingOnly
    }

    const lead = scoredLead[0]
    const leadExercise = makeExercise(lead, targetHr)
    commit(lead.video, lead.movementPatterns)

    const exercises: RoundExercise[] = [leadExercise]
    const reasons = [
      `Assigned ${role} role with ${HR_LABEL[targetHr]} heart-rate target.`,
      ...leadExercise.reasons,
    ]

    const boxingRound = role === "Boxing" || leadExercise.isBoxing
    const glovesOn = boxingRound && leadExercise.isBoxing
    const dropset = Boolean(params?.dropsetWeek)

    if (dropset) {
      reasons.unshift("Dropset Week enabled — one exercise assigned for this room")
    } else {
      let secondPool = videos.filter((video) => {
        if (!unused(video)) return false
        if (!passesHardRules(video, cfg, limits, usedEquipmentCounts, { ignoreAllowed: boxingRound })) return false
        if (!passesSpaceRules(video, cfg)) return false
        if (!matchesTemplateMuscles(video, template, role, false)) return false
        if (!matchesRoleSecondary(video, role, lead.video, glovesOn)) return false
        if (isFunctionalSlot && !(isStrengthExercise(video) || isFunctionalConditioning(video) || isHiitExercise(video))) return false
        return true
      })

      if (secondPool.length === 0) {
        secondPool = videos.filter((video) => {
          if (!unused(video)) return false
          if (!passesHardRules(video, cfg, limits, usedEquipmentCounts, { ignoreAllowed: boxingRound, ignoreEquipmentLimits: true })) return false
          if (!passesSpaceRules(video, cfg)) return false
          if (glovesOn && !gloveCompatible(video)) return false
          return matchesRoleSecondary(video, role, lead.video, glovesOn) || matchesRoleSecondary(video, "Conditioning", lead.video, glovesOn)
        })
        if (secondPool.length) roundWarnings.push("Relaxed second-exercise pairing rules to complete the station")
      }

      if (secondPool.length > 0) {
        const scoredSecond = scoreAll(secondPool, cfg, role, targetHr)
          .map((candidate) => ({
            ...candidate,
            score: Math.max(0, Math.min(100, candidate.score + pairingBonus(lead.video, candidate.video, role, targetHr))),
          }))
          .sort((a, b) => b.score - a.score)

        const second = scoredSecond[0]
        if (second) {
          const secondExercise = makeExercise(second, targetHr)
          if (glovesOn) secondExercise.reasons.unshift("Glove-compatible — safe to perform with boxing gloves on")
          if (detectHybridOpportunity({ role, cfg, targetHr, leadExercise: lead.video })) {
            secondExercise.reasons.unshift("Chosen as the HIIT side of a strength + spike hybrid pairing")
          }
          exercises.push(secondExercise)
          commit(second.video, second.movementPatterns)
        }
      } else if (boxingRound && glovesOn) {
        roundWarnings.push("Kept as a single boxing block — gloves limit the second exercise")
      } else {
        roundWarnings.push("Only one exercise available for this round")
      }
    }

    const round: GeneratedRound = {
      roomId: cfg.roomId,
      roomNumber: roomNumber,
      roomName: cfg.stationName ?? "Round",
      exercises,
      isBoxingRound: boxingRound,
      glovesOn,
      dropset,
      locked: false,
      score: Math.round(exercises.reduce((sum, exercise) => sum + exercise.score, 0) / exercises.length),
      reasons,
      warnings: buildRoundWarnings(roundWarnings),
      assignedRole: role,
      estimatedCalories: estimateCalories(targetHr),
      movementPatterns: collectMovementPatterns(exercises),
    }

    if (role === "Hybrid" && exercises.length >= 2) {
      round.reasons.unshift("Built as a hybrid station pairing strength with a heart-rate driver.")
    }
    if (spikeRoomNumbers.has(roomNumber) && targetHr === "red") {
      round.reasons.unshift("Placed intentionally on the workout heart-rate spike curve.")
    }
    if (capabilities.supportsFinisher && boxingRound) {
      round.reasons.unshift("Reserved as the workout finisher with the highest planned intensity.")
    }

    rounds.push(round)
  }

  applyAlternativeExercises({
    rounds,
    roundConfigsById,
    template,
    settings,
    params,
    videos,
    lastScheduledById,
    limits,
    usedEquipmentCounts,
    usedVideoIds,
    usedMovementPatterns,
    now,
    mods,
  })

  const filled = rounds.filter((round) => round.exercises.length > 0)
  const hrCurve = rounds.map((round) => {
    const existing = round.exercises.find((exercise) => exercise.heartRate)?.heartRate
    return existing ?? targetHrByRoomId.get(round.roomId) ?? "orange"
  })
  const estimatedCalories = hrCurve.reduce((sum, hr) => sum + estimateCalories(hr), 0)
  const overall = filled.length ? Math.round(filled.reduce((sum, round) => sum + round.score, 0) / filled.length) : 0
  const muscleBreakdown = buildMuscleBreakdown(rounds)
  const summary = buildSummary(rounds, template, settings, hrCurve, estimatedCalories)

  for (const round of rounds) {
    if (round.warnings.length > 0) warnings.push(...round.warnings)
  }

  return {
    date: input.date,
    weekday: input.weekday,
    label: template?.label ?? null,
    rounds,
    score: overall,
    summary,
    muscleBreakdown,
    warnings: unique(warnings),
    hrCurve,
    estimatedCalories,
  }
}
