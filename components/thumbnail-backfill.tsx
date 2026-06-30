"use client"

/**
 * ThumbnailBackfill
 *
 * Extracts a frame from each video that has no thumbnail by:
 * 1. Loading the video into a hidden <video> element
 * 2. Seeking to 0.5 s
 * 3. Drawing the current frame to a <canvas>
 * 4. Exporting as JPEG and POSTing to /api/videos/thumbnail
 *
 * Runs entirely in the browser — no ffmpeg needed.
 */

import { useState, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { ImagePlus, CheckCircle, Loader2 } from "lucide-react"

interface BackfillVideo {
  id: number
  url: string
}

export function ThumbnailBackfill({ onComplete }: { onComplete?: () => void }) {
  const [state, setState] = useState<"idle" | "running" | "done">("idle")
  const [progress, setProgress] = useState({ done: 0, total: 0, errors: 0 })
  const abortRef = useRef(false)

  async function extractFrame(videoUrl: string): Promise<Blob | null> {
    return new Promise((resolve) => {
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
        resolve(null)
      }, 15000)

      video.addEventListener("loadeddata", () => {
        video.currentTime = Math.min(0.5, video.duration * 0.1)
      }, { once: true })

      video.addEventListener("seeked", () => {
        clearTimeout(timeout)
        try {
          const canvas = document.createElement("canvas")
          canvas.width = 320
          canvas.height = Math.round(320 * (video.videoHeight / video.videoWidth)) || 180
          const ctx = canvas.getContext("2d")
          if (!ctx) { cleanup(); resolve(null); return }
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          canvas.toBlob((blob) => {
            cleanup()
            resolve(blob)
          }, "image/jpeg", 0.8)
        } catch {
          cleanup()
          resolve(null)
        }
      }, { once: true })

      video.addEventListener("error", () => {
        clearTimeout(timeout)
        cleanup()
        resolve(null)
      }, { once: true })

      video.src = videoUrl
      video.load()
    })
  }

  async function run() {
    abortRef.current = false
    setState("running")

    const res = await fetch("/api/videos/thumbnail?missing=true")
    const { videos }: { videos: BackfillVideo[] } = await res.json()
    setProgress({ done: 0, total: videos.length, errors: 0 })

    let errors = 0
    for (let i = 0; i < videos.length; i++) {
      if (abortRef.current) break
      const v = videos[i]
      try {
        const blob = await extractFrame(v.url)
        if (blob) {
          const form = new FormData()
          form.append("videoId", String(v.id))
          form.append("frame", blob, `thumb-${v.id}.jpg`)
          await fetch("/api/videos/thumbnail", { method: "POST", body: form })
        } else {
          errors++
        }
      } catch {
        errors++
      }
      setProgress({ done: i + 1, total: videos.length, errors })
    }

    setState("done")
    setProgress(p => ({ ...p, errors }))
    onComplete?.()
  }

  function stop() {
    abortRef.current = true
  }

  if (state === "idle") {
    return (
      <Button variant="outline" size="sm" onClick={run} className="h-8 gap-1.5 text-xs">
        <ImagePlus className="h-3.5 w-3.5" />
        Generate missing thumbnails
      </Button>
    )
  }

  if (state === "done") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-green-600">
        <CheckCircle className="h-3.5 w-3.5" />
        {progress.done} thumbnails generated
        {progress.errors > 0 && (
          <span className="text-gray-400">({progress.errors} failed)</span>
        )}
      </span>
    )
  }

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
  return (
    <div className="flex items-center gap-3">
      <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400 shrink-0" />
      <div className="flex-1 min-w-[120px]">
        <Progress value={pct} className="h-1.5" />
      </div>
      <span className="text-xs tabular-nums text-gray-500 shrink-0">
        {progress.done}/{progress.total}
      </span>
      <Button variant="ghost" size="sm" onClick={stop} className="h-6 px-2 text-xs text-gray-400">
        Stop
      </Button>
    </div>
  )
}
