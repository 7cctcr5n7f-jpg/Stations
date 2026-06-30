export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { type NextRequest, NextResponse } from "next/server"

// Global registry of open SSE connections keyed by roomId.
// Using a module-level Map works in Node.js serverless as long as the process
// is alive; connections naturally drop when the function cold-starts again.
type Controller = ReadableStreamDefaultController<Uint8Array>

const connections = new Map<string, Set<Controller>>()

/** Register a controller for a room. Returns a cleanup function. */
export function registerConnection(roomId: string, controller: Controller): () => void {
  if (!connections.has(roomId)) connections.set(roomId, new Set())
  connections.get(roomId)!.add(controller)
  return () => {
    connections.get(roomId)?.delete(controller)
    if (connections.get(roomId)?.size === 0) connections.delete(roomId)
  }
}

/** Broadcast a schedule-change event to all screens watching a given room. */
export function broadcastScheduleChange(roomId: string | number, payload: Record<string, unknown>) {
  const key = String(roomId)
  const set = connections.get(key)
  if (!set || set.size === 0) return

  const data = `data: ${JSON.stringify(payload)}\n\n`
  const encoded = new TextEncoder().encode(data)

  for (const ctrl of set) {
    try {
      ctrl.enqueue(encoded)
    } catch {
      // Controller already closed — remove it
      set.delete(ctrl)
    }
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const roomId = searchParams.get("roomId")

  if (!roomId) {
    return NextResponse.json({ message: "roomId is required" }, { status: 400 })
  }

  let cleanup: (() => void) | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      cleanup = registerConnection(roomId, controller)

      // Send an initial ping so the client knows the connection is live
      const ping = new TextEncoder().encode(`: connected\n\n`)
      controller.enqueue(ping)
    },
    cancel() {
      cleanup?.()
    },
  })

  // Keep-alive: Vercel functions time out after 25 s on hobby plans; on pro
  // they can stay open longer. We send a comment every 20 s to prevent proxy
  // timeouts and let the client detect a dropped connection quickly.
  const keepAliveInterval = setInterval(() => {
    try {
      const ping = new TextEncoder().encode(`: ping\n\n`)
      const set = connections.get(roomId)
      if (!set) {
        clearInterval(keepAliveInterval)
        return
      }
      for (const ctrl of set) {
        try { ctrl.enqueue(ping) } catch { set.delete(ctrl) }
      }
    } catch {
      clearInterval(keepAliveInterval)
    }
  }, 20_000)

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable Nginx buffering on Vercel
    },
  })
}
