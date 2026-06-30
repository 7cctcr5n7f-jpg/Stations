"use client"

import { useState } from "react";
import { Play, Film } from "lucide-react";

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
  const [thumbError, setThumbError] = useState(false);

  const dimensions = {
    small: "w-12 h-9",
    medium: "w-16 h-12", 
    large: "w-24 h-18"
  };

  // Use the R2 thumbnail URL stored in the DB. If absent or broken, show a
  // neutral placeholder — never run a HEAD check against the video URL, as
  // that triggers a CORS preflight that R2 public buckets block.
  const thumbnailSrc = video.thumbnailUrl && !thumbError ? video.thumbnailUrl : null;

  return (
    <div 
      className={`relative ${dimensions[size]} bg-gray-100 rounded overflow-hidden group ${onClick ? 'cursor-pointer hover:ring-2 hover:ring-blue-400 hover:ring-opacity-60' : ''} ${className}`}
      onClick={onClick}
    >
      {thumbnailSrc ? (
        <img 
          src={thumbnailSrc}
          alt={video.title}
          className="w-full h-full object-cover"
          loading="lazy"
          decoding="async"
          onError={() => setThumbError(true)}
        />
      ) : (
        // Neutral placeholder — thumbnail not available, but video may still work
        <div className="w-full h-full flex items-center justify-center bg-gray-100">
          <Film className="h-4 w-4 text-gray-300" />
        </div>
      )}

      {showPlayButton && onClick && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <Play className="h-4 w-4 text-white" />
        </div>
      )}
    </div>
  );
}
