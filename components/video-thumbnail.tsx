"use client"

import { useState, useRef, useEffect } from "react";
import { AlertTriangle, Play, Pause } from "lucide-react";

interface VideoThumbnailProps {
  video: {
    id: number;
    title: string;
    url: string;
  };
  size?: "small" | "medium" | "large";
  showPlayButton?: boolean;
}

export default function VideoThumbnail({ 
  video, 
  size = "small", 
  showPlayButton = true 
}: VideoThumbnailProps) {
  const [hasError, setHasError] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const dimensions = {
    small: "w-12 h-9",
    medium: "w-16 h-12", 
    large: "w-24 h-18"
  };

  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    const handleCanPlay = () => {
      setIsLoaded(true);
      // Use first available frame for faster loading
    };

    const handleError = () => {
      console.error(`Video thumbnail error for: ${video.title} (${video.url})`);
      setHasError(true);
    };

    videoEl.addEventListener('canplay', handleCanPlay);
    videoEl.addEventListener('error', handleError);

    return () => {
      videoEl.removeEventListener('canplay', handleCanPlay);
      videoEl.removeEventListener('error', handleError);
    };
  }, [video.url, video.title]);

  const togglePlayback = () => {
    const videoEl = videoRef.current;
    if (!videoEl || hasError) return;

    if (videoEl.paused) {
      videoEl.play();
      setIsPlaying(true);
    } else {
      videoEl.pause();
      // Don't seek to keep loading fast
      videoEl.currentTime = 0;
      setIsPlaying(false);
    }
  };

  if (hasError) {
    return (
      <div className={`${dimensions[size]} bg-red-100 border border-red-300 rounded overflow-hidden flex items-center justify-center`}>
        <div className="text-center">
          <AlertTriangle className="h-4 w-4 text-red-500 mx-auto" />
          <div className="text-xs text-red-600 mt-1">Error</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative ${dimensions[size]} bg-gray-900 rounded overflow-hidden group cursor-pointer`}>
      <video 
        ref={videoRef}
        src={video.url} 
        className="w-full h-full object-cover"
        muted
        preload="metadata"
        onError={() => setHasError(true)}
      />
      
      {!isLoaded && (
        <div className="absolute inset-0 bg-gray-700 flex items-center justify-center">
          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
        </div>
      )}

      {showPlayButton && isLoaded && !hasError && (
        <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={togglePlayback}
            className="text-white hover:text-blue-300 transition-colors"
          >
            {isPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </button>
        </div>
      )}
      
      {hasError && (
        <div className="absolute inset-0 bg-red-500 bg-opacity-20 flex items-center justify-center">
          <AlertTriangle className="h-6 w-6 text-red-500" />
        </div>
      )}
    </div>
  );
}