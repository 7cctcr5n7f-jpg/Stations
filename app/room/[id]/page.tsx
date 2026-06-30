"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { useRouter, useParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import VideoPlayer from "@/components/video-player"
import { X, Minimize } from "lucide-react"
import { getRoomColorClasses } from "@/lib/utils"

// ---------------------------------------------------------------------------
// IndexedDB helpers — store schedule JSON and video blobs locally so the
// room can play entirely from cache after the initial load.
// ---------------------------------------------------------------------------

const DB_NAME = "stations-room-cache"
const DB_VERSION = 1

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains("schedules")) db.createObjectStore("schedules")
      if (!db.objectStoreNames.contains("videos")) db.createObjectStore("videos")
    }
  })
}

async function idbGet<T>(storeName: string, key: string): Promise<T | undefined> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly")
    const req = tx.objectStore(storeName).get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => reject(req.error)
  })
}

async function idbSet(storeName: string, key: string, value: unknown): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite")
    const req = tx.objectStore(storeName).put(value, key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

// ---------------------------------------------------------------------------
// Fetch schedule + video list from the server, cache results in IndexedDB.
// Returns the assembled assignments array ready for VideoPlayer.
// ---------------------------------------------------------------------------

async function fetchAndCacheSchedule(roomId: string, date: string): Promise<{ assignments: any[]; nextDayEquipment: string[] }> {
  const [schedulesRes, videosRes] = await Promise.all([
    fetch(`/api/schedules?roomId=${roomId}&date=${date}`),
    fetch(`/api/videos`),
  ])

  const schedules: any[] = await schedulesRes.json()
  const videos: any[] = await videosRes.json()

  // Persist to IndexedDB for offline / date-change use
  await Promise.all([
    idbSet("schedules", `${roomId}-${date}`, schedules),
    idbSet("schedules", `${roomId}-videos`, videos),
  ])

  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const nextDate = tomorrow.toISOString().split("T")[0]

  // Fetch next-day schedule in background (no await — don't block)
  fetch(`/api/schedules?roomId=${roomId}&date=${nextDate}`)
    .then((r) => r.json())
    .then((ns) => idbSet("schedules", `${roomId}-${nextDate}`, ns))
    .catch(() => {})

  return buildAssignments(schedules, videos, roomId, date, videos)
}

function buildAssignments(
  schedules: any[],
  videos: any[],
  roomId: string,
  date: string,
  allVideos: any[],
): { assignments: any[]; nextDayEquipment: string[] } {
  const assignments: any[] = schedules
    .map((s) => {
      const video = videos.find((v) => v.id === s.videoId)
      if (!video) return null
      return {
        id: s.id,
        roomId: s.roomId,
        videoId: s.videoId,
        sets: 0,
        reps: s.reps || "0",
        restTime: 0,
        position: s.position || 1,
        isActive: true,
        zoomLevel: s.zoomLevel || "1",
        verticalPosition: s.verticalPosition || "0",
        displayEquipment: s.displayEquipment || video.equipment,
        video: {
          ...video,
          title: s.displayTitle || video.title,
          equipment: s.displayEquipment || video.equipment,
        },
      }
    })
    .filter(Boolean)

  return { assignments: assignments.slice(0, 4), nextDayEquipment: [] }
}

// ---------------------------------------------------------------------------
// Download videos into IndexedDB blobs. Only fetches URLs not already cached.
// ---------------------------------------------------------------------------

async function cacheVideos(assignments: any[]): Promise<void> {
  for (const a of assignments) {
    const key = `video-${a.video.id}`
    const existing = await idbGet<{ blob: Blob }>("videos", key)
    if (existing) continue

    try {
      const res = await fetch(a.video.url)
      if (!res.ok) continue
      const blob = await res.blob()
      await idbSet("videos", key, { blob, url: a.video.url, cachedAt: Date.now() })
    } catch {
      // Non-fatal: video will stream from R2
    }
  }
}

/** Returns a blob:// URL for a cached video, or null if not yet cached. */
async function getCachedVideoUrl(videoId: number): Promise<string | null> {
  const entry = await idbGet<{ blob: Blob }>("videos", `video-${videoId}`)
  if (!entry?.blob) return null
  return URL.createObjectURL(entry.blob)
}

// ---------------------------------------------------------------------------
// Main room display component
// ---------------------------------------------------------------------------

export default function RoomDisplayPage() {
  const router = useRouter()
  const params = useParams()
  const roomId = params.id as string

  const [currentDate, setCurrentDate] = useState(() => new Date().toISOString().split("T")[0])
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [room, setRoom] = useState<any>(null)
  const [assignments, setAssignments] = useState<any[]>([])
  const [nextDayEquipment, setNextDayEquipment] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const sseRef = useRef<EventSource | null>(null)
  const dateRef = useRef(currentDate)
  dateRef.current = currentDate

  // -- Load room metadata once --
  useEffect(() => {
    fetch(`/api/rooms/${roomId}`)
      .then((r) => r.json())
      .then(setRoom)
      .catch((e) => setError(e.message))
  }, [roomId])

  // -- Load schedule (from cache first, then network) --
  const loadSchedule = useCallback(
    async (date: string) => {
      try {
        // Optimistically show cached data immediately
        const cached = await idbGet<any[]>("schedules", `${roomId}-${date}`)
        const cachedVideos = await idbGet<any[]>("schedules", `${roomId}-videos`)
        if (cached && cachedVideos) {
          const { assignments: cachedAssignments } = buildAssignments(cached, cachedVideos, roomId, date, cachedVideos)
          setAssignments(cachedAssignments)
          setIsLoading(false)
        }

        // Always fetch fresh from server
        const { assignments: fresh } = await fetchAndCacheSchedule(roomId, date)
        setAssignments(fresh)
        setIsLoading(false)

        // Background: cache video blobs for offline use
        cacheVideos(fresh).catch(() => {})
      } catch (e: any) {
        setError(e.message)
        setIsLoading(false)
      }
    },
    [roomId],
  )

  useEffect(() => {
    loadSchedule(currentDate)
  }, [currentDate, loadSchedule])

  // -- Date change detection (check every 60 s) --
  useEffect(() => {
    const interval = setInterval(() => {
      const newDate = new Date().toISOString().split("T")[0]
      if (newDate !== dateRef.current) {
        setCurrentDate(newDate)
      }
    }, 60_000)
    return () => clearInterval(interval)
  }, [])

  // -- SSE connection for trainer-pushed schedule changes --
  useEffect(() => {
    const connect = () => {
      const es = new EventSource(`/api/schedules/sse?roomId=${roomId}`)
      sseRef.current = es

      es.onmessage = (e) => {
        try {
          const payload = JSON.parse(e.data)
          // Only react if the event concerns today's date
          if (payload.date === dateRef.current || !payload.date) {
            loadSchedule(dateRef.current)
          }
        } catch {
          // Malformed event — ignore
        }
      }

      es.onerror = () => {
        es.close()
        // Reconnect after 5 s if the connection drops
        setTimeout(connect, 5_000)
      }
    }

    connect()

    return () => {
      sseRef.current?.close()
    }
  }, [roomId, loadSchedule])

  // -- Fullscreen --
  useEffect(() => {
    const timeout = setTimeout(async () => {
      try {
        if (document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen()
        }
      } catch {
        // Fullscreen blocked — ignore
      }
    }, 500)
    return () => clearTimeout(timeout)
  }, [])

  useEffect(() => {
    const check = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", check)
    check()
    return () => document.removeEventListener("fullscreenchange", check)
  }, [])

  const handleExitRoom = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().then(() => router.push("/rooms")).catch(() => router.push("/rooms"))
    } else {
      router.push("/rooms")
    }
  }

  const handleToggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      document.documentElement.requestFullscreen?.()
    }
  }

  // -- Render --
  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center text-white">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4" />
          <p>Loading room...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center text-white">
          <p className="text-xl mb-4">Error: {error}</p>
          <Button onClick={() => router.push("/rooms")} variant="outline">Back to Room Selection</Button>
        </div>
      </div>
    )
  }

  if (!room) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center text-white">
          <p className="text-xl mb-4">Room not found</p>
          <Button onClick={() => router.push("/rooms")} variant="outline">Back to Room Selection</Button>
        </div>
      </div>
    )
  }

  const { colorClass } = getRoomColorClasses(room.number)
  const videoCount = assignments.length

  const getGridClasses = (count: number) => {
    switch (count) {
      case 1: return { container: "flex items-center justify-center", video: "max-w-[50%] h-full" }
      case 2: return { container: "grid grid-cols-2 gap-0 relative", video: "h-full w-full" }
      case 3:
      case 4: return { container: "grid grid-cols-2 grid-rows-2 gap-0 h-full relative", video: "w-full" }
      default: return { container: "flex items-center justify-center", video: "max-w-[50%] h-full" }
    }
  }

  const gridClasses = getGridClasses(videoCount)
  const nextDate = new Date()
  nextDate.setDate(nextDate.getDate() + 1)

  return (
    <div className="h-screen bg-white flex flex-col">
      {!isFullscreen && (
        <div className="bg-[hsl(198,18%,21%)] text-white p-4 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className={`w-8 h-8 ${colorClass} rounded-full flex items-center justify-center`}>
              <span className="text-white text-sm font-bold">{room.number}</span>
            </div>
            <div>
              <h2 className="font-semibold">{room.name}</h2>
              <p className="text-sm text-gray-400">Today&apos;s Workout</p>
            </div>
          </div>
          <div className="flex space-x-3">
            <Button onClick={handleToggleFullscreen} className="bg-blue-600 hover:bg-blue-700 text-white">
              <Minimize className="mr-2 h-4 w-4" />
              Toggle Fullscreen
            </Button>
            <Button onClick={handleExitRoom} className="bg-red-600 hover:bg-red-700 text-white">
              <X className="mr-2 h-4 w-4" />
              Exit Room
            </Button>
          </div>
        </div>
      )}

      {!isFullscreen && nextDayEquipment.length > 0 && (
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="text-sm font-medium">Tomorrow&apos;s Equipment:</div>
              <div className="flex items-center space-x-2">
                {nextDayEquipment.map((eq, i) => (
                  <span key={i} className="bg-white/20 backdrop-blur-sm rounded-full px-3 py-1 text-sm font-medium">{eq}</span>
                ))}
              </div>
            </div>
            <div className="text-xs text-indigo-200">
              {nextDate.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 bg-white">
        {assignments.length === 0 ? (
          <div className="h-full flex items-center justify-center text-gray-800">
            <div className="text-center">
              <p className="text-xl mb-2">No videos scheduled for this room</p>
              <p className="text-gray-600">Please contact your trainer</p>
            </div>
          </div>
        ) : (
          <div className={`h-full bg-white ${gridClasses.container}`}>
            {assignments.map((assignment) => (
              <div key={assignment.id} className={`${gridClasses.video} overflow-hidden`}>
                <VideoPlayer
                  assignment={assignment}
                  displayMode={videoCount > 1 ? "split" : "single"}
                  videoCount={videoCount}
                  isFullscreen={isFullscreen}
                />
              </div>
            ))}
            {videoCount === 2 && (
              <div className="absolute top-0 left-1/2 h-full w-0.5 bg-black transform -translate-x-px z-10" />
            )}
            {(videoCount === 3 || videoCount === 4) && (
              <>
                <div className="absolute top-0 left-1/2 h-full w-0.5 bg-black transform -translate-x-px z-10" />
                <div className="absolute left-0 top-1/2 w-full h-0.5 bg-black transform -translate-y-px z-10" />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
