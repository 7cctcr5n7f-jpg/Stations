import { type NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"

// Simple in-memory cache for video responses to avoid duplicate fetches from R2
// Each entry: { timestamp, buffer, contentType }
const videoCache = new Map<string, { timestamp: number; buffer: ArrayBuffer; contentType: string }>()

/**
 * Video proxy endpoint that forwards R2 requests with proper CORS headers.
 * This allows browser-side video playback from R2 by adding Access-Control-Allow-Origin.
 * 
 * Usage: Instead of direct R2 URL, use /api/videos/proxy?url=<encoded-r2-url>
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const url = searchParams.get("url")

    if (!url) {
      return NextResponse.json({ error: "Missing url parameter" }, { status: 400 })
    }

    // Validate URL is from R2 to prevent abuse
    if (!url.includes("r2.dev") && !url.includes("r2.cloudflarestorage.com")) {
      return NextResponse.json({ error: "Invalid URL source" }, { status: 403 })
    }

    // Check cache first to avoid duplicate R2 requests
    const cached = videoCache.get(url)
    if (cached) {
      console.log("[v0] Using cached video:", url.substring(0, 50) + "...")
      return new NextResponse(cached.buffer, {
        status: 200,
        headers: {
          "Content-Type": cached.contentType,
          "Cache-Control": "public, max-age=31536000, immutable",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Range",
          "Accept-Ranges": "bytes",
          "Content-Length": cached.buffer.byteLength.toString(),
          "X-Cache": "HIT",
        },
      })
    }

    // Fetch the video from R2
    const response = await fetch(url)

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch video: ${response.statusText}` },
        { status: response.status }
      )
    }

    // Get buffer for more reliable streaming (response.body can be null in some runtimes)
    const buffer = await response.arrayBuffer()
    const contentType = response.headers.get("content-type") || "video/mp4"

    // Cache the video for subsequent requests
    videoCache.set(url, { timestamp: Date.now(), buffer, contentType })
    console.log("[v0] Cached video:", url.substring(0, 50) + "...")

    const headers = new Headers({
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Range",
      "Accept-Ranges": "bytes",
      "Content-Length": buffer.byteLength.toString(),
      "X-Cache": "MISS",
    })

    // Return the video with proper headers for browser streaming
    return new NextResponse(buffer, {
      status: 200,
      headers,
    })
  } catch (error) {
    console.error("[v0] Video proxy error:", error)
    return NextResponse.json({ error: "Failed to proxy video" }, { status: 500 })
  }
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Range",
    },
  })
}
