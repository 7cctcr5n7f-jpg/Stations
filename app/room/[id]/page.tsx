"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { useRouter, useParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import VideoPlayer from "@/components/video-player"
import { X, Minimize, RefreshCw } from "lucide-react"
import { getRoomColorClasses } from "@/lib/utils"
import { formatLocalDate } from "@/lib/local-date"

// ---------------------------------------------------------------------------
// IndexedDB helpers — store schedule JSON and video blobs locally so the
// room can play entirely from cache after the initial load.
// ---------------------------------------------------------------------------

const DB_NAME = "stations-room-cache"
const DB_VERSION = 1
const SCHEDULE_CACHE_TTL_MS = 30 * 60 * 1000

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
// Fetch room/day assignments from the server and cache results in IndexedDB.
// ---------------------------------------------------------------------------

type RoomSchedulePayload = {
  assignments: any[]
  fingerprint?: string
}

async function fetchAndCacheSchedule(
  roomId: string,
  date: string,
): Promise<{ assignments: any[]; nextDayEquipment: string[]; fingerprint: string }> {
  const response = await fetch(`/api/rooms/${roomId}/schedule?date=${date}`)
  if (!response.ok) {
    throw new Error(`Failed to load room schedule (${response.status})`)
  }

  const payload = (await response.json()) as RoomSchedulePayload
  const assignments = Array.isArray(payload.assignments) ? payload.assignments : []
  const fingerprint = typeof payload.fingerprint === "string" ? payload.fingerprint : ""

  // Persist to IndexedDB for offline / date-change use
  await Promise.all([
    idbSet("schedules", `${roomId}-${date}`, assignments),
    idbSet("schedules", `${roomId}-${date}-meta`, { fetchedAt: Date.now(), fingerprint }),
  ])

  return { assignments, nextDayEquipment: [], fingerprint }
}

// ---------------------------------------------------------------------------
// Main room display component
// ---------------------------------------------------------------------------

export default function RoomDisplayPage() {
  const router = useRouter()
  const params = useParams()
  const roomId = params.id as string

  const [currentDate, setCurrentDate] = useState(() => formatLocalDate(new Date()))
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [room, setRoom] = useState<any>(null)
  const [assignments, setAssignments] = useState<any[]>([])
  const [nextDayEquipment, setNextDayEquipment] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scheduleFingerprintRef = useRef("")
  // dateRef used only for the midnight date-change check
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
    async (date: string, forceRefresh = false) => {
      try {
        // Optimistically show cached data immediately
        const cachedAssignments = await idbGet<any[]>("schedules", `${roomId}-${date}`)
        const cachedMeta = await idbGet<{ fetchedAt?: number; fingerprint?: string }>("schedules", `${roomId}-${date}-meta`)
        if (cachedAssignments) {
          setAssignments(cachedAssignments)
          setIsLoading(false)
          scheduleFingerprintRef.current = cachedMeta?.fingerprint ?? ""

          const fetchedAt = typeof cachedMeta?.fetchedAt === "number" ? cachedMeta.fetchedAt : 0
          if (!forceRefresh && Date.now() - fetchedAt < SCHEDULE_CACHE_TTL_MS) {
            return
          }
        }

        // Always fetch fresh from server
        const { assignments: fresh, fingerprint } = await fetchAndCacheSchedule(roomId, date)
        scheduleFingerprintRef.current = fingerprint
        setAssignments(fresh)
        setIsLoading(false)

        // Keep direct R2 media delivery. Browser/CDN caching handles playback
        // without triggering cross-origin blob fetch failures in the console.
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
      const newDate = formatLocalDate(new Date())
      if (newDate !== dateRef.current) {
        setCurrentDate(newDate)
      }
    }, 60_000)
    return () => clearInterval(interval)
  }, [])

  // Lightweight schedule-change check: every 30 minutes ask for a cheap
  // fingerprint, and only refetch full assignments when it changed.
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const date = dateRef.current
        const response = await fetch(`/api/rooms/${roomId}/schedule?date=${date}&mode=fingerprint`)
        if (!response.ok) return

        const data = (await response.json()) as { fingerprint?: string }
        const serverFingerprint = typeof data.fingerprint === "string" ? data.fingerprint : ""
        if (serverFingerprint !== scheduleFingerprintRef.current) {
          await loadSchedule(date, true)
        }
      } catch {
        // Non-fatal: keep current schedule on screen
      }
    }, 30 * 60 * 1000)

    return () => clearInterval(interval)
  }, [roomId, loadSchedule])

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

  const handleManualRefresh = async () => {
    setIsRefreshing(true)
    try {
      await loadSchedule(currentDate, true)
    } finally {
      setIsRefreshing(false)
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
    if (count > 4) {
      const columns = count <= 6 ? 3 : 4
      return {
        container: "grid gap-0 h-full",
        video: "w-full h-full",
        style: { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridAutoRows: "minmax(0, 1fr)" } as const,
      }
    }

    switch (count) {
      case 1: return { container: "flex items-center justify-center", video: "max-w-[50%] h-full", style: undefined as const }
      case 2: return { container: "grid grid-cols-2 gap-0 relative", video: "h-full w-full", style: undefined as const }
      case 3:
      case 4: return { container: "grid grid-cols-2 grid-rows-2 gap-0 h-full relative", video: "w-full", style: undefined as const }
      default: return { container: "flex items-center justify-center", video: "max-w-[50%] h-full", style: undefined as const }
    }
  }

  const gridClasses = getGridClasses(videoCount)
  const nextDate = new Date()
  nextDate.setDate(nextDate.getDate() + 1)

  return (
    <div className="h-screen bg-white flex flex-col border-0 outline-none">
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
            <Button
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className="bg-gray-700 hover:bg-gray-800 text-white"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
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

      <div className="flex-1 bg-white overflow-hidden border-0">
        {assignments.length === 0 ? (
          <div className="h-full flex items-center justify-center text-gray-800">
            <div className="text-center">
              <p className="text-xl mb-2">No videos scheduled for this room</p>
              <p className="text-gray-600">Please contact your trainer</p>
            </div>
          </div>
        ) : (
          <div className={`h-full bg-white overflow-hidden border-0 ${gridClasses.container}`} style={gridClasses.style}>
            {assignments.map((assignment) => (
              <div key={assignment.id} className={`${gridClasses.video} border-0`}>
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
