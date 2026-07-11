import { type NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"

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

    // Forward byte-range requests so clients can progressively stream media.
    const range = request.headers.get("range")
    const response = await fetch(url, {
      headers: range ? { Range: range } : undefined,
    })

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch video: ${response.statusText}` },
        { status: response.status }
      )
    }

    const headers = new Headers({
      "Cache-Control": "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Range",
      "Accept-Ranges": "bytes",
      "X-Cache": "BYPASS",
    })

    const passthroughHeaders = [
      "content-type",
      "content-length",
      "content-range",
      "etag",
      "last-modified",
    ] as const

    for (const key of passthroughHeaders) {
      const value = response.headers.get(key)
      if (value) headers.set(key, value)
    }

    // Stream through directly to avoid buffering full video files in server memory.
    return new NextResponse(response.body, {
      status: response.status,
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
