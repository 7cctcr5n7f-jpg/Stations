/**
 * lib/generate-thumbnail.ts
 *
 * Client-side canvas helper that seeks a video to a given time, draws a frame,
 * and returns the result as a JPEG Blob. Works in any modern browser; no
 * server-side FFmpeg required.
 *
 * Usage:
 *   const blob = await generateVideoThumbnail(videoUrl)
 *   // then POST blob to /api/videos/[id]/thumbnail
 */

/**
 * Load a video URL into a hidden <video> element, seek to `seekSeconds`,
 * paint the frame onto a <canvas>, and return a JPEG Blob.
 *
 * @param videoUrl     Publicly accessible URL of the video file
 * @param seekSeconds  Time in seconds to capture the frame (default: 1)
 * @param width        Output width in px (default: 320)
 * @param quality      JPEG quality 0–1 (default: 0.80)
 */
export function generateVideoThumbnail(
  videoUrl: string,
  seekSeconds = 1,
  width = 320,
  quality = 0.8
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video")
    video.crossOrigin = "anonymous"
    video.muted = true
    video.playsInline = true
    video.preload = "metadata"

    // Some browsers require a non-zero currentTime before the first seeked event
    // fires reliably, so we set it inside canplay rather than loadedmetadata.
    const cleanup = () => {
      video.removeEventListener("canplay", onCanPlay)
      video.removeEventListener("seeked", onSeeked)
      video.removeEventListener("error", onError)
      video.src = ""
    }

    const onError = () => {
      cleanup()
      reject(new Error(`Failed to load video for thumbnail: ${videoUrl}`))
    }

    const onSeeked = () => {
      cleanup()
      try {
        const aspectRatio = video.videoHeight / video.videoWidth
        const height = Math.round(width * aspectRatio)
        const canvas = document.createElement("canvas")
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext("2d")
        if (!ctx) {
          reject(new Error("Could not get canvas context"))
          return
        }
        ctx.drawImage(video, 0, 0, width, height)
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob)
            } else {
              reject(new Error("canvas.toBlob returned null"))
            }
          },
          "image/jpeg",
          quality
        )
      } catch (err) {
        reject(err)
      }
    }

    const onCanPlay = () => {
      video.removeEventListener("canplay", onCanPlay)
      // Clamp seek to valid range
      const target = Math.min(seekSeconds, video.duration || seekSeconds)
      video.currentTime = target
    }

    video.addEventListener("canplay", onCanPlay)
    video.addEventListener("seeked", onSeeked)
    video.addEventListener("error", onError)

    video.src = videoUrl
    video.load()
  })
}
