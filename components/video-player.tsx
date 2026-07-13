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
    };
  };
  displayMode?: 'single' | 'split';
  videoCount?: number;
  isFullscreen?: boolean;
}

export default function VideoPlayer({ assignment, displayMode = 'single', videoCount = 1, isFullscreen = false }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [retryAttempted, setRetryAttempted] = useState(false);
  const zoom = Math.max(parseFloat(assignment.zoomLevel || "1"), 1.02); // min 1.02 clips video edge codec artifacts
  const verticalPos = parseFloat(assignment.verticalPosition || "0");
  const [videoSrc, setVideoSrc] = useState(assignment.video.url);
  const [sourceVersion, setSourceVersion] = useState(0);
  const [isCached, setIsCached] = useState(false);

  const withRetryBuster = (url: string) => {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}retry=${Date.now()}`;
  };

  // Initialize video with direct URL loading (no caching for stability)
  useEffect(() => {
    // Validate URL exists and is not empty
    const videoUrl = assignment.video.url?.trim();
    if (!videoUrl) {
      console.warn(`[v0] Video ${assignment.video.id} has no URL - marking as error`);
      setVideoError(true);
      return;
    }
    
    // Use the R2 public URL directly. Cloudflare's CDN serves range requests
    // natively; no Vercel proxy hop needed.
    setVideoSrc(videoUrl);
    setSourceVersion(0);
    setVideoLoaded(false);
    setVideoError(false);
    setRetryAttempted(false);
    setIsCached(false);
  }, [assignment.video.id, assignment.video.url]);

  useEffect(() => {
    if (!videoRef.current || videoLoaded || videoError) return;

    // Self-heal stalled loads: retry exactly once, then fail gracefully.
    const loadTimeout = setTimeout(() => {
      if (videoLoaded || videoError) return;

      if (!retryAttempted) {
        setRetryAttempted(true);
        setVideoLoaded(false);
        setVideoError(false);
        setSourceVersion((v) => v + 1);
      } else {
        setVideoError(true);
      }
    }, 15000);

    return () => {
      clearTimeout(loadTimeout);
    }
  }, [videoLoaded, videoError, retryAttempted, sourceVersion]);

  const handlePlayable = () => {
    if (videoError) return;

    setVideoLoaded(true);
    const video = videoRef.current;
    if (!video) return;

    // Immediate play for cached videos, small delay for multi-video to prevent CPU spikes
    const playDelay = isCached ? 0 : (videoCount >= 3 ? Math.random() * 200 : 0);
    setTimeout(() => {
      video.play().catch(console.error);
    }, playDelay);
  };

  const handleVideoError = () => {
    if (!retryAttempted) {
      setRetryAttempted(true);
      setVideoLoaded(false);
      setVideoError(false);
      setSourceVersion((v) => v + 1);
      return;
    }

    console.error('Video failed to load after retry:', videoSrc);
    setVideoError(true);
  };

  const handleManualReload = () => {
    setVideoLoaded(false);
    setVideoError(false);
    setRetryAttempted(false);
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
  
  return (
    <div className="relative bg-white w-full h-full overflow-hidden">
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
        autoPlay
        preload="auto"
        controls={false}
        disablePictureInPicture
        crossOrigin={undefined}
        onCanPlay={handlePlayable}
        onLoadedData={handlePlayable}
        onError={handleVideoError}
      />
      
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
      {(!videoLoaded && !videoError) && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900 text-white">
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-white mx-auto mb-4"></div>
            <h3 className="text-2xl font-bold mb-4">{assignment.video.title}</h3>
            <p className="text-gray-400 text-lg">Loading video...</p>
          </div>
        </div>
      )}
      
      {videoError && (
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
    </div>
  );
}
