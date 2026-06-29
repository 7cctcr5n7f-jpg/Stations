"use client"

import { X } from "lucide-react";

interface VideoPreviewProps {
  video: { id: number; title: string; url: string } | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function SimpleVideoPreview({ video, isOpen, onClose }: VideoPreviewProps) {
  if (!isOpen || !video) return null;

  const handleVideoError = () => {
    console.log('Video failed to load:', video.url);
  };

  const handleClose = () => {
    try {
      onClose();
    } catch (error) {
      console.log('Error closing video preview:', error);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
      onClick={handleClose}
    >
      <div 
        className="relative bg-black rounded-lg max-w-2xl w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={handleClose}
          className="absolute top-2 right-2 z-10 bg-black/50 text-white hover:bg-black/70 rounded p-1"
        >
          <X className="h-4 w-4" />
        </button>
        
        <video
          src={video.url}
          className="w-full rounded-lg"
          muted
          loop
          playsInline
          controls
          autoPlay
          style={{ maxHeight: '70vh' }}
          onError={handleVideoError}
        />
        
        <div className="p-2 text-white text-sm text-center">
          {video.title}
        </div>
      </div>
    </div>
  );
}