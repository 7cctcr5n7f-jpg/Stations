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
  const zoom = parseFloat(assignment.zoomLevel || "1");
  const verticalPos = parseFloat(assignment.verticalPosition || "0");
  const [videoSrc, setVideoSrc] = useState(assignment.video.url);
  const [isCached, setIsCached] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  // Initialize video with direct URL loading (no caching for stability)
  useEffect(() => {
    // Always use original URL for maximum stability
    setVideoSrc(assignment.video.url);
    setIsCached(false);
  }, [assignment.video.id, assignment.video.url]);

  useEffect(() => {
    if (videoRef.current) {
      const video = videoRef.current;
      
      const handleCanPlay = () => {
        setVideoLoaded(true);
        // Immediate play for cached videos, small delay for multi-video to prevent CPU spikes
        const playDelay = isCached ? 0 : (videoCount >= 3 ? Math.random() * 200 : 0);
        setTimeout(() => {
          video.play().catch(console.error);
        }, playDelay);
      };
      
      const handleLoadedData = () => {
        // Video is fully loaded and ready for smooth playback
        setVideoLoaded(true);
      };
      
      const handleError = (e: Event) => {
        console.error('Video failed to load:', videoSrc);
        setVideoError(true);
      };

      video.addEventListener('canplay', handleCanPlay);
      video.addEventListener('loadeddata', handleLoadedData);
      video.addEventListener('error', handleError);
      
      return () => {
        video.removeEventListener('canplay', handleCanPlay);
        video.removeEventListener('loadeddata', handleLoadedData);
        video.removeEventListener('error', handleError);
      };
    }
  }, [videoSrc, isCached, videoCount]);



  // Calculate height based on video count - only 3+ videos use half height, 1-2 videos use full height
  const containerHeight = videoCount >= 3 ? '50vh' : '100vh';
  const isCompactMode = videoCount >= 3;
  
  return (
    <div className="relative bg-white w-full h-full overflow-hidden" style={{ height: containerHeight }}>
      <video
        ref={videoRef}
        src={videoSrc}
        className={`${videoLoaded ? 'block' : 'hidden'} w-full`}
        style={{
          height: containerHeight,
          objectFit: 'contain',
          objectPosition: 'center',
          transform: `scale(${zoom}) translateY(${verticalPos}px)`,
          transformOrigin: 'center'
        }}
        loop
        muted
        playsInline
        autoPlay
        preload="auto"
        controls={false}
        disablePictureInPicture
      />
      
      {/* Video Title - Top Center */}
      <div className={`absolute ${isCompactMode ? 'top-3' : 'top-5'} left-1/2 -translate-x-1/2 z-10 w-full px-4 flex justify-center pointer-events-none`}>
        <div className={`bg-white/90 backdrop-blur-sm rounded-lg ${isCompactMode ? 'px-3 py-1.5' : 'px-6 py-3'} text-center max-w-[65%]`}>
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
              ${isCompactMode ? 'min-w-[56px]' : 'min-w-[76px]'}
            `}>
              {/* Reps block */}
              {hasReps && (
                <div className={`flex flex-col items-center justify-center ${isCompactMode ? 'px-3 pt-2.5 pb-2' : 'px-4 pt-4 pb-3'}`}>
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
                    <span className={`font-bold text-white text-center leading-tight uppercase tracking-wide ${isCompactMode ? 'text-xs' : 'text-sm'}`}>
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
                  <span className={`text-white/60 font-medium uppercase tracking-widest text-center ${isCompactMode ? 'text-[9px]' : 'text-[10px]'}`}>
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
            <p className="text-red-400 text-lg">Video failed to load</p>
          </div>
        </div>
      )}
    </div>
  );
}
