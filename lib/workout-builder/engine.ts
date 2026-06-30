import type { Video } from "@/lib/shared/schema"
import type {
  EngineInput,
  GeneratedRound,
  HeartRate,
  Intensity,
  RoundConfig,
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
function muscleTokens(v: Video): string[] {
  const out: string[] = []
  if (v.bodyPart) out.push(norm(v.bodyPart))
  if (v.secondaryMuscle) {
    for (const m of v.secondaryMuscle.split(/[,/]/)) {
      const t = norm(m)
      if (t) out.push(t)
    }
  }
  return out
}

function isCore(v: Video): boolean {
  const tokens = [norm(v.bodyPart), norm(v.exerciseType), ...muscleTokens(v)]
  return tokens.some((t) => t.includes("core") || t.includes("abs") || t.includes("oblique"))
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
      reasons.push(`Targets today's primary muscle group (${video.bodyPart})`)
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

// ---- candidate filtering (hard rules) --------------------------------------

function passesHardRules(video: Video, cfg: RoundConfig, limits: Record<string, number>, usedEquipmentCounts: Record<string, number>): boolean {
  // Core-only stations
  if (cfg.coreOnly && !isCore(video)) return false

  const tokens = equipmentTokens(video)

  // Allowed equipment whitelist (if set, video must use only allowed)
  if (cfg.allowedEquipment.length) {
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
    if (locked?.video) {
      usedVideoIds.add(locked.video.id)
      for (const t of equipmentTokens(locked.video)) {
        usedEquipmentCounts[t] = (usedEquipmentCounts[t] ?? 0) + 1
      }
    }
  }

  for (const cfg of configs) {
    const locked = lockedByRoomId[cfg.roomId]
    if (locked) {
      rounds.push({ ...locked, locked: true })
      continue
    }

    // Build candidate pool
    let candidates = videos.filter(
      (v) => !usedVideoIds.has(v.id) && passesHardRules(v, cfg, limits, usedEquipmentCounts),
    )

    const roundWarnings: string[] = []

    // Relaxation ladder if nothing matched
    if (candidates.length === 0) {
      // relax equipment limits
      candidates = videos.filter(
        (v) => !usedVideoIds.has(v.id) && (!cfg.coreOnly || isCore(v)),
      )
      if (candidates.length) roundWarnings.push("Relaxed equipment limits to fill this round")
    }
    if (candidates.length === 0) {
      // last resort: any unused video
      candidates = videos.filter((v) => !usedVideoIds.has(v.id))
      if (candidates.length) roundWarnings.push("No matching exercise — used any available video")
    }

    if (candidates.length === 0) {
      rounds.push({
        roomId: cfg.roomId,
        roomNumber: 0,
        roomName: cfg.stationName ?? `Round`,
        videoId: null,
        video: null,
        heartRate: cfg.preferredHeartRate ?? null,
        reps: null,
        locked: false,
        score: 0,
        reasons: [],
        warnings: ["No available videos to fill this round"],
      })
      warnings.push(`Round (room ${cfg.roomId}) could not be filled`)
      continue
    }

    // Score all candidates
    const scored = candidates
      .map((v) =>
        scoreCandidate(
          v,
          cfg,
          template,
          settings.reuseWeeks,
          lastScheduledById[v.id] ?? null,
          usedEquipmentCounts,
          now,
        ),
      )
      .sort((a, b) => b.score - a.score)

    const best = scored[0]
    usedVideoIds.add(best.video.id)
    for (const t of equipmentTokens(best.video)) {
      usedEquipmentCounts[t] = (usedEquipmentCounts[t] ?? 0) + 1
    }

    const desiredHr =
      cfg.preferredHeartRate ??
      (cfg.preferredIntensity
        ? INTENSITY_TO_HR[cfg.preferredIntensity]
        : best.video.intensity
          ? INTENSITY_TO_HR[best.video.intensity as Intensity]
          : null)

    rounds.push({
      roomId: cfg.roomId,
      roomNumber: 0,
      roomName: cfg.stationName ?? "Round",
      videoId: best.video.id,
      video: best.video,
      heartRate: desiredHr,
      reps: null,
      locked: false,
      score: best.score,
      reasons: best.reasons,
      warnings: roundWarnings,
    })
  }

  // Overall score = average of filled rounds
  const filled = rounds.filter((r) => r.video)
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
  for (const r of rounds) if (r.heartRate) hrCounts[r.heartRate]++
  out.push(`Heart-rate spread — Low: ${hrCounts.green}, Medium: ${hrCounts.orange}, High: ${hrCounts.red}.`)
  out.push(`No exercise repeats within the last ${settings.reuseWeeks} weeks where possible.`)
  return out
}
