"use client"

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface VideoPopupProps {
  videoUrl: string;
  videoTitle: string;
  onClose: () => void;
}

export default function VideoPopup({ videoUrl, videoTitle, onClose }: VideoPopupProps) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    
    document.addEventListener('keydown', handleEscape);
    document.body.style.overflow = 'hidden';
    
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [onClose]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return createPortal(
    <div 
      className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4"
      onClick={handleBackdropClick}
    >
      <div className="relative bg-black rounded-lg max-w-3xl w-full">
        <button
          onClick={onClose}
          className="absolute -top-10 right-0 text-white hover:text-gray-300 bg-black/50 rounded p-2"
          aria-label="Close video"
        >
          <X className="h-5 w-5" />
        </button>
        
        <video
          key={videoUrl}
          src={videoUrl}
          className="w-full rounded-lg"
          controls
          autoPlay
          muted
          loop
          playsInline
          style={{ maxHeight: '80vh' }}
        />
        
        <div className="p-3 text-white text-center text-sm bg-black/50 rounded-b-lg">
          {videoTitle}
        </div>
      </div>
    </div>,
    document.body
  );
}