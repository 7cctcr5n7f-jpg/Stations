import type { Video } from "@/lib/shared/schema"
import type {
  EngineInput,
  GeneratedRound,
  HeartRate,
  Intensity,
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
): ScoredCandidate {
  const reasons: string[] = []
  let score = 0

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
    // No template -> neutral credit so generation still works
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
    // Linearly penalize recency inside the window
    const frac = since / windowDays
    score += W.rotationFreshness * frac
    reasons.push(`Used ${since}d ago — partially fresh`)
  }

  // 3) Equipment preference / allow / avoid
  const tokens = equipmentTokens(video)
  const pref = cfg.preferredEquipment.map(norm)
  const avoid = cfg.avoidEquipment.map(norm)
  if (avoid.length && tokens.some((t) => avoid.includes(t))) {
    score -= W.equipmentPref // strong negative; usually filtered out earlier
    reasons.push("Uses avoided equipment")
  } else if (pref.length && tokens.some((t) => pref.includes(t))) {
    score += W.equipmentPref
    reasons.push(`Uses preferred equipment for this station`)
  } else {
    score += W.equipmentPref * 0.5
  }

  // 4) Intensity / heart-rate fit
  const desiredHr = cfg.preferredHeartRate ?? (cfg.preferredIntensity ? INTENSITY_TO_HR[cfg.preferredIntensity] : null)
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

  // Clamp 0-100
  score = Math.max(0, Math.min(100, Math.round(score)))
  return { video, score, reasons }
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
    reps: null,
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
  } = input

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

    const scoreAll = (pool: Video[]) =>
      pool
        .map((v) =>
          scoreCandidate(v, cfg, template, settings.reuseWeeks, lastScheduledById[v.id] ?? null, usedEquipmentCounts, now),
        )
        .sort((a, b) => b.score - a.score)

    // ---- pick exercise 1 (with relaxation ladder) ----
    let pool1 = videos.filter((v) => !usedVideoIds.has(v.id) && passesHardRules(v, cfg, limits, usedEquipmentCounts))
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

  return {
    date: input.date,
    weekday: input.weekday,
    label: template?.label ?? null,
    rounds,
    score: overall,
    summary,
    warnings,
  }
}

function buildSummary(rounds: GeneratedRound[], template: WeeklyTemplate | null, settings: { reuseWeeks: number }): string[] {
  const out: string[] = []
  if (template?.label) out.push(`Built for ${template.label}.`)
  if (template?.primaryMuscles?.length) {
    out.push(`Primary focus: ${template.primaryMuscles.join(", ")}.`)
  }
  const hrCounts = { green: 0, orange: 0, red: 0 } as Record<HeartRate, number>
  let exerciseCount = 0
  for (const r of rounds) {
    for (const e of r.exercises) {
      exerciseCount++
      if (e.heartRate) hrCounts[e.heartRate]++
    }
  }
  const dropsets = rounds.filter((r) => r.dropset).length
  const boxing = rounds.filter((r) => r.isBoxingRound).length
  out.push(
    `${rounds.length} rounds · ${exerciseCount} exercises (2 per station by default${dropsets ? `, ${dropsets} dropset${dropsets > 1 ? "s" : ""}` : ""}).`,
  )
  if (boxing) {
    out.push(`${boxing} boxing stations — gloves stay on, so any second exercise is glove-compatible.`)
  }
  out.push(`Heart-rate spread — Low: ${hrCounts.green}, Medium: ${hrCounts.orange}, High: ${hrCounts.red}.`)
  out.push(`No exercise repeats within the last ${settings.reuseWeeks} weeks where possible.`)
  return out
}
