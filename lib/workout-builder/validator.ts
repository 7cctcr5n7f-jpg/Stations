import type {
  WeeklyTemplate,
  WeeklyValidationReport,
  WeeklyValidationCategory,
  WorkoutDraft,
  HeartRate,
  MovementPatternCategory,
} from "./types"

// ---- helpers ---------------------------------------------------------------

function makeCategory(score: number, label: string, notes: string[]): WeeklyValidationCategory {
  return { score: Math.max(0, Math.min(100, Math.round(score))), label, notes }
}

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase()
}

// ---- individual scoring dimensions -----------------------------------------

function scoreMuscleAccuracy(days: WorkoutDraft[], templates: (WeeklyTemplate | null)[]): WeeklyValidationCategory {
  const notes: string[] = []
  let total = 0
  let matched = 0

  for (let i = 0; i < days.length; i++) {
    const template = templates[i]
    if (!template || (!template.primaryMuscles.length && !template.secondaryMuscles.length)) continue
    const targetMuscles = [...template.primaryMuscles, ...template.secondaryMuscles].map(norm)

    for (const round of days[i].rounds) {
      for (const ex of round.exercises) {
        if (ex.isAlternative) continue
        // Boxing/HIIT spike/Core stations are exempt from muscle validation
        if (round.assignedRole === "Boxing" || round.assignedRole === "HIIT Spike" || round.assignedRole === "Core") continue

        total++
        const muscles = (ex.video.muscleGroups ?? []).map(norm)
        const bodyPart = norm(ex.video.bodyPart)
        const allMuscles = [...muscles, bodyPart].filter(Boolean)

        const hit = targetMuscles.some((t) => allMuscles.some((m) => m.includes(t) || t.includes(m)))
        if (hit) matched++
        else {
          notes.push(`${days[i].label ?? `Day ${i + 1}`}: ${ex.video.title} doesn't target configured muscles`)
        }
      }
    }
  }

  const score = total > 0 ? (matched / total) * 100 : 100
  if (notes.length > 5) {
    const extra = notes.length - 5
    notes.length = 5
    notes.push(`...and ${extra} more`)
  }
  return makeCategory(score, "Muscle Accuracy", notes)
}

function scoreEquipmentBalance(days: WorkoutDraft[]): WeeklyValidationCategory {
  const notes: string[] = []
  const equipmentUsage: Record<string, number> = {}

  for (const day of days) {
    for (const round of day.rounds) {
      for (const ex of round.exercises) {
        if (ex.isAlternative) continue
        const eq = norm(ex.video.equipment)
        if (eq) equipmentUsage[eq] = (equipmentUsage[eq] ?? 0) + 1
      }
    }
  }

  const entries = Object.entries(equipmentUsage).sort((a, b) => b[1] - a[1])
  const totalExercises = entries.reduce((sum, [, c]) => sum + c, 0)
  const uniqueEquipment = entries.length

  // Penalise if any single equipment is > 30% of all exercises
  let penalty = 0
  for (const [eq, count] of entries) {
    const pct = (count / totalExercises) * 100
    if (pct > 30) {
      penalty += (pct - 30) * 0.5
      notes.push(`${eq} used ${count} times (${Math.round(pct)}%) — consider more variety`)
    }
  }

  // Bonus for equipment variety (more unique equipment = better)
  const varietyBonus = Math.min(10, uniqueEquipment * 0.5)
  const score = 100 - penalty + varietyBonus
  return makeCategory(score, "Equipment Balance", notes)
}

function scoreStationCompatibility(days: WorkoutDraft[]): WeeklyValidationCategory {
  const notes: string[] = []
  let total = 0
  let compatible = 0

  for (const day of days) {
    for (const round of day.rounds) {
      for (const ex of round.exercises) {
        if (ex.isAlternative) continue
        total++
        // If the round has warnings about equipment relaxation, it's less compatible
        const hasRelaxation = round.warnings.some((w) =>
          w.toLowerCase().includes("relaxed") || w.toLowerCase().includes("no matching"),
        )
        if (!hasRelaxation) compatible++
        else notes.push(`${day.label ?? day.date} Room ${round.roomNumber}: station limits relaxed`)
      }
    }
  }

  const score = total > 0 ? (compatible / total) * 100 : 100
  if (notes.length > 3) {
    const extra = notes.length - 3
    notes.length = 3
    notes.push(`...and ${extra} more`)
  }
  return makeCategory(score, "Station Compatibility", notes)
}

function scoreExerciseVariety(days: WorkoutDraft[]): WeeklyValidationCategory {
  const notes: string[] = []
  const allVideoIds = new Set<number>()
  let totalExercises = 0

  for (const day of days) {
    for (const round of day.rounds) {
      for (const ex of round.exercises) {
        if (ex.isAlternative) continue
        totalExercises++
        allVideoIds.add(ex.videoId)
      }
    }
  }

  const uniqueRatio = totalExercises > 0 ? allVideoIds.size / totalExercises : 1
  const score = uniqueRatio * 100

  if (uniqueRatio < 0.95) {
    const repeats = totalExercises - allVideoIds.size
    notes.push(`${repeats} repeated exercise(s) across the week`)
  }
  if (uniqueRatio >= 0.98) notes.push("Excellent variety — almost no repeats")

  return makeCategory(score, "Exercise Variety", notes)
}

function scoreHeartRateDistribution(days: WorkoutDraft[]): WeeklyValidationCategory {
  const notes: string[] = []
  let dayScore = 0

  for (const day of days) {
    const curve = day.hrCurve
    const redCount = curve.filter((hr) => hr === "red").length
    const orangeCount = curve.filter((hr) => hr === "orange").length
    const greenCount = curve.filter((hr) => hr === "green").length

    // Target: 3-5 red/high spikes per day
    if (redCount >= 3 && redCount <= 5) {
      dayScore += 100
    } else if (redCount >= 2 && redCount <= 6) {
      dayScore += 85
      notes.push(`${day.label ?? day.date}: ${redCount} HR spikes (target 3-5)`)
    } else {
      dayScore += 60
      notes.push(`${day.label ?? day.date}: only ${redCount} HR spikes — needs more intensity variation`)
    }

    // Penalise if all rounds are the same zone
    if (greenCount === curve.length || redCount === curve.length) {
      dayScore -= 20
      notes.push(`${day.label ?? day.date}: No HR variation — all rounds same zone`)
    }
  }

  const score = days.length > 0 ? dayScore / days.length : 100
  return makeCategory(score, "Heart Rate Distribution", notes)
}

function scoreBoxingExperience(days: WorkoutDraft[]): WeeklyValidationCategory {
  const notes: string[] = []
  let dayScore = 0

  for (const day of days) {
    const boxingRounds = day.rounds.filter((r) => r.isBoxingRound)
    const boxingCount = boxingRounds.length

    // Target: 3-4 boxing rounds per day (rooms 4, 5, 7, 10 by default)
    if (boxingCount >= 3 && boxingCount <= 4) {
      dayScore += 100
    } else if (boxingCount >= 2) {
      dayScore += 80
      notes.push(`${day.label ?? day.date}: only ${boxingCount} boxing rounds (target 3-4)`)
    } else {
      dayScore += 50
      notes.push(`${day.label ?? day.date}: ${boxingCount} boxing rounds — not enough boxing identity`)
    }
  }

  const score = days.length > 0 ? dayScore / days.length : 100
  return makeCategory(score, "Boxing Experience", notes)
}

function scoreMovementPatternBalance(days: WorkoutDraft[]): WeeklyValidationCategory {
  const notes: string[] = []

  // Check mirror day variation (Mon/Thu, Tue/Fri, Wed/Sat)
  const mirrorPairs: [number, number][] = [[0, 3], [1, 4], [2, 5]]
  let pairsChecked = 0
  let pairsGood = 0

  for (const [a, b] of mirrorPairs) {
    if (a >= days.length || b >= days.length) continue
    pairsChecked++

    const patternsA = new Set<MovementPatternCategory>()
    const patternsB = new Set<MovementPatternCategory>()

    for (const round of days[a].rounds) {
      for (const p of round.movementPatterns) patternsA.add(p)
    }
    for (const round of days[b].rounds) {
      for (const p of round.movementPatterns) patternsB.add(p)
    }

    // Calculate overlap percentage
    let overlap = 0
    for (const p of patternsA) {
      if (patternsB.has(p)) overlap++
    }
    const totalUnique = new Set([...patternsA, ...patternsB]).size
    const overlapPct = totalUnique > 0 ? (overlap / totalUnique) * 100 : 0

    if (overlapPct <= 40) pairsGood++
    else {
      notes.push(
        `${days[a].label ?? `Day ${a + 1}`} / ${days[b].label ?? `Day ${b + 1}`}: ${Math.round(overlapPct)}% pattern overlap (target ≤40%)`,
      )
    }
  }

  const score = pairsChecked > 0 ? (pairsGood / pairsChecked) * 60 + 40 : 100
  if (pairsGood === pairsChecked && pairsChecked > 0) {
    notes.push("Good variation between mirror days")
  }
  return makeCategory(score, "Movement Pattern Balance", notes)
}

function scoreRecoveryBalance(days: WorkoutDraft[]): WeeklyValidationCategory {
  const notes: string[] = []
  let dayScore = 0

  for (const day of days) {
    // Check that there's at least one recovery/core station and no more than 2 red spikes in a row
    const hasRecovery = day.rounds.some((r) => r.assignedRole === "Recovery" || r.assignedRole === "Core")
    if (!hasRecovery) {
      dayScore += 70
      notes.push(`${day.label ?? day.date}: No dedicated recovery station`)
    } else {
      dayScore += 100
    }

    // Check for consecutive high-intensity rounds
    let maxConsecutiveRed = 0
    let currentStreak = 0
    for (const hr of day.hrCurve) {
      if (hr === "red") {
        currentStreak++
        maxConsecutiveRed = Math.max(maxConsecutiveRed, currentStreak)
      } else {
        currentStreak = 0
      }
    }
    if (maxConsecutiveRed > 2) {
      dayScore -= 10
      notes.push(`${day.label ?? day.date}: ${maxConsecutiveRed} consecutive high-intensity rounds — risk of burnout`)
    }
  }

  const score = days.length > 0 ? dayScore / days.length : 100
  return makeCategory(score, "Recovery Balance", notes)
}

// ---- public ----------------------------------------------------------------

/**
 * Validate an entire generated week and produce a quality report.
 * Every category scored 0-100; overall is a weighted average.
 * Caller should regenerate affected stations if any category < 90.
 */
export function validateWeek(
  days: WorkoutDraft[],
  templates: (WeeklyTemplate | null)[],
): WeeklyValidationReport {
  const muscleAccuracy = scoreMuscleAccuracy(days, templates)
  const equipmentBalance = scoreEquipmentBalance(days)
  const stationCompatibility = scoreStationCompatibility(days)
  const exerciseVariety = scoreExerciseVariety(days)
  const heartRateDistribution = scoreHeartRateDistribution(days)
  const boxingExperience = scoreBoxingExperience(days)
  const movementPatternBalance = scoreMovementPatternBalance(days)
  const recoveryBalance = scoreRecoveryBalance(days)

  // Weighted average — weights reflect the programming philosophy priority order
  const weights = {
    muscleAccuracy: 20,
    equipmentBalance: 10,
    stationCompatibility: 10,
    exerciseVariety: 15,
    heartRateDistribution: 18,
    boxingExperience: 12,
    movementPatternBalance: 8,
    recoveryBalance: 7,
  }
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0)
  const overall = Math.round(
    (muscleAccuracy.score * weights.muscleAccuracy +
      equipmentBalance.score * weights.equipmentBalance +
      stationCompatibility.score * weights.stationCompatibility +
      exerciseVariety.score * weights.exerciseVariety +
      heartRateDistribution.score * weights.heartRateDistribution +
      boxingExperience.score * weights.boxingExperience +
      movementPatternBalance.score * weights.movementPatternBalance +
      recoveryBalance.score * weights.recoveryBalance) /
      totalWeight,
  )

  const categories = [
    muscleAccuracy, equipmentBalance, stationCompatibility, exerciseVariety,
    heartRateDistribution, boxingExperience, movementPatternBalance, recoveryBalance,
  ]
  const passesThreshold = categories.every((c) => c.score >= 90)

  const recommendations: string[] = []
  for (const cat of categories) {
    if (cat.score < 90) {
      recommendations.push(`Improve ${cat.label} (${cat.score}%) — ${cat.notes[0] ?? "review affected stations"}`)
    }
  }
  if (passesThreshold) recommendations.push("All categories pass quality threshold — ready to publish.")

  return {
    muscleAccuracy,
    equipmentBalance,
    stationCompatibility,
    exerciseVariety,
    heartRateDistribution,
    boxingExperience,
    movementPatternBalance,
    recoveryBalance,
    overall,
    recommendations,
    passesThreshold,
  }
}
