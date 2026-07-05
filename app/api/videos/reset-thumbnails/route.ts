import { sql } from "@vercel/postgres"
import { NextResponse } from "next/server"

export async function POST() {
  try {
    console.log("[reset-thumbnails] Starting reset of all thumbnail URLs...")
    
    // Reset ALL thumbnail URLs to NULL so they can be regenerated
    const result = await sql`
      UPDATE videos
      SET thumbnail_url = NULL
      WHERE thumbnail_url IS NOT NULL AND thumbnail_url != ''
    `
    
    const clearedCount = result.rowCount || 0
    console.log(`[reset-thumbnails] Reset ${clearedCount} thumbnail URLs to NULL`)
    
    return NextResponse.json({ 
      success: true,
      clearedCount,
      message: `Reset ${clearedCount} thumbnails. Click "Generate Thumbnails" to regenerate them all with proper R2 URLs.`
    })
  } catch (error) {
    console.error("[reset-thumbnails] error:", error)
    return NextResponse.json({ error: "Failed to reset thumbnails" }, { status: 500 })
  }
}
