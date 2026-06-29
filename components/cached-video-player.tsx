import { useState, useEffect, useRef } from "react";
import { AlertTriangle, Wifi, WifiOff } from "lucide-react";
import { enhancedVideoCache } from "./enhanced-video-cache";

interface CachedVideoPlayerProps {
  videoId: number;
  originalUrl: string;
  title: string;
  className?: string;
  autoPlay?: boolean;
  loop?: boolean;
  muted?: boolean;
  onError?: () => void;
}

export default function CachedVideoPlayer({
  videoId,
  originalUrl,
  title,
  className = "",
  autoPlay = true,
  loop = true,
  muted = true,
  onError
}: CachedVideoPlayerProps) {
  const [videoSrc, setVideoSrc] = useState<string>(originalUrl);
  const [isUsingCache, setIsUsingCache] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const loadVideo = async () => {
      try {
        setIsLoading(true);
        
        // Try to get cached version first
        const cachedUrl = await enhancedVideoCache.getVideoFromCache(videoId);
        
        if (cachedUrl) {
          console.log(`Using cached video for ${title}`);
          setVideoSrc(cachedUrl);
          setIsUsingCache(true);
        } else {
          console.log(`Using original URL for ${title}, will cache in background`);
          setVideoSrc(originalUrl);
          setIsUsingCache(false);
          
          // Cache video in background for future use
          enhancedVideoCache.cacheVideo(videoId, title, originalUrl).catch(error => {
            console.error(`Background caching failed for ${title}:`, error);
          });
        }
      } catch (error) {
        console.error(`Failed to load video ${title}:`, error);
        setVideoSrc(originalUrl);
        setIsUsingCache(false);
      } finally {
        setIsLoading(false);
      }
    };

    loadVideo();
  }, [videoId, originalUrl, title]);

  const handleVideoError = () => {
    console.error(`Video playback error for ${title}`);
    setHasError(true);
    
    if (isUsingCache) {
      // If cached video fails, fallback to original URL
      console.log(`Cached video failed, falling back to original URL for ${title}`);
      setVideoSrc(originalUrl);
      setIsUsingCache(false);
      setHasError(false);
    } else if (onError) {
      onError();
    }
  };

  const handleVideoLoad = () => {
    setHasError(false);
    setIsLoading(false);
  };

  if (hasError && !isUsingCache) {
    return (
      <div className={`bg-red-100 border border-red-300 rounded flex items-center justify-center ${className}`}>
        <div className="text-center p-4">
          <AlertTriangle className="h-8 w-8 text-red-500 mx-auto mb-2" />
          <div className="text-sm text-red-600">
            Video Error
            <br />
            <span className="text-xs">{title}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      {isLoading && (
        <div className="absolute inset-0 bg-gray-900 flex items-center justify-center z-10">
          <div className="text-center text-white">
            <div className="w-8 h-8 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
            <div className="text-sm">Loading...</div>
          </div>
        </div>
      )}
      
      <video
        ref={videoRef}
        src={videoSrc}
        className="w-full h-full object-cover"
        autoPlay={autoPlay}
        loop={loop}
        muted={muted}
        playsInline
        onError={handleVideoError}
        onLoadedData={handleVideoLoad}
        onCanPlay={handleVideoLoad}
      />
      
      {/* Cache status indicator */}
      <div className="absolute top-2 right-2 z-20">
        {isUsingCache ? (
          <div className="bg-green-500 text-white text-xs px-2 py-1 rounded-full flex items-center space-x-1">
            <WifiOff className="h-3 w-3" />
            <span>Cached</span>
          </div>
        ) : (
          <div className="bg-blue-500 text-white text-xs px-2 py-1 rounded-full flex items-center space-x-1">
            <Wifi className="h-3 w-3" />
            <span>Online</span>
          </div>
        )}
      </div>

      {hasError && isUsingCache && (
        <div className="absolute top-8 right-2 bg-yellow-500 text-white text-xs px-2 py-1 rounded">
          Fallback Mode
        </div>
      )}
    </div>
  );
}