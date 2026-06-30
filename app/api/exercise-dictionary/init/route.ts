import { type NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/exercise-dictionary/init
 * Idempotent: creates the exercise_dictionary table if it doesn't exist,
 * then seeds it with studio-specific abbreviations and terms.
 * Safe to call multiple times — uses INSERT … ON CONFLICT DO NOTHING.
 */
export async function POST(_req: NextRequest) {
  try {
    // 1. Create table
    await sql`
      CREATE TABLE IF NOT EXISTS exercise_dictionary (
        id          SERIAL PRIMARY KEY,
        alias       TEXT NOT NULL,
        canonical   TEXT NOT NULL,
        category    TEXT NOT NULL,
        tags        TEXT[] DEFAULT '{}',
        notes       TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `

    // 2. Unique index on lower-cased alias so lookups are case-insensitive
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_exercise_dictionary_alias
        ON exercise_dictionary (lower(alias))
    `

    // 3. Seed known studio abbreviations
    const seed: { alias: string; canonical: string; category: string; tags: string[]; notes: string }[] = [
      // ── Boxing punches ────────────────────────────────────────────────────────
      { alias: "HK",           canonical: "Hook",               category: "Punch",      tags: ["boxing","striking"],           notes: "Lead or rear hook punch" },
      { alias: "UC",           canonical: "Uppercut",           category: "Punch",      tags: ["boxing","striking"],           notes: "" },
      { alias: "JAB",          canonical: "Jab",                category: "Punch",      tags: ["boxing","striking"],           notes: "Lead hand straight punch" },
      { alias: "CROSS",        canonical: "Cross",              category: "Punch",      tags: ["boxing","striking"],           notes: "Rear hand straight punch" },
      { alias: "BH",           canonical: "Body Hook",          category: "Punch",      tags: ["boxing","striking","body"],    notes: "Hook aimed at the body" },
      { alias: "BU",           canonical: "Body Uppercut",      category: "Punch",      tags: ["boxing","striking","body"],    notes: "" },
      { alias: "OH",           canonical: "Overhand",           category: "Punch",      tags: ["boxing","striking"],           notes: "Looping punch over guard" },
      { alias: "SLIP",         canonical: "Slip",               category: "Defence",    tags: ["boxing","defence"],            notes: "Head movement to avoid a punch" },
      { alias: "ROLL",         canonical: "Roll",               category: "Defence",    tags: ["boxing","defence"],            notes: "Rolling under a punch" },
      { alias: "PAD",          canonical: "Pad Work",           category: "BoxingDrill",tags: ["boxing","pads"],               notes: "Drill using focus mitts / thai pads" },

      // ── Equipment abbreviations ───────────────────────────────────────────────
      { alias: "DB",           canonical: "Dumbbell",           category: "Equipment",  tags: ["weights","free-weights"],      notes: "" },
      { alias: "KB",           canonical: "Kettlebell",         category: "Equipment",  tags: ["weights","free-weights"],      notes: "" },
      { alias: "BB",           canonical: "Barbell",            category: "Equipment",  tags: ["weights","free-weights"],      notes: "" },
      { alias: "MB",           canonical: "Medicine Ball",      category: "Equipment",  tags: ["ball","throwing"],             notes: "" },
      { alias: "S-BALL",       canonical: "Slam Ball",          category: "Equipment",  tags: ["ball","slamming"],             notes: "Heavy dead-bounce ball for slams" },
      { alias: "SBALL",        canonical: "Slam Ball",          category: "Equipment",  tags: ["ball","slamming"],             notes: "" },
      { alias: "SLAM",         canonical: "Slam Ball",          category: "Equipment",  tags: ["ball","slamming"],             notes: "Context-dependent — usually the equipment" },
      { alias: "BOSU",         canonical: "BOSU Ball",          category: "Equipment",  tags: ["balance","instability"],       notes: "Both Sides Up balance trainer" },
      { alias: "TRX",          canonical: "TRX",                category: "Equipment",  tags: ["suspension","bodyweight"],     notes: "Suspension trainer system" },
      { alias: "BAND",         canonical: "Resistance Band",    category: "Equipment",  tags: ["resistance","band"],           notes: "" },
      { alias: "STEP",         canonical: "Step Platform",      category: "Equipment",  tags: ["platform","cardio"],           notes: "Aerobic step box" },
      { alias: "BOX",          canonical: "Plyo Box",           category: "Equipment",  tags: ["plyometric","platform"],       notes: "" },
      { alias: "ROPE",         canonical: "Battle Rope",        category: "Equipment",  tags: ["conditioning","arms"],         notes: "" },
      { alias: "BR",           canonical: "Battle Rope",        category: "Equipment",  tags: ["conditioning","arms"],         notes: "" },
      { alias: "BODY",         canonical: "Bodyweight",         category: "Equipment",  tags: ["no-equipment"],                notes: "No equipment required" },

      // ── Exercise type shorthands ──────────────────────────────────────────────
      { alias: "HIIT",         canonical: "HIIT",               category: "Category",   tags: ["cardio","high-intensity"],     notes: "High Intensity Interval Training" },
      { alias: "EMOM",         canonical: "EMOM",               category: "Format",     tags: ["interval"],                    notes: "Every Minute On the Minute" },
      { alias: "AMRAP",        canonical: "AMRAP",              category: "Format",     tags: ["interval"],                    notes: "As Many Rounds As Possible" },
      { alias: "TABATA",       canonical: "Tabata",             category: "Format",     tags: ["interval","cardio"],           notes: "20s work / 10s rest protocol" },
      { alias: "RDL",          canonical: "Romanian Deadlift",  category: "Exercise",   tags: ["hinge","posterior-chain"],     notes: "" },
      { alias: "SDR",          canonical: "Sumo Deadlift Row",  category: "Exercise",   tags: ["pull","compound"],             notes: "" },
      { alias: "SDLHP",        canonical: "Sumo Deadlift High Pull", category: "Exercise", tags: ["pull","compound"],          notes: "" },
      { alias: "L&R",          canonical: "Left and Right",     category: "Modifier",   tags: ["bilateral"],                   notes: "Perform on both sides" },
      { alias: "ALT",          canonical: "Alternating",        category: "Modifier",   tags: ["bilateral","alternating"],     notes: "" },
    ]

    let inserted = 0
    for (const row of seed) {
      const result = await sql`
        INSERT INTO exercise_dictionary (alias, canonical, category, tags, notes)
        VALUES (${row.alias}, ${row.canonical}, ${row.category}, ${row.tags}, ${row.notes})
        ON CONFLICT (lower(alias)) DO NOTHING
        RETURNING id
      `
      if (result.length > 0) inserted++
    }

    return NextResponse.json({ ok: true, message: `Table ready. Inserted ${inserted} new seed entries.` })
  } catch (error: any) {
    console.error("[v0] exercise-dictionary/init error:", error?.message)
    return NextResponse.json({ error: error?.message ?? "Init failed" }, { status: 500 })
  }
}
