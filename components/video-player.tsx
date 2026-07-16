"use client"

import { useRef, useEffect, useState } from "react"
import { Play } from "lucide-react"

interface VideoPlayerProps {
  assignment: {
    id: number;
    sets: number;
    reps: string | number; // Allow both string and number
    zoomLevel?: string;
    verticalPosition?: string;
    displayEquipment?: string;
    video: {
      id: number;
      title: string;
      url: string;
      duration: string;
      bodyPart: string;
      equipment: string;
      intensity?: "Low" | "Medium" | "High" | null;
      thumbnailUrl?: string | null;
    };
  };
  displayMode?: 'single' | 'split';
  videoCount?: number;
  isFullscreen?: boolean;
  /** Milliseconds to wait before starting the video load (stagger concurrent loads) */
  loadDelay?: number;
  /**
   * Render the exercise thumbnail image instead of streaming the video.
   * Used by the admin Live View planning grid where 20+ tiles render at once —
   * thumbnails (≈3KB each) load instantly and reliably, avoiding the browser's
   * ~6-connection-per-host limit that causes concurrent video loads to fail.
   */
  thumbnailMode?: boolean;
}

export default function VideoPlayer({ assignment, displayMode = 'single', videoCount = 1, isFullscreen = false, loadDelay = 0, thumbnailMode = false }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [retryAttempted, setRetryAttempted] = useState(false);
  const zoom = Math.max(parseFloat(assignment.zoomLevel || "1"), 1.02); // min 1.02 clips video edge codec artifacts
  const verticalPos = parseFloat(assignment.verticalPosition || "0");
  const [videoSrc, setVideoSrc] = useState("");
  const [sourceVersion, setSourceVersion] = useState(0);
  const [isCached, setIsCached] = useState(false);
  const [thumbError, setThumbError] = useState(false);

  const withRetryBuster = (url: string) => {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}retry=${Date.now()}`;
  };

  // Initialize video with optional stagger delay to avoid thundering herd
  useEffect(() => {
    if (thumbnailMode) return; // thumbnail mode never loads the video stream
    const videoUrl = assignment.video.url?.trim();
    if (!videoUrl) {
      console.warn(`[v0] Video ${assignment.video.id} has no URL - marking as error`);
      setVideoError(true);
      return;
    }

    setSourceVersion(0);
    setVideoLoaded(false);
    setVideoError(false);
    setRetryAttempted(false);
    setIsCached(false);

    if (loadDelay > 0) {
      // Stagger: wait before setting src so the browser doesn't open all connections at once
      const timer = setTimeout(() => setVideoSrc(videoUrl), loadDelay);
      return () => clearTimeout(timer);
    }

    setVideoSrc(videoUrl);
  }, [assignment.video.id, assignment.video.url, loadDelay, thumbnailMode]);

  useEffect(() => {
    if (thumbnailMode) return; // no video timeout logic in thumbnail mode
    if (!videoRef.current || videoLoaded || videoError) return;

    // When many videos load simultaneously (Live View: 20+), the browser
    // queues them (≈6 concurrent per hostname). Use a generous timeout
    // that scales with the number of sibling video elements so later ones
    // don't time out while waiting in the queue.
    const peerCount = document.querySelectorAll("video").length;
    const baseTimeout = 25000;
    // Add 3s per concurrent video beyond the first 4 (browser's connection limit)
    const extraMs = Math.max(0, peerCount - 4) * 3000;
    const timeout = baseTimeout + Math.min(extraMs, 60000); // cap at 85s total

    const loadTimeout = setTimeout(() => {
      if (videoLoaded || videoError) return;

      if (!retryAttempted) {
        setRetryAttempted(true);
        setVideoLoaded(false);
        setVideoError(false);
        setSourceVersion((v) => v + 1);
      } else {
        // Before giving up, check if the video actually has data
        const v = videoRef.current;
        if (v && v.readyState >= 2) {
          // Video has enough data — the canplay event might have been missed
          setVideoLoaded(true);
          v.play().catch(() => setAutoplayBlocked(true));
        } else {
          setVideoError(true);
        }
      }
    }, timeout);

    return () => {
      clearTimeout(loadTimeout);
    }
  }, [videoLoaded, videoError, retryAttempted, sourceVersion, thumbnailMode]);

  // On first user interaction anywhere in the document, attempt to play
  // all paused videos. Required for TV boxes and iOS that block autoplay
  // until a user gesture occurs.
  useEffect(() => {
    if (thumbnailMode) return; // no autoplay handling needed for a static thumbnail
    const handler = () => {
      const video = videoRef.current;
      if (video && video.paused && videoLoaded && !videoError) {
        video.play().then(() => setAutoplayBlocked(false)).catch(() => {});
      }
    };
    document.addEventListener("click", handler, { once: true });
    document.addEventListener("touchstart", handler, { once: true });
    return () => {
      document.removeEventListener("click", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [videoLoaded, videoError, thumbnailMode]);

  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  const handlePlayable = () => {
    if (videoError) return;

    setVideoLoaded(true);
    const video = videoRef.current;
    if (!video) return;

    // Immediate play for cached videos, small delay for multi-video to prevent CPU spikes
    const playDelay = isCached ? 0 : (videoCount >= 3 ? Math.random() * 200 : 0);
    setTimeout(() => {
      video.play().catch(() => {
        // Autoplay blocked (common on some TV box browsers and iOS without interaction)
        setAutoplayBlocked(true);
      });
    }, playDelay);
  };

  const handleTapToPlay = () => {
    const video = videoRef.current;
    if (!video) return;
    video.play().then(() => setAutoplayBlocked(false)).catch(console.error);
  };

  const handleVideoError = () => {
    // Network errors can be transient; give more retries before failing
    if (!retryAttempted) {
      setRetryAttempted(true);
      setVideoLoaded(false);
      setVideoError(false);
      setSourceVersion((v) => v + 1);
      return;
    }

    // Second failure — check if the video actually has usable data despite the error
    const v = videoRef.current;
    if (v && v.readyState >= 2) {
      setVideoLoaded(true);
      v.play().catch(() => setAutoplayBlocked(true));
      return;
    }

    console.error('Video failed to load after retry:', videoSrc);
    setVideoError(true);
  };

  const handleManualReload = () => {
    setVideoLoaded(false);
    setVideoError(false);
    setRetryAttempted(false);
    setAutoplayBlocked(false);
    setSourceVersion((v) => v + 1);
  };



  // Always use 100% so the video fills its grid/flex parent without overflowing
  // (using vh caused the container to exceed available height when a header was present,
  // creating a dark clipping artifact at the overflow edge)
  const containerHeight = '100%';
  const isCompactMode = videoCount >= 3;

  // Get intensity color and styling
  const getIntensityStyles = (intensity?: string | null) => {
    switch (intensity) {
      case "High":
        return { bg: "bg-red-500/90", text: "text-white", label: "HIGH" };
      case "Medium":
        return { bg: "bg-yellow-500/90", text: "text-black", label: "MED" };
      case "Low":
        return { bg: "bg-green-500/90", text: "text-white", label: "LOW" };
      default:
        return null;
    }
  };

  const intensityStyles = getIntensityStyles(assignment.video.intensity);
  const thumbnailUrl = assignment.video.thumbnailUrl?.trim() || "";

  return (
    <div className="relative bg-white w-full h-full overflow-hidden">
      {thumbnailMode ? (
        thumbnailUrl && !thumbError ? (
          <img
            src={thumbnailUrl}
            alt={assignment.video.title}
            className="w-full"
            draggable={false}
            style={{
              height: containerHeight,
              objectFit: 'contain',
              objectPosition: 'center',
              transform: `scale(${zoom}) translateY(${verticalPos}px)`,
              transformOrigin: 'center',
              backgroundColor: 'white',
            }}
            onError={() => setThumbError(true)}
          />
        ) : (
          // Thumbnail missing/failed — show a titled placeholder so the trainer
          // can still identify the station's exercise.
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
            <span className="text-black font-bold text-center px-3 leading-tight text-2xl">
              {assignment.video.title}
            </span>
          </div>
        )
      ) : (
        videoSrc && (
          <video
            key={`${assignment.id}-${sourceVersion}`}
            ref={videoRef}
            src={sourceVersion === 0 ? videoSrc : withRetryBuster(videoSrc)}
            className="w-full"
            tabIndex={-1}
            style={{
              height: containerHeight,
              objectFit: 'contain',
              objectPosition: 'center',
              transform: `scale(${zoom}) translateY(${verticalPos}px)`,
              transformOrigin: 'center',
              backgroundColor: 'white',
              outline: 'none',
              border: 'none',
              display: videoLoaded ? 'block' : 'none',
            }}
            loop
            muted
            playsInline
            // @ts-expect-error webkit-playsinline needed for older WebKit TV box browsers
            webkit-playsinline=""
            autoPlay
            preload="auto"
            controls={false}
            disablePictureInPicture
            crossOrigin={undefined}
            onCanPlay={handlePlayable}
            onLoadedData={handlePlayable}
            onError={handleVideoError}
          />
        )
      )}
      
      {/* Intensity Badge - Top Left */}
      {intensityStyles && (
        <div className={`absolute ${isCompactMode ? 'top-3 left-3' : 'top-5 left-5'} z-20 pointer-events-none`}>
          <div className={`${intensityStyles.bg} ${intensityStyles.text} rounded-lg font-bold uppercase tracking-wider ${isCompactMode ? 'px-2.5 py-1 text-xs' : 'px-4 py-2 text-sm'}`}>
            {intensityStyles.label}
          </div>
        </div>
      )}

      {/* Video Title - Top Center, padded to avoid intensity badge (left) and reps card (right) */}
      <div className={`absolute ${isCompactMode ? 'top-3' : 'top-5'} left-0 right-0 z-10 flex justify-center pointer-events-none ${isCompactMode ? 'pl-[84px] pr-[116px]' : 'pl-[110px] pr-[160px]'}`}>
        <div className={`bg-white/90 backdrop-blur-sm rounded-lg ${isCompactMode ? 'px-3 py-1.5' : 'px-6 py-3'} text-center`}>
          <h3 className={`${isCompactMode ? 'text-base' : 'text-2xl'} font-bold text-black leading-tight`}>
            {assignment.video.title}
          </h3>
        </div>
      </div>

      {/* Reps + Equipment — top right */}
      {(() => {
        const repsStr = String(assignment.reps ?? '').trim();
        const equipmentRaw = (assignment.displayEquipment || assignment.video.equipment || '').split(',')[0].trim();
        const equipmentStr = equipmentRaw.toLowerCase() === 'none' ? '' : equipmentRaw;
        const isNumericOnly = /^\d+$/.test(repsStr);
        const hasReps = repsStr && repsStr !== '0';
        if (!hasReps && !equipmentStr) return null;

        return (
          <div className={`absolute ${isCompactMode ? 'top-3 right-3' : 'top-5 right-5'} z-20`}>
            <div className={`
              flex flex-col items-center
              bg-black/75 backdrop-blur-md
              rounded-2xl overflow-hidden
              shadow-[0_4px_24px_rgba(0,0,0,0.35)]
              ${isCompactMode ? 'w-[96px]' : 'w-[130px]'}
            `}>
              {/* Reps block */}
              {hasReps && (
                <div className={`flex flex-col items-center justify-center w-full ${isCompactMode ? 'px-3 pt-2.5 pb-2' : 'px-4 pt-4 pb-3'}`}>
                  {isNumericOnly ? (
                    <>
                      <span className={`font-black text-white leading-none ${isCompactMode ? 'text-2xl' : 'text-4xl'}`}>
                        {repsStr}
                      </span>
                      <span className={`text-white/50 font-semibold uppercase tracking-widest mt-0.5 ${isCompactMode ? 'text-[9px]' : 'text-[10px]'}`}>
                        REPS
                      </span>
                    </>
                  ) : (
                    <span className={`font-bold text-white text-center leading-tight uppercase tracking-wide break-words w-full ${isCompactMode ? 'text-xs' : 'text-sm'}`}>
                      {repsStr}
                    </span>
                  )}
                </div>
              )}

              {/* Divider + Equipment */}
              {hasReps && equipmentStr && (
                <div className="w-full h-px bg-white/10" />
              )}
              {equipmentStr && (
                <div className={`flex items-center justify-center w-full ${isCompactMode ? 'px-2 py-1.5' : 'px-3 py-2'}`}>
                  <span className={`text-white/60 font-medium uppercase tracking-widest text-center break-words w-full ${isCompactMode ? 'text-[9px]' : 'text-[10px]'}`}>
                    {equipmentStr}
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })()}
      
      {/* Loading/Error placeholder */}
      {!thumbnailMode && (!videoLoaded && !videoError) && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900 text-white">
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-white mx-auto mb-4"></div>
            <h3 className="text-2xl font-bold mb-4">{assignment.video.title}</h3>
            <p className="text-gray-400 text-lg">Loading video...</p>
          </div>
        </div>
      )}
      
      {!thumbnailMode && videoError && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900 text-white">
          <div className="text-center">
            <Play className="h-16 w-16 mx-auto mb-4 opacity-50" />
            <h3 className="text-2xl font-bold mb-4">{assignment.video.title}</h3>
            <p className="text-red-400 text-lg">Video failed to load. Other videos will continue.</p>
            <button
              type="button"
              onClick={handleManualReload}
              className="mt-4 px-4 py-2 rounded-md bg-white text-black font-medium hover:bg-gray-200"
            >
              Reload video
            </button>
          </div>
        </div>
      )}

      {/* Tap-to-play fallback when autoplay is blocked (TV boxes, iOS without interaction) */}
      {!thumbnailMode && autoplayBlocked && !videoError && (
        <button
          type="button"
          onClick={handleTapToPlay}
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/40"
        >
          <div className="bg-white/90 rounded-full p-4">
            <Play className="h-12 w-12 text-black" />
          </div>
        </button>
      )}
    </div>
  );
}
