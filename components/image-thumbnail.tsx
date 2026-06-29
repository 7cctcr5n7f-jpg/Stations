"use client"

import { useState, useEffect } from "react";
import { AlertTriangle, Play, FileX } from "lucide-react";

interface ImageThumbnailProps {
  video: {
    id: number;
    title: string;
    url: string;
    thumbnailUrl?: string | null;
  };
  size?: "small" | "medium" | "large";
  showPlayButton?: boolean;
  onClick?: () => void;
  className?: string;
}

export default function ImageThumbnail({ 
  video, 
  size = "small", 
  showPlayButton = true,
  onClick,
  className = ""
}: ImageThumbnailProps) {
  const [hasError, setHasError] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [videoFileExists, setVideoFileExists] = useState<boolean | null>(null);

  const dimensions = {
    small: "w-12 h-9",
    medium: "w-16 h-12", 
    large: "w-24 h-18"
  };

  // Create a simple thumbnail URL from video ID
  const thumbnailUrl = video.thumbnailUrl || `/uploads/thumbnails/thumbnail_${video.id}.jpg`;

  // Check if video file exists
  useEffect(() => {
    const checkVideoFile = async () => {
      try {
        const response = await fetch(video.url, { method: 'HEAD' });
        setVideoFileExists(response.ok);
      } catch {
        setVideoFileExists(false);
      }
    };
    checkVideoFile();
  }, [video.url]);

  const handleImageError = () => {
    setHasError(true);
  };

  const handleImageLoad = () => {
    setIsLoaded(true);
  };

  // Show error state for missing video files
  if (videoFileExists === false) {
    return (
      <div 
        className={`${dimensions[size]} bg-red-100 border-2 border-red-300 rounded overflow-hidden flex items-center justify-center ${onClick ? 'cursor-pointer hover:bg-red-50' : ''} ${className}`}
        onClick={onClick}
      >
        <div className="text-center p-1">
          <FileX className="h-4 w-4 text-red-600 mx-auto mb-1" />
          <div className="text-red-700 text-xs font-medium leading-tight">
            Missing File
          </div>
        </div>
      </div>
    );
  }

  if (hasError) {
    // Show warning state for missing thumbnails but existing video
    return (
      <div 
        className={`${dimensions[size]} bg-yellow-100 border-2 border-yellow-300 rounded overflow-hidden flex items-center justify-center ${onClick ? 'cursor-pointer hover:bg-yellow-50' : ''} ${className}`}
        onClick={onClick}
      >
        <div className="text-center p-1">
          <AlertTriangle className="h-4 w-4 text-yellow-600 mx-auto mb-1" />
          <div className="text-yellow-700 text-xs font-medium leading-tight">
            No Thumbnail
          </div>
        </div>
      </div>
    );
  }

  return (
    <div 
      className={`relative ${dimensions[size]} bg-gray-200 rounded overflow-hidden group ${onClick ? 'cursor-pointer hover:ring-2 hover:ring-blue-300 hover:ring-opacity-50' : ''} ${className}`}
      onClick={onClick}
    >
      <img 
        src={thumbnailUrl}
        alt={video.title}
        className="w-full h-full object-cover"
        onError={handleImageError}
        onLoad={handleImageLoad}
      />
      
      {!isLoaded && !hasError && (
        <div className="absolute inset-0 bg-gray-300 flex items-center justify-center">
          <div className="w-3 h-3 border-2 border-gray-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
      )}

      {showPlayButton && isLoaded && (
        <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <Play className="h-4 w-4 text-white" />
        </div>
      )}
    </div>
  );
}