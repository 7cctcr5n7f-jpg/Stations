"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import VideoPlayer from "@/components/video-player"
import { X, Minimize } from "lucide-react"
import { getRoomColorClasses } from "@/lib/utils"

export default function RoomDisplayPage() {
  const router = useRouter()
  const params = useParams()
  const roomId = params.id as string
  const [currentDate, setCurrentDate] = useState(() => new Date().toISOString().split("T")[0])
  const [isFullscreen, setIsFullscreen] = useState(false)

  // Auto-update current date at midnight
  useEffect(() => {
    const updateDate = () => {
      const newDate = new Date().toISOString().split("T")[0]
      setCurrentDate((prev) => (newDate !== prev ? newDate : prev))
    }
    const interval = setInterval(updateDate, 60000)
    updateDate()
    return () => clearInterval(interval)
  }, [])

  // Auto-enter fullscreen when component mounts
  useEffect(() => {
    const enterFullscreen = async () => {
      try {
        if (document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen()
        }
      } catch {
        console.log("[v0] Fullscreen not available or blocked")
      }
    }
    const timeout = setTimeout(enterFullscreen, 500)
    return () => clearTimeout(timeout)
  }, [])

  // Track fullscreen state
  useEffect(() => {
    const checkFullscreen = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", checkFullscreen)
    checkFullscreen()
    return () => document.removeEventListener("fullscreenchange", checkFullscreen)
  }, [])

  const handleExitRoom = () => {
    if (document.fullscreenElement) {
      document
        .exitFullscreen()
        .then(() => router.push("/rooms"))
        .catch(() => router.push("/rooms"))
    } else {
      router.push("/rooms")
    }
  }

  const handleToggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen()
    }
  }

  const {
    data: room,
    isLoading: roomLoading,
    error: roomError,
  } = useQuery({
    queryKey: [`/api/rooms/${roomId}`],
    queryFn: async () => {
      const response = await fetch(`/api/rooms/${roomId}`)
      if (!response.ok) {
        throw new Error(`Room API error: ${response.status}`)
      }
      return response.json()
    },
  })

  const { data: schedules = [], isLoading: schedulesLoading } = useQuery<any[]>({
    queryKey: [`/api/schedules/room/${roomId}`, currentDate],
    queryFn: async () => {
      const response = await fetch(`/api/schedules?roomId=${roomId}&date=${currentDate}`)
      return response.json()
    },
    refetchInterval: 2000,
  })

  const nextDate = new Date()
  nextDate.setDate(nextDate.getDate() + 1)
  const nextDateString = nextDate.toISOString().split("T")[0]

  const { data: nextDaySchedules = [] } = useQuery<any[]>({
    queryKey: [`/api/schedules/room/${roomId}`, nextDateString],
    queryFn: async () => {
      const response = await fetch(`/api/schedules?roomId=${roomId}&date=${nextDateString}`)
      return response.json()
    },
  })

  const { data: videos = [], isLoading: videosLoading } = useQuery<any[]>({
    queryKey: ["/api/videos"],
    queryFn: async () => {
      const response = await fetch(`/api/videos`)
      return response.json()
    },
  })

  const isLoading = roomLoading || schedulesLoading || videosLoading

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

  if (roomError) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center text-white">
          <p className="text-xl mb-4">Error loading room: {(roomError as Error).message}</p>
          <Button onClick={() => router.push("/rooms")} variant="outline">
            Back to Room Selection
          </Button>
        </div>
      </div>
    )
  }

  if (!room) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center text-white">
          <p className="text-xl mb-4">Room not found</p>
          <Button onClick={() => router.push("/rooms")} variant="outline">
            Back to Room Selection
          </Button>
        </div>
      </div>
    )
  }

  const { colorClass } = getRoomColorClasses(room.number)

  const activeAssignments: any[] = schedules
    .map((schedule: any) => {
      const video = videos.find((v: any) => v.id === schedule.videoId)
      if (!video) return null
      const displayVideo = {
        ...video,
        title: schedule.displayTitle || video.title,
        equipment: schedule.displayEquipment || video.equipment,
      }
      return {
        id: schedule.id,
        roomId: schedule.roomId,
        videoId: schedule.videoId,
        sets: 0,
        reps: schedule.reps || "0",
        restTime: 0,
        position: schedule.position || 1,
        isActive: true,
        zoomLevel: schedule.zoomLevel || "1",
        verticalPosition: schedule.verticalPosition || "0",
        video: displayVideo,
      }
    })
    .filter((assignment: any) => assignment !== null)

  const displayAssignments: any[] = activeAssignments.slice(0, 4)
  const videoCount: number = displayAssignments.length

  const getGridClasses = (count: number) => {
    switch (count) {
      case 1:
        return { container: "flex items-center justify-center", video: "max-w-[50%] h-full" }
      case 2:
        return { container: "grid grid-cols-2 gap-0 relative", video: "h-full w-full" }
      case 3:
      case 4:
        return { container: "grid grid-cols-2 grid-rows-2 gap-0 h-full relative", video: "w-full" }
      default:
        return { container: "flex items-center justify-center", video: "max-w-[50%] h-full" }
    }
  }

  const gridClasses = getGridClasses(videoCount)

  const nextDayEquipment = nextDaySchedules
    .map((schedule: any) => {
      const video = videos.find((v: any) => v.id === schedule.videoId)
      return schedule.displayEquipment || video?.equipment
    })
    .filter((equipment: any): equipment is string => Boolean(equipment))

  const uniqueNextDayEquipment = nextDayEquipment.filter(
    (equipment: any, index: any, arr: any) => arr.indexOf(equipment) === index,
  )

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

      {!isFullscreen && uniqueNextDayEquipment.length > 0 && (
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="text-sm font-medium">Tomorrow&apos;s Equipment:</div>
              <div className="flex items-center space-x-2">
                {uniqueNextDayEquipment.map((equipment: string, index: number) => (
                  <span
                    key={index}
                    className="bg-white/20 backdrop-blur-sm rounded-full px-3 py-1 text-sm font-medium"
                  >
                    {equipment}
                  </span>
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
        {displayAssignments.length === 0 ? (
          <div className="h-full flex items-center justify-center text-gray-800">
            <div className="text-center">
              <p className="text-xl mb-2">No videos scheduled for this room</p>
              <p className="text-gray-600">Please contact your trainer</p>
            </div>
          </div>
        ) : (
          <div className={`h-full bg-white ${gridClasses.container}`}>
            {displayAssignments.map((assignment: any) => (
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
