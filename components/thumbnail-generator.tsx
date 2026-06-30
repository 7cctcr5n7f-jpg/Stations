"use client"

import { useState, useRef, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { ImageIcon, CheckCircle, XCircle, Loader2 } from "lucide-react"

interface MissingVideo {
  id: number
  title: string
  url: string
}

interface ThumbnailGeneratorProps {
  onComplete?: () => void
}

/**
 * Captures a frame from a video URL using a hidden HTMLVideoElement + Canvas.
 * Returns a JPEG data URL, or throws on failure.
 */
function captureFrame(videoUrl: string, seekSeconds = 1): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video")
    video.crossOrigin = "anonymous"
    video.muted = true
    video.playsInline = true
    video.preload = "metadata"

    const cleanup = () => {
      video.src = ""
      video.load()
    }

    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error("Timeout loading video"))
    }, 30000)

    video.addEventListener("error", () => {
      clearTimeout(timeout)
      cleanup()
      reject(new Error(`Video error: ${video.error?.message ?? "unknown"}`))
    })

    video.addEventListener("loadedmetadata", () => {
      // Seek to 1s or mid-point, whichever is earlier
      video.currentTime = Math.min(seekSeconds, video.duration * 0.1 || seekSeconds)
    })

    video.addEventListener("seeked", () => {
      clearTimeout(timeout)
      try {
        const canvas = document.createElement("canvas")
        // Cap at 480×270 (16:9) to keep thumbnails small
        const maxW = 480
        const scale = maxW / (video.videoWidth || maxW)
        canvas.width = Math.round((video.videoWidth || maxW) * Math.min(scale, 1))
        canvas.height = Math.round((video.videoHeight || 270) * Math.min(scale, 1))
        const ctx = canvas.getContext("2d")!
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        const dataUrl = canvas.toDataURL("image/jpeg", 0.82)
        cleanup()
        resolve(dataUrl)
      } catch (err) {
        cleanup()
        reject(err)
      }
    })

    video.src = videoUrl
    video.load()
  })
}

export function ThumbnailGenerator({ onComplete }: ThumbnailGeneratorProps) {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [total, setTotal] = useState(0)
  const [done, setDone] = useState(0)
  const [failed, setFailed] = useState(0)
  const [finished, setFinished] = useState(false)
  const abortRef = useRef(false)

  const run = useCallback(async () => {
    abortRef.current = false
    setRunning(true)
    setFinished(false)
    setDone(0)
    setFailed(0)

    // 1. Fetch the list of videos missing thumbnails
    let videos: MissingVideo[] = []
    try {
      const res = await fetch("/api/videos/missing-thumbnails")
      const data = await res.json()
      videos = data.videos ?? []
    } catch {
      setRunning(false)
      return
    }

    setTotal(videos.length)

    if (videos.length === 0) {
      setRunning(false)
      setFinished(true)
      return
    }

    // 2. Process one at a time to avoid overwhelming the browser
    let doneCount = 0
    let failCount = 0

    for (const video of videos) {
      if (abortRef.current) break

      try {
        const dataUrl = await captureFrame(video.url)
        await fetch("/api/videos/save-thumbnail", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoId: video.id, thumbnailDataUrl: dataUrl }),
        })
        doneCount++
      } catch {
        failCount++
      }

      setDone(doneCount)
      setFailed(failCount)
      setProgress(Math.round(((doneCount + failCount) / videos.length) * 100))
    }

    setRunning(false)
    setFinished(true)
    onComplete?.()
  }, [onComplete])

  const stop = () => {
    abortRef.current = true
  }

  if (finished && total === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-600">
        <CheckCircle className="h-4 w-4" />
        All thumbnails are up to date.
      </div>
    )
  }

  if (finished) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-600">
        <CheckCircle className="h-4 w-4" />
        Generated {done} thumbnail{done !== 1 ? "s" : ""}.
        {failed > 0 && (
          <span className="text-red-500 flex items-center gap-1">
            <XCircle className="h-3.5 w-3.5" /> {failed} failed
          </span>
        )}
      </div>
    )
  }

  if (running) {
    return (
      <div className="flex flex-col gap-2 min-w-[260px]">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span className="flex items-center gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Generating thumbnails… {done + failed}/{total}
          </span>
          <button onClick={stop} className="text-gray-400 hover:text-gray-600 underline text-xs">
            Stop
          </button>
        </div>
        <Progress value={progress} className="h-1.5" />
      </div>
    )
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 gap-1.5 text-xs"
      onClick={run}
    >
      <ImageIcon className="h-3.5 w-3.5" />
      Generate missing thumbnails
    </Button>
  )
}
