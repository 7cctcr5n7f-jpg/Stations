import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import {
  getChowRoomIdForWeek,
  getWeekStartIso,
  getWeeklyChallengeSettings,
  setChowRoomIdForWeek,
  syncChowWeek,
} from "@/lib/chow"
import { broadcastScheduleChange } from "@/app/api/schedules/sse/route"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const date = searchParams.get("date")
    if (!date) {
      return NextResponse.json({ message: "date is required" }, { status: 400 })
    }

    const weekStart = getWeekStartIso(date)
    const settings = await getWeeklyChallengeSettings()
    const roomId = getChowRoomIdForWeek(settings, weekStart)

    return NextResponse.json({ weekStart, roomId })
  } catch (error) {
    console.error("[chow] Failed to load CHOW settings:", error)
    return NextResponse.json({ message: "Failed to load CHOW settings" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as { date?: string; weekStart?: string; roomId?: number | null }
    const referenceDate = body.weekStart ?? body.date
    if (!referenceDate) {
      return NextResponse.json({ message: "date or weekStart is required" }, { status: 400 })
    }

    const weekStart = body.weekStart ?? getWeekStartIso(referenceDate)
    const roomId = body.roomId == null ? null : Number(body.roomId)

    if (roomId !== null) {
      if (!Number.isFinite(roomId) || roomId <= 0) {
        return NextResponse.json({ message: "roomId must be a positive number or null" }, { status: 400 })
      }

      const roomRows = await sql`SELECT id FROM rooms WHERE id = ${roomId}`
      if (roomRows.length === 0) {
        return NextResponse.json({ message: "Room not found" }, { status: 404 })
      }

      const sourceRows = await sql`
        SELECT id
        FROM schedules
        WHERE room_id = ${roomId} AND schedule_date = ${weekStart}
        ORDER BY position ASC, id ASC
        LIMIT 1
      `
      if (sourceRows.length === 0) {
        return NextResponse.json(
          { message: "Assign the CHOW exercise to the first day of the week before selecting a CHOW room" },
          { status: 400 },
        )
      }
    }

    await setChowRoomIdForWeek(weekStart, roomId)

    if (roomId === null) {
      return NextResponse.json({ weekStart, roomId: null })
    }

    const syncResult = await syncChowWeek(weekStart, roomId)
    for (const date of syncResult.syncedDates) {
      broadcastScheduleChange(roomId, { type: "schedule_published", roomId, date })
    }

    return NextResponse.json({
      weekStart,
      roomId,
      syncedDates: syncResult.syncedDates,
      cleared: syncResult.cleared,
    })
  } catch (error) {
    console.error("[chow] Failed to update CHOW settings:", error)
    return NextResponse.json({ message: "Failed to update CHOW settings" }, { status: 500 })
  }
}
