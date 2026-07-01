import type { Video } from "@/lib/shared/schema"
import type {
  BuilderParams,
  EngineInput,
  GeneratedRound,
  HeartRate,
  Intensity,
  MuscleBreakdown,
  RoundConfig,
  RoundExercise,
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

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase()
}

// Split a comma/space separated equipment string into normalized tokens.
function equipmentTokens(v: Video): string[] {
  return norm(v.equipment)
    .split(/[,/]/)
    .map((t) => t.trim())
    .filter(Boolean)
}

// All muscle-ish text for a video, lowercased, for matching against templates.
// Uses the new muscleGroups array first; falls back to legacy bodyPart/secondaryMuscle
// for any un-migrated rows.
function muscleTokens(v: Video): string[] {
  const out: string[] = []
  // Prefer the new canonical array of muscle groups
  if (Array.isArray(v.muscleGroups) && v.muscleGroups.length > 0) {
    for (const m of v.muscleGroups) {
      const t = norm(m)
      if (t) out.push(t)
    }
  } else {
    // Legacy fallback
    if (v.bodyPart) out.push(norm(v.bodyPart))
    if (v.secondaryMuscle) {
      for (const m of v.secondaryMuscle.split(/[,/]/)) {
        const t = norm(m)
        if (t) out.push(t)
      }
    }
  }
  return out
}

// The category field is the single workout bucket for filtering.
// Falls back to bodyPart for legacy rows.
function exerciseCategory(v: Video): string {
  return norm(v.category) || norm(v.bodyPart)
}

function isCore(v: Video): boolean {
  const tokens = [exerciseCategory(v), norm(v.exerciseType), ...muscleTokens(v)]
  return tokens.some((t) => t.includes("core") || t.includes("abs") || t.includes("oblique"))
}

// Default room numbers that are boxing stations (gloves on).
export const BOXING_ROUND_NUMBERS = [4, 5, 7, 10]

function isBoxingRound(cfg: RoundConfig): boolean {
  if (cfg.roomNumber != null && BOXING_ROUND_NUMBERS.includes(cfg.roomNumber)) return true
  const role = norm(cfg.stationRole) + " " + norm(cfg.stationName)
  if (role.includes("box")) return true
  if (cfg.preferredCategories.some((c) => norm(c).includes("box"))) return true
  return false
}

// Does this video use dedicated boxing equipment (BOXING gloves, W.BAG, pads)?
// These are the videos that belong at the boxing stations.
function hasBoxingEquipment(v: Video): boolean {
  const tokens = equipmentTokens(v)
  return tokens.some((t) => t.includes("boxing") || t.includes("w.bag") || t === "bag" || t.includes("pad"))
}

// Is this exercise a boxing/striking movement?
function isBoxingExercise(v: Video): boolean {
  if (hasBoxingEquipment(v)) return true
  if (v.boxingType && norm(v.boxingType)) return true
  const text = [norm(v.exerciseType), norm(v.movementPattern), exerciseCategory(v), norm(v.equipment)].join(" ")
  return /box|punch|jab|cross|hook|uppercut|strik|bag|pad|spar/.test(text)
}

// Equipment that requires gripping/fine hand use — impossible with boxing gloves on.
const GRIP_EQUIPMENT = [
  "db", "dumbbell", "dumbbells", "bb", "barbell", "kb", "kettlebell", "cable",
  "r.tube", "tube", "band", "resistance band", "b-rope", "battle rope", "rope",
  "jump rope", "trx", "plate", "bar", "ez bar", "ez-bar", "med ball", "medicine ball",
  "slam ball", "wall ball", "landmine", "rack",
]

// Can this exercise be performed while wearing boxing gloves?
function gloveCompatible(v: Video): boolean {
  // Boxing exercises are done with gloves by definition.
  if (isBoxingExercise(v)) return true
  const tokens = equipmentTokens(v)
  // No equipment / bodyweight is always fine.
  if (tokens.length === 0) return true
  // Compatible only if NONE of the equipment requires hand grip.
  return !tokens.some((t) => GRIP_EQUIPMENT.some((g) => t === g || t.includes(g)))
}

// Isolation muscle groups that suit a single-movement dropset.
const ISOLATION_MUSCLES = [
  "bicep", "tricep", "calf", "calves", "forearm", "shoulder", "delt",
  "lateral", "rear delt", "abductor", "adductor", "hamstring", "quad", "glute",
]

// Equipment tokens that imply adjustable/descending load (dropset-friendly).
const WEIGHTED_EQUIPMENT = ["db", "dumbbell", "dumbbells", "cable", "machine", "bb", "barbell", "kb", "kettlebell", "plate"]

function isWeighted(v: Video): boolean {
  if (v.weightRequired) return true
  const tokens = equipmentTokens(v)
  return tokens.some((t) => WEIGHTED_EQUIPMENT.some((w) => t === w || t.includes(w)))
}

// Should the engine propose a single-exercise dropset for this pick?
// Dropsets suit weighted isolation strength moves at low/medium intensity.
function isDropsetCandidate(v: Video, cfg: RoundConfig, isBoxing: boolean): boolean {
  if (isBoxing || cfg.coreOnly) return false
  if (!isWeighted(v)) return false
  if (v.intensity === "High") return false
  const et = norm(v.exerciseType)
  if (et && !et.includes("strength") && !et.includes("hypertrophy")) return false
  const muscles = [exerciseCategory(v), ...muscleTokens(v)]
  return muscles.some((m) => ISOLATION_MUSCLES.some((iso) => m.includes(iso)))
}

function daysSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (isNaN(then)) return null
  return Math.floor((now.getTime() - then) / (1000 * 60 * 60 * 24))
}

// ---- params-derived modifiers ----------------------------------------------

interface EngineModifiers {
  /** Fraction 0–1 representing HIIT weight (1 = full HIIT bias). */
  hiitBias: number
  /** Boxing Focused: ALL boxing rounds use only boxing exercises (no second exercise from other cats). */
  boxingFocused: boolean
  /** HIIT Focused: cardio/body exercises scored higher; boxing rounds kept but other rounds are HIIT. */
  hiitFocused: boolean
  /** Functional Fitness: rounds 2, 3, 6, 9 (by room number) stay weight/functional training. */
  functionalFocused: boolean
  /** Balanced: mix of HIIT, boxing and functional. No overrides. */
  balanced: boolean
  /** Intensity override. */
  intensityOverride: HeartRate | null
  /** Boxing volume fraction 0–1. */
  boxingVolumeFraction: number
  /**
   * Functional Fitness mode: set of room numbers that must be weight/functional.
   * Empty when not in Functional Fitness focus.
   */
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

  const focus = params.focus
  return {
    hiitBias: params.hiitStrengthRatio / 100,
    boxingFocused: focus === "Boxing Focused",
    hiitFocused: focus === "HIIT Focused",
    functionalFocused: focus === "Functional Fitness",
    balanced: focus === "Balanced",
    intensityOverride: null,
    boxingVolumeFraction: params.boxingVolume / 100,
    // Rooms 2, 3, 6, 9 are reserved for weight/functional training in Functional Fitness mode
    functionalRoomNumbers: focus === "Functional Fitness" ? new Set([2, 3, 6, 9]) : new Set(),
  }
}

// ---- scoring ---------------------------------------------------------------

interface ScoredCandidate {
  video: Video
  score: number
  reasons: string[]
}

// Weighting for each scoring dimension (sums to 100 baseline).
const W = {
  templateMuscle: 30,
  rotationFreshness: 25,
  equipmentPref: 15,
  intensityFit: 15,
  category: 10,
  variety: 5,
}

function scoreCandidate(
  video: Video,
  cfg: RoundConfig,
  template: WeeklyTemplate | null,
  reuseWeeks: number,
  lastScheduledIso: string | null,
  usedEquipmentCounts: Record<string, number>,
  now: Date,
  mods: EngineModifiers,
): ScoredCandidate {
  const reasons: string[] = []
  let score = 0

  const cat = exerciseCategory(video)
  const isHiit = cat.includes("hiit") || norm(video.exerciseType).includes("hiit") || norm(video.exerciseType).includes("cardio")
  const isStrength = cat.includes("chest") || cat.includes("back") || cat.includes("shoulder") ||
    cat.includes("bicep") || cat.includes("tricep") || cat.includes("legs") || cat.includes("arm") ||
    norm(video.exerciseType).includes("strength") || norm(video.exerciseType).includes("hypertrophy")
  const isBoxingEx = isBoxingExercise(video)
  const isFunctional = norm(video.movementPattern).includes("functional") || norm(video.exerciseType).includes("functional")

  // 1) Template muscle match
  if (template && (template.primaryMuscles.length || template.secondaryMuscles.length)) {
    const mt = muscleTokens(video)
    const primaryHit = template.primaryMuscles.some((m) => mt.some((t) => t.includes(norm(m)) || norm(m).includes(t)))
    const secondaryHit = template.secondaryMuscles.some((m) => mt.some((t) => t.includes(norm(m)) || norm(m).includes(t)))
    if (primaryHit) {
      score += W.templateMuscle
      reasons.push(`Targets today's primary muscle group (${video.category || video.bodyPart})`)
    } else if (secondaryHit) {
      score += W.templateMuscle * 0.5
      reasons.push(`Hits a secondary muscle group for today`)
    }
  } else {
    score += W.templateMuscle * 0.4
  }

  // 2) Rotation freshness (reuseWeeks window)
  const windowDays = reuseWeeks * 7
  const since = daysSince(lastScheduledIso, now)
  if (since === null) {
    score += W.rotationFreshness
    reasons.push("Never scheduled before — fresh for members")
  } else if (since >= windowDays) {
    score += W.rotationFreshness
    reasons.push(`Last used ${since}d ago (outside ${reuseWeeks}-week rotation)`)
  } else {
    const frac = since / windowDays
    score += W.rotationFreshness * frac
    reasons.push(`Used ${since}d ago — partially fresh`)
  }

  // 3) Equipment preference / allow / avoid
  const tokens = equipmentTokens(video)
  const pref = cfg.preferredEquipment.map(norm)
  const avoid = cfg.avoidEquipment.map(norm)
  if (avoid.length && tokens.some((t) => avoid.includes(t))) {
    score -= W.equipmentPref
    reasons.push("Uses avoided equipment")
  } else if (pref.length && tokens.some((t) => pref.includes(t))) {
    score += W.equipmentPref
    reasons.push(`Uses preferred equipment for this station`)
  } else {
    score += W.equipmentPref * 0.5
  }

  // 4) Intensity / heart-rate fit — builder difficulty can override per-station preference
  const desiredHr =
    mods.intensityOverride ??
    cfg.preferredHeartRate ??
    (cfg.preferredIntensity ? INTENSITY_TO_HR[cfg.preferredIntensity] : null)
  if (desiredHr && video.intensity) {
    const videoHr = INTENSITY_TO_HR[video.intensity as Intensity]
    if (videoHr === desiredHr) {
      score += W.intensityFit
      reasons.push(`Matches target heart-rate zone (${HR_LABEL[desiredHr]})`)
    } else {
      score += W.intensityFit * 0.3
    }
  } else {
    score += W.intensityFit * 0.5
  }

  // 5) Category / exercise-type preference
  if (cfg.preferredCategories.length) {
    const cats = cfg.preferredCategories.map(norm)
    const vt = [norm(video.exerciseType), norm(video.movementPattern), norm(video.boxingType)]
    if (vt.some((t) => t && cats.includes(t))) {
      score += W.category
      reasons.push("Matches preferred station category")
    }
  } else {
    score += W.category * 0.5
  }

  // 6) Variety — penalize equipment already heavily used in this workout
  const overused = tokens.filter((t) => (usedEquipmentCounts[t] ?? 0) > 0)
  if (overused.length === 0) {
    score += W.variety
  } else {
    score += W.variety * 0.4
  }

  // 7) Builder params bonus/penalty — layered on top of the base score

  // HIIT Focused: boost cardio/body exercises; penalise pure strength on non-boxing rounds
  if (mods.hiitFocused) {
    if (isHiit) {
      score += 10
      reasons.push("Fits HIIT-focused programme")
    } else if (isStrength && !isBoxingEx) {
      score -= 5
    }
  }

  // Boxing Focused: strong bonus for boxing exercises on any round
  if (mods.boxingFocused && isBoxingEx) {
    score += 10
    reasons.push("Boxing-focused programme")
  }

  // Functional Fitness: boost functional/weight exercises on functional rooms
  if (mods.functionalFocused && isFunctional) {
    score += 8
    reasons.push("Functional Fitness programme")
  }

  // Balanced: gentle HIIT bias
  if (mods.balanced && isHiit && mods.hiitBias > 0.5) {
    score += Math.round((mods.hiitBias - 0.5) * 12)
  }

  // Clamp 0-100
  score = Math.max(0, Math.min(100, Math.round(score)))
  return { video, score, reasons }
}

/** Derive sensible default reps for an exercise based on its category and methods. */
function defaultReps(video: Video): string {
  const methods = (video.workoutMethods ?? []).map((m) => m.toLowerCase())
  if (methods.includes("amrap")) return "AMRAP"
  if (methods.includes("dropset")) return "Dropset"

  const cat = norm(video.category ?? "")
  const type = norm(video.exerciseType ?? "")
  const isBoxing = isBoxingExercise(video)
  const isSuperSet = methods.includes("superset")

  // Boxing: short combos (≤3 moves based on title) need many more rounds
  // than long combination sequences. We detect short combos by looking at
  // how many punch-type words appear in the title/boxingType.
  if (isBoxing) {
    const comboText = ((video.title ?? "") + " " + (video.boxingType ?? "")).toLowerCase()
    const PUNCH_WORDS = ["jab", "cross", "hook", "uppercut", "left", "right", "1", "2", "3", "4", "5", "6"]
    const punchCount = PUNCH_WORDS.filter((w) => comboText.includes(w)).length
    const isShortCombo = punchCount <= 3
    return isShortCombo ? "10-20 rounds" : "5 rounds min"
  }

  // Conditioning / HIIT — usually time or AMRAP
  if (cat === "hiit" || type === "hiit" || type === "conditioning") return "AMRAP"

  // Core / Abs — higher rep range
  if (cat === "core" || cat === "abs") return "20"

  // Strength / hypertrophy categories — standard rep range
  if (["chest", "back", "shoulders", "arms", "biceps", "triceps", "legs"].includes(cat)) {
    return isSuperSet ? "10-12" : "12"
  }

  // Default fallback
  return "10"
}

// Build a RoundExercise from a scored candidate.
function makeExercise(sc: ScoredCandidate, cfg: RoundConfig): RoundExercise {
  const hr =
    cfg.preferredHeartRate ??
    (cfg.preferredIntensity
      ? INTENSITY_TO_HR[cfg.preferredIntensity]
      : sc.video.intensity
        ? INTENSITY_TO_HR[sc.video.intensity as Intensity]
        : null)
  return {
    videoId: sc.video.id,
    video: sc.video,
    heartRate: hr,
    reps: defaultReps(sc.video),
    score: sc.score,
    reasons: [...sc.reasons],
    warnings: [],
    isBoxing: isBoxingExercise(sc.video),
    gloveCompatible: gloveCompatible(sc.video),
  }
}

// ---- candidate filtering (hard rules) --------------------------------------

function passesHardRules(
  video: Video,
  cfg: RoundConfig,
  limits: Record<string, number>,
  usedEquipmentCounts: Record<string, number>,
  ignoreAllowed = false,
): boolean {
  // Core-only stations
  if (cfg.coreOnly && !isCore(video)) return false

  const tokens = equipmentTokens(video)

  // Allowed equipment whitelist (if set, video must use only allowed).
  // Skipped for the lead boxing exercise — a boxing station must use boxing
  // equipment even if a whitelist was set for the secondary movement.
  if (!ignoreAllowed && cfg.allowedEquipment.length) {
    const allowed = cfg.allowedEquipment.map(norm)
    if (!tokens.every((t) => allowed.includes(t))) return false
  }

  // Avoided equipment
  if (cfg.avoidEquipment.length) {
    const avoid = cfg.avoidEquipment.map(norm)
    if (tokens.some((t) => avoid.includes(t))) return false
  }

  // Equipment station limits — would adding this exceed the max?
  for (const t of tokens) {
    const max = limits[t]
    if (max != null && (usedEquipmentCounts[t] ?? 0) >= max) return false
  }

  return true
}

// ---- main generator --------------------------------------------------------

export function generateWorkout(input: EngineInput): WorkoutDraft {
  const now = new Date(input.date + "T12:00:00")
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
  for (const l of equipmentLimits) limits[norm(l.equipment)] = l.maxStations

  // Sort round configs by room number so generation flows round 1..N
  const configs = [...roundConfigs].sort((a, b) => a.roomId - b.roomId)

  const usedEquipmentCounts: Record<string, number> = {}
  const usedVideoIds = new Set<number>()
  const rounds: GeneratedRound[] = []
  const warnings: string[] = []

  // Seed counts/usage from locked rounds first
  for (const cfg of configs) {
    const locked = lockedByRoomId[cfg.roomId]
    if (locked?.exercises?.length) {
      for (const ex of locked.exercises) {
        usedVideoIds.add(ex.videoId)
        for (const t of equipmentTokens(ex.video)) {
          usedEquipmentCounts[t] = (usedEquipmentCounts[t] ?? 0) + 1
        }
      }
    }
  }

  const commit = (v: Video) => {
    usedVideoIds.add(v.id)
    for (const t of equipmentTokens(v)) {
      usedEquipmentCounts[t] = (usedEquipmentCounts[t] ?? 0) + 1
    }
  }

  for (const cfg of configs) {
    const locked = lockedByRoomId[cfg.roomId]
    if (locked) {
      rounds.push({ ...locked, locked: true })
      continue
    }

    const boxingRound = isBoxingRound(cfg)
    const roundWarnings: string[] = []

    // Determine whether this room number is a "functional/weight" slot in Functional Fitness mode
    const isFunctionalSlot = mods.functionalFocused && mods.functionalRoomNumbers.has(cfg.roomNumber ?? 0)

    const scoreAll = (pool: Video[]) =>
      pool
        .map((v) =>
          scoreCandidate(v, cfg, template, settings.reuseWeeks, lastScheduledById[v.id] ?? null, usedEquipmentCounts, now, mods),
        )
        .sort((a, b) => b.score - a.score)

    // ---- pick exercise 1 (with relaxation ladder) ----
    let pool1 = videos.filter((v) => !usedVideoIds.has(v.id) && passesHardRules(v, cfg, limits, usedEquipmentCounts))

    // Boxing Focused: all boxing rounds use only boxing exercises
    if (mods.boxingFocused && boxingRound) {
      const boxingOnly = pool1.filter((v) => isBoxingExercise(v) || hasBoxingEquipment(v))
      if (boxingOnly.length) pool1 = boxingOnly
    }

    // Functional Fitness: rooms 2, 3, 6, 9 must use weight/functional exercises
    if (isFunctionalSlot) {
      const functionalOnly = pool1.filter((v) => {
        const t = norm(v.exerciseType ?? "")
        const mp = norm(v.movementPattern ?? "")
        return (
          t.includes("strength") || t.includes("hypertrophy") || t.includes("functional") ||
          mp.includes("functional") || mp.includes("push") || mp.includes("pull") ||
          mp.includes("hinge") || mp.includes("squat") || mp.includes("press") ||
          norm(v.category ?? "").includes("chest") || norm(v.category ?? "").includes("back") ||
          norm(v.category ?? "").includes("legs") || norm(v.category ?? "").includes("shoulder") ||
          norm(v.category ?? "").includes("arms") || norm(v.category ?? "").includes("bicep") ||
          norm(v.category ?? "").includes("tricep")
        )
      })
      if (functionalOnly.length) pool1 = functionalOnly
      else roundWarnings.push("Functional slot — no weight/functional exercise available, used best available")
    }

    if (pool1.length === 0) {
      pool1 = videos.filter((v) => !usedVideoIds.has(v.id) && (!cfg.coreOnly || isCore(v)))
      if (pool1.length) roundWarnings.push("Relaxed equipment limits to fill this round")
    }
    if (pool1.length === 0) {
      pool1 = videos.filter((v) => !usedVideoIds.has(v.id))
      if (pool1.length) roundWarnings.push("No matching exercise — used any available video")
    }
    if (pool1.length === 0) {
      rounds.push({
        roomId: cfg.roomId, roomNumber: 0, roomName: cfg.stationName ?? "Round",
        exercises: [], isBoxingRound: boxingRound, glovesOn: false, dropset: false,
        locked: false, score: 0, reasons: [], warnings: ["No available videos to fill this round"],
      })
      warnings.push(`Round (room ${cfg.roomId}) could not be filled`)
      continue
    }

    let scored1 = scoreAll(pool1)
    // Boxing stations should use videos tagged with boxing equipment
    // (BOXING gloves / W.BAG / pads) for the lead exercise. Build a dedicated
    // pool of unused boxing-equipment videos, bypassing the allowed-equipment
    // whitelist (which may have been set for the secondary movement). Only fall
    // back to a generic boxing-style movement, then any candidate, if none exist.
    if (boxingRound) {
      const boxingPool = videos.filter(
        (v) =>
          !usedVideoIds.has(v.id) &&
          hasBoxingEquipment(v) &&
          passesHardRules(v, cfg, limits, usedEquipmentCounts, /* ignoreAllowed */ true),
      )
      if (boxingPool.length) {
        scored1 = scoreAll(boxingPool)
      } else {
        const boxers = scored1.filter((s) => isBoxingExercise(s.video))
        if (boxers.length) scored1 = boxers
        roundWarnings.push("No boxing-equipment video available — used closest boxing-style movement")
      }
    }
    const ex1 = makeExercise(scored1[0], cfg)
    commit(ex1.video)
    const exercises: RoundExercise[] = [ex1]
    const reasons: string[] = [...ex1.reasons]

    const glovesOn = boxingRound && ex1.isBoxing

    // ---- structure: dropset (single movement) vs two exercises ----
    const dropset = isDropsetCandidate(ex1.video, cfg, boxingRound)
    if (dropset) {
      reasons.unshift("Dropset proposed — one movement taken to failure with descending weight")
    } else {
      // Pick a complementary second exercise. Default is two per station.
      let pool2 = videos.filter((v) => !usedVideoIds.has(v.id) && passesHardRules(v, cfg, limits, usedEquipmentCounts))

      // Boxing Focused: on boxing rounds the second exercise must also be boxing
      if (mods.boxingFocused && boxingRound) {
        const boxingPool2 = pool2.filter((v) => isBoxingExercise(v) || hasBoxingEquipment(v))
        if (boxingPool2.length) pool2 = boxingPool2
      }

      // Functional Fitness: functional slots enforce weight/functional for ex2 as well
      if (isFunctionalSlot) {
        const functionalOnly2 = pool2.filter((v) => {
          const t = norm(v.exerciseType ?? "")
          const mp = norm(v.movementPattern ?? "")
          return (
            t.includes("strength") || t.includes("hypertrophy") || t.includes("functional") ||
            mp.includes("functional") || mp.includes("push") || mp.includes("pull") ||
            mp.includes("hinge") || mp.includes("squat") || mp.includes("press")
          )
        })
        if (functionalOnly2.length) pool2 = functionalOnly2
      }

      // Gloves on => the second exercise must be performable with gloves.
      if (glovesOn) pool2 = pool2.filter((v) => gloveCompatible(v))
      else if (pool2.length === 0) {
        pool2 = videos.filter((v) => !usedVideoIds.has(v.id) && (!cfg.coreOnly || isCore(v)))
      }

      const scored2 = scoreAll(pool2)
      if (scored2.length) {
        const candidate2 = scored2[0]
        // On boxing rounds the second exercise is optional — only add it when it
        // is a decent fit; otherwise leave the round as a single boxing block.
        const threshold = boxingRound ? 45 : 0
        if (candidate2.score >= threshold) {
          const ex2 = makeExercise(candidate2, cfg)
          commit(ex2.video)
          if (glovesOn) ex2.reasons.unshift("Glove-compatible — safe to perform with boxing gloves on")
          exercises.push(ex2)
          reasons.push(ex2.reasons[0])
        } else if (boxingRound) {
          roundWarnings.push("Kept as a single boxing block — no strong glove-friendly second exercise")
        }
      } else if (boxingRound && glovesOn) {
        roundWarnings.push("Kept as a single boxing block — gloves limit the second exercise")
      } else {
        roundWarnings.push("Only one exercise available for this round")
      }
    }

    const roundScore = Math.round(exercises.reduce((s, e) => s + e.score, 0) / exercises.length)

    rounds.push({
      roomId: cfg.roomId, roomNumber: 0, roomName: cfg.stationName ?? "Round",
      exercises, isBoxingRound: boxingRound, glovesOn, dropset,
      locked: false, score: roundScore, reasons, warnings: roundWarnings,
    })
  }

  // Overall score = average of filled rounds
  const filled = rounds.filter((r) => r.exercises.length > 0)
  const overall = filled.length
    ? Math.round(filled.reduce((s, r) => s + r.score, 0) / filled.length)
    : 0

  const summary = buildSummary(rounds, template, settings)
  const muscleBreakdown = buildMuscleBreakdown(rounds)

  return {
    date: input.date,
    weekday: input.weekday,
    label: template?.label ?? null,
    rounds,
    score: overall,
    summary,
    muscleBreakdown,
    warnings,
  }
}

// Keywords that classify a movement as push or pull from the movementPattern / exerciseType fields.
const PUSH_PATTERNS = ["push", "press", "extend", "extension", "fly", "flye", "dip", "bench", "chest", "tricep", "shoulder press"]
const PULL_PATTERNS = ["pull", "row", "curl", "chin", "lat", "deadlift", "shrug", "rear delt", "bicep", "hamstring", "rdl", "hinge"]

function classifyPushPull(v: Video): "push" | "pull" | "other" {
  const text = [
    norm(v.movementPattern ?? ""),
    norm(v.exerciseType ?? ""),
    norm(v.category ?? ""),
    norm(v.bodyPart ?? ""),
    norm(v.title ?? ""),
  ].join(" ")
  const isPush = PUSH_PATTERNS.some((p) => text.includes(p))
  const isPull = PULL_PATTERNS.some((p) => text.includes(p))
  if (isPush && !isPull) return "push"
  if (isPull && !isPush) return "pull"
  if (isPush && isPull) {
    // compound — assign to the more specific pattern match
    const pushScore = PUSH_PATTERNS.filter((p) => text.includes(p)).length
    const pullScore = PULL_PATTERNS.filter((p) => text.includes(p)).length
    return pushScore >= pullScore ? "push" : "pull"
  }
  return "other"
}

function buildMuscleBreakdown(rounds: GeneratedRound[]): MuscleBreakdown {
  let pushCount = 0
  let pullCount = 0
  const muscleCounts: Record<string, number> = {}

  for (const r of rounds) {
    for (const ex of r.exercises) {
      const dir = classifyPushPull(ex.video)
      if (dir === "push") pushCount++
      else if (dir === "pull") pullCount++

      // Collect all muscleGroups (canonical array), fall back to bodyPart + secondaryMuscle
      const groups: string[] = []
      if (Array.isArray(ex.video.muscleGroups) && ex.video.muscleGroups.length > 0) {
        groups.push(...ex.video.muscleGroups)
      } else {
        if (ex.video.bodyPart) groups.push(ex.video.bodyPart)
        if (ex.video.secondaryMuscle) {
          groups.push(...ex.video.secondaryMuscle.split(/[,/]/).map((s) => s.trim()))
        }
      }
      for (const g of groups) {
        const key = g.trim()
        if (key) muscleCounts[key] = (muscleCounts[key] ?? 0) + 1
      }
    }
  }

  // Sort muscles by frequency (most-worked first), deduplicated
  const muscles = Object.entries(muscleCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([m]) => m)

  return { pushCount, pullCount, muscles }
}

function buildSummary(rounds: GeneratedRound[], template: WeeklyTemplate | null, settings: { reuseWeeks: number }): string[] {
  const out: string[] = []

  // Line 1 — primary focus + any other categories present
  const allCategories: string[] = []
  for (const r of rounds) {
    for (const e of r.exercises) {
      const cat = exerciseCategory(e.video)
      if (cat) allCategories.push(cat)
    }
  }
  const catCounts: Record<string, number> = {}
  for (const c of allCategories) catCounts[c] = (catCounts[c] ?? 0) + 1

  const primary = template?.primaryMuscles?.length
    ? template.primaryMuscles.join(" + ")
    : null
  const otherCats = Object.entries(catCounts)
    .filter(([c]) => {
      if (!primary) return false
      return !primary.toLowerCase().includes(c.toLowerCase())
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([c]) => c)

  if (primary) {
    const label = template?.label ? `${template.label} — ` : ""
    out.push(
      otherCats.length
        ? `${label}Primary focus: ${primary}. Also includes: ${otherCats.join(", ")}.`
        : `${label}Primary focus: ${primary}.`,
    )
  } else if (template?.label) {
    out.push(`Built for ${template.label}.`)
  }

  // Line 2 — HIIT exercise count
  let hiitCount = 0
  for (const r of rounds) {
    for (const e of r.exercises) {
      const cat = exerciseCategory(e.video)
      const type = norm(e.video.exerciseType)
      if (cat === "hiit" || type === "hiit" || type === "conditioning" || e.heartRate === "red") {
        hiitCount++
      }
    }
  }
  const dropsets = rounds.filter((r) => r.dropset).length
  const boxing = rounds.filter((r) => r.isBoxingRound).length
  const parts: string[] = []
  if (hiitCount > 0) parts.push(`${hiitCount} HIIT exercise${hiitCount !== 1 ? "s" : ""}`)
  if (dropsets > 0) parts.push(`${dropsets} dropset${dropsets !== 1 ? "s" : ""}`)
  if (boxing > 0) parts.push(`${boxing} boxing round${boxing !== 1 ? "s" : ""}`)
  if (parts.length) out.push(parts.join(" · ") + ".")

  // Line 3 — rotation / no-repeat guarantee
  out.push(`No repeats within the last ${settings.reuseWeeks} weeks where possible.`)

  return out
}
