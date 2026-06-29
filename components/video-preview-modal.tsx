import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Play, Pause, Volume2, VolumeX, X } from "lucide-react";

interface Video {
  id: number;
  title: string;
  url: string;
}

interface VideoPreviewModalProps {
  video: Video | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function VideoPreviewModal({ video, isOpen, onClose }: VideoPreviewModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);

  // Simple auto-play when modal opens
  useEffect(() => {
    if (isOpen && video && videoRef.current) {
      const timer = setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.play().catch(() => {
            console.log('Auto-play blocked by browser');
          });
        }
      }, 500);
      
      return () => clearTimeout(timer);
    }
  }, [isOpen, video]);

  // Reset when closing
  useEffect(() => {
    if (!isOpen && videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
      setIsPlaying(false);
      setIsMuted(true);
    }
  }, [isOpen]);

  const handlePlay = () => setIsPlaying(true);
  const handlePause = () => setIsPlaying(false);

  const togglePlayPause = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play().catch(() => {});
      }
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  if (!video) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl w-full p-0" aria-describedby="video-preview">
        <DialogTitle className="sr-only">Video Preview: {video ? video.title : 'Video'}</DialogTitle>
        <div className="relative bg-black rounded-lg overflow-hidden">
          {/* Close Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="absolute top-2 right-2 z-10 bg-black bg-opacity-50 text-white hover:bg-opacity-70"
          >
            <X className="h-4 w-4" />
          </Button>

          {/* Video Player */}
          <div className="aspect-video relative group">
            {video && (
              <video
                ref={videoRef}
                src={video.url}
                className="w-full h-full object-contain"
                muted={isMuted}
                loop
                controls={false}
                playsInline
                onPlay={handlePlay}
                onPause={handlePause}
                onError={() => console.log('Video load error')}
              />
            )}

            {/* Simple Controls Overlay */}
            <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all duration-200">
              {/* Center Play Button */}
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="lg"
                  onClick={togglePlayPause}
                  className="bg-black bg-opacity-50 text-white hover:bg-opacity-70 rounded-full w-16 h-16"
                >
                  {isPlaying ? (
                    <Pause className="h-8 w-8" />
                  ) : (
                    <Play className="h-8 w-8 ml-1" />
                  )}
                </Button>
              </div>

              {/* Bottom Controls */}
              <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-white text-sm font-medium">{video ? video.title : ''}</span>
                  </div>
                  
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={toggleMute}
                    className="text-white hover:bg-white hover:bg-opacity-20"
                  >
                    {isMuted ? (
                      <VolumeX className="h-4 w-4" />
                    ) : (
                      <Volume2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div id="video-preview" className="sr-only">
          Video preview for {video ? video.title : 'selected video'}
        </div>
      </DialogContent>
    </Dialog>
  );
}