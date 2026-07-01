export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { type NextRequest, NextResponse } from "next/server"
import { sql, mapRoom } from "@/lib/db"
import {
  getAllWeeklyTemplates,
  getRoundConfigs,
  getEquipmentLimits,
  getSettings,
} from "@/lib/workout-builder/db"

// GET all builder configuration in one payload.
export async function GET() {
  try {
    const [templates, roundConfigs, equipmentLimits, settings, roomRows] = await Promise.all([
      getAllWeeklyTemplates(),
      getRoundConfigs(),
      getEquipmentLimits(),
      getSettings(),
      sql`SELECT * FROM rooms ORDER BY number`,
    ])
    return NextResponse.json({
      templates,
      roundConfigs,
      equipmentLimits,
      settings,
      rooms: roomRows.map(mapRoom),
    })
  } catch (error) {
    console.error("[v0] Failed to load builder config:", error)
    return NextResponse.json({ message: "Failed to load config" }, { status: 500 })
  }
}

// PUT saves one config section at a time: { section, data }
export async function PUT(request: NextRequest) {
  try {
    const { section, data } = await request.json()

    switch (section) {
      case "template": {
        const t = data
        await sql`
          INSERT INTO wb_weekly_templates
            (weekday, label, primary_muscles, secondary_muscles, workout_style, goals, updated_at)
          VALUES
            (${t.weekday}, ${t.label ?? null}, ${t.primaryMuscles ?? []}, ${t.secondaryMuscles ?? []},
             ${t.workoutStyle ?? null}, ${JSON.stringify(t.goals ?? {})}, now())
          ON CONFLICT (weekday) DO UPDATE SET
            label = EXCLUDED.label,
            primary_muscles = EXCLUDED.primary_muscles,
            secondary_muscles = EXCLUDED.secondary_muscles,
            workout_style = EXCLUDED.workout_style,
            goals = EXCLUDED.goals,
            updated_at = now()
        `
        break
      }
      case "roundConfig": {
        const c = data
        await sql`
          INSERT INTO wb_round_config
            (room_id, station_name, station_role, preferred_equipment, allowed_equipment, avoid_equipment,
             preferred_categories, preferred_heart_rate, preferred_intensity, available_space, core_only, updated_at)
          VALUES
            (${c.roomId}, ${c.stationName ?? null}, ${c.stationRole ?? null}, ${c.preferredEquipment ?? []},
             ${c.allowedEquipment ?? []}, ${c.avoidEquipment ?? []}, ${c.preferredCategories ?? []},
             ${c.preferredHeartRate ?? null}, ${c.preferredIntensity ?? null}, ${c.availableSpace ?? null},
             ${c.coreOnly ?? false}, now())
          ON CONFLICT (room_id) DO UPDATE SET
            station_name = EXCLUDED.station_name,
            station_role = EXCLUDED.station_role,
            preferred_equipment = EXCLUDED.preferred_equipment,
            allowed_equipment = EXCLUDED.allowed_equipment,
            avoid_equipment = EXCLUDED.avoid_equipment,
            preferred_categories = EXCLUDED.preferred_categories,
            preferred_heart_rate = EXCLUDED.preferred_heart_rate,
            preferred_intensity = EXCLUDED.preferred_intensity,
            available_space = EXCLUDED.available_space,
            core_only = EXCLUDED.core_only,
            updated_at = now()
        `
        break
      }
      case "equipmentLimits": {
        // data is the full list — replace all
        const limits = data as { equipment: string; maxStations: number }[]
        await sql`DELETE FROM wb_equipment_limits`
        for (const l of limits) {
          if (!l.equipment) continue
          await sql`
            INSERT INTO wb_equipment_limits (equipment, max_stations, updated_at)
            VALUES (${l.equipment}, ${l.maxStations}, now())
            ON CONFLICT (equipment) DO UPDATE SET max_stations = EXCLUDED.max_stations, updated_at = now()
          `
        }
        break
      }
      case "settings": {
        const s = data
        await sql`
          UPDATE wb_settings SET
            reuse_weeks = ${s.reuseWeeks},
            min_score = ${s.minScore},
            auto_regen = ${s.autoRegen},
            weekly_challenge = ${JSON.stringify(s.weeklyChallenge ?? {})},
            updated_at = now()
          WHERE id = 1
        `
        break
      }
      default:
        return NextResponse.json({ message: "Unknown config section" }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[v0] Failed to save builder config:", error)
    return NextResponse.json({ message: "Failed to save config" }, { status: 500 })
  }
}
