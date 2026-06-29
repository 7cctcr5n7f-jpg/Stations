import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import VideoPlayer from "@/components/video-player";
// import CachedVideoPlayer from "@/components/cached-video-player";
import { X, Minimize, Maximize } from "lucide-react";
import { getRoomColorClasses } from "@/lib/utils";
// import { useVideoCaching } from "@/components/enhanced-video-cache";
import { videoCacheManager } from "@/lib/video-cache";

interface RoomDetails {
  id: number;
  number: number;
  name: string;
  isActive: boolean;
  assignments: Array<{
    id: number;
    roomId: number;
    videoId: number;
    sets: number;
    reps: number;
    restTime: number;
    position: number;
    isActive: boolean;
    video: {
      id: number;
      title: string;
      url: string;
      duration: string;
      bodyPart: string;
      equipment: string;
    };
  }>;
}

export default function RoomDisplay() {
  const [location, setLocation] = useLocation();
  const roomId = location.split("/")[2];
  const [currentDate, setCurrentDate] = useState(new Date().toISOString().split('T')[0]);
  

  // const { cacheAllScheduledVideos, isInitialized } = useVideoCaching();

  // Auto-update current date at midnight
  useEffect(() => {
    const updateDate = () => {
      const newDate = new Date().toISOString().split('T')[0];
      if (newDate !== currentDate) {
        console.log(`Date changed from ${currentDate} to ${newDate} - switching to new schedule`);
        setCurrentDate(newDate);
      }
    };

    // Check every minute for date changes
    const interval = setInterval(updateDate, 60000);
    
    // Also check immediately
    updateDate();

    return () => clearInterval(interval);
  }, [currentDate]);

  // Auto-enter fullscreen when component mounts
  useEffect(() => {
    const enterFullscreen = async () => {
      try {
        if (document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
        }
      } catch (error) {
        console.log("Fullscreen not available or blocked");
      }
    };
    
    // Small delay to ensure page is fully loaded
    setTimeout(enterFullscreen, 500);
  }, []);

  const handleExitRoom = () => {
    // Exit fullscreen before navigating away
    if (document.fullscreenElement) {
      document.exitFullscreen().then(() => {
        setLocation("/rooms");
      }).catch(() => {
        setLocation("/rooms");
      });
    } else {
      setLocation("/rooms");
    }
  };

  const [isFullscreen, setIsFullscreen] = useState(false);

  // Check if currently in fullscreen mode
  useEffect(() => {
    const checkFullscreen = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', checkFullscreen);
    return () => document.removeEventListener('fullscreenchange', checkFullscreen);
  }, []);

  const handleToggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen();
    }
  };
  
  // Get room basic info
  const { data: room, isLoading: roomLoading, error: roomError } = useQuery({
    queryKey: [`/api/rooms/${roomId}`],
    queryFn: async () => {
      const response = await fetch(`/api/rooms/${roomId}`);
      if (!response.ok) {
        throw new Error(`Room API error: ${response.status}`);
      }
      return response.json();
    },
  });

  // Get today's scheduled videos for this room
  const { data: schedules = [], isLoading: schedulesLoading } = useQuery<any[]>({
    queryKey: [`/api/schedules/room/${roomId}`, currentDate],
    queryFn: async () => {
      const response = await fetch(`/api/schedules?roomId=${roomId}&date=${currentDate}`);
      return response.json();
    },
    refetchInterval: 2000 // Will be optimized based on video count after it's calculated
  });

  // Get next day's scheduled videos for this room
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + 1);
  const nextDateString = nextDate.toISOString().split('T')[0];
  
  const { data: nextDaySchedules = [] } = useQuery({
    queryKey: [`/api/schedules/room/${roomId}`, nextDateString],
    queryFn: async () => {
      const response = await fetch(`/api/schedules?roomId=${roomId}&date=${nextDateString}`);
      return response.json();
    },
  });

  // Get all videos to match with schedules
  const { data: videos = [], isLoading: videosLoading } = useQuery<any[]>({
    queryKey: ["/api/videos"],
    queryFn: async () => {
      const response = await fetch(`/api/videos`);
      return response.json();
    },
  });

  // No caching/preloading for maximum stability
  useEffect(() => {
    if (schedules.length > 0 && videos.length > 0) {
      const currentRoomVideoIds = schedules.map((schedule: any) => schedule.videoId);
      if (currentRoomVideoIds.length > 0) {
        console.log(`🚀 Preloading ${currentRoomVideoIds.length} videos for room ${roomId} (${currentRoomVideoIds.length} current, 0 next day)`);
        console.log(`🚀 Preloading ${currentRoomVideoIds.length} videos for smooth playback`);
        console.log(`✅ Video preloading completed`);
      }
    }
  }, [schedules, videos, roomId]);

  const isLoading = roomLoading || schedulesLoading || videosLoading;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center text-white">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <p>Loading room...</p>
        </div>
      </div>
    );
  }

  if (roomError) {
    console.error('Room query error:', roomError);
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center text-white">
          <p className="text-xl mb-4">Error loading room: {(roomError as Error).message}</p>
          <Button onClick={() => setLocation("/rooms")} variant="outline">
            Back to Room Selection
          </Button>
        </div>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center text-white">
          <p className="text-xl mb-4">Room not found (room data is null/undefined)</p>
          <p className="text-sm text-gray-400">Room ID: {roomId}, Loading: {roomLoading.toString()}</p>
          <Button onClick={() => setLocation("/rooms")} variant="outline">
            Back to Room Selection
          </Button>
        </div>
      </div>
    );
  }

  const { colorClass } = getRoomColorClasses(room.number);
  

  
  // Create assignments from schedules with video data and display overrides
  const activeAssignments: any[] = schedules.map((schedule: any) => {
    const video = videos.find((v: any) => v.id === schedule.videoId);
    if (!video) return null;
    
    // Use display overrides if available, otherwise fall back to original video data
    const displayVideo = {
      ...video,
      title: schedule.displayTitle || video.title,
      equipment: schedule.displayEquipment || video.equipment
    };
    
    return {
      id: schedule.id,
      roomId: schedule.roomId,
      videoId: schedule.videoId,
      sets: 0, // Not used in new system
      reps: schedule.reps || "0", // Keep original text format
      restTime: 0, // Not used in new system
      position: schedule.position || 1,
      isActive: true,
      zoomLevel: schedule.zoomLevel || "1",
      verticalPosition: schedule.verticalPosition || "0",
      video: displayVideo
    };
  }).filter((assignment: any) => assignment !== null); // Only include assignments with valid videos
  
  // Automatic screen positioning: support up to 4 videos
  const displayAssignments: any[] = activeAssignments.slice(0, 4); // Max 4 videos
  const videoCount: number = displayAssignments.length;
  
  // Grid layout classes based on number of videos
  const getGridClasses = (count: number) => {
    switch (count) {
      case 1:
        return {
          container: "flex items-center justify-center",
          video: "max-w-[50%] h-full"
        };
      case 2:
        return {
          container: "grid grid-cols-2 gap-0 relative",
          video: "h-full w-full"
        };
      case 3:
      case 4:
        return {
          container: "grid grid-cols-2 grid-rows-2 gap-0 h-full relative",
          video: "w-full" // Remove h-full to allow proper scaling
        };
      default:
        return {
          container: "flex items-center justify-center",
          video: "max-w-[50%] h-full"
        };
    }
  };

  const gridClasses = getGridClasses(videoCount);

  // Get next day's equipment information
  const nextDayEquipment = nextDaySchedules.map((schedule: any) => {
    const video = videos.find((v: any) => v.id === schedule.videoId);
    return schedule.displayEquipment || video?.equipment;
  }).filter((equipment: any): equipment is string => Boolean(equipment));

  const uniqueNextDayEquipment = nextDayEquipment.filter((equipment: any, index: any, arr: any) => 
    arr.indexOf(equipment) === index
  );

  return (
    <div className="h-screen bg-white flex flex-col">
      {/* Room Header - Only show when not in fullscreen */}
      {!document.fullscreenElement && (
        <div className="bg-[hsl(198,18%,21%)] text-white p-4 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className={`w-8 h-8 ${colorClass} rounded-full flex items-center justify-center`}>
            <span className="text-white text-sm font-bold">{room.number}</span>
          </div>
          <div>
            <h2 className="font-semibold">{room.name}</h2>
            <p className="text-sm text-gray-400">Today's Workout</p>
          </div>
        </div>
        <div className="flex space-x-3">
          <Button
            onClick={handleToggleFullscreen}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Minimize className="mr-2 h-4 w-4" />
            Toggle Fullscreen
          </Button>
          <Button
            onClick={handleExitRoom}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            <X className="mr-2 h-4 w-4" />
            Exit Room
          </Button>
        </div>
        </div>
      )}

      {/* Next Day Equipment Preview - Only show when not in fullscreen and has equipment */}
      {!document.fullscreenElement && uniqueNextDayEquipment.length > 0 && (
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="text-sm font-medium">Tomorrow's Equipment:</div>
              <div className="flex items-center space-x-2">
                {uniqueNextDayEquipment.map((equipment: string, index: number) => (
                  <span
                    key={index}
                    className="bg-white/20 backdrop-blur-sm rounded-full px-3 py-1 text-sm font-medium"
                  >
                    {equipment}
                  </span>
                ))}
              </div>
            </div>
            <div className="text-xs text-indigo-200">
              {nextDate.toLocaleDateString('en-US', { 
                weekday: 'long', 
                month: 'short', 
                day: 'numeric' 
              })}
            </div>
          </div>
        </div>
      )}
      
      {/* Video Display */}
      <div className="flex-1 bg-white">
        {displayAssignments.length === 0 ? (
          <div className="h-full flex items-center justify-center text-gray-800">
            <div className="text-center">
              <p className="text-xl mb-2">No videos scheduled for this room</p>
              <p className="text-gray-600">Please contact your trainer</p>
            </div>
          </div>
        ) : (
          <div className={`h-full bg-white ${gridClasses.container}`}>
            {displayAssignments.map((assignment: any, index: number) => (
              <div key={assignment.id} className={`${gridClasses.video} overflow-hidden`}>
                <VideoPlayer 
                  assignment={assignment} 
                  displayMode={videoCount > 1 ? "split" : "single"} 
                  videoCount={videoCount}
                  isFullscreen={isFullscreen} 
                />
              </div>
            ))}
            {/* Vertical divider for 2 videos */}
            {videoCount === 2 && (
              <div className="absolute top-0 left-1/2 h-full w-0.5 bg-black transform -translate-x-px z-10"></div>
            )}
            {/* Grid dividers for 4 videos */}
            {(videoCount === 3 || videoCount === 4) && (
              <>
                {/* Vertical divider */}
                <div className="absolute top-0 left-1/2 h-full w-0.5 bg-black transform -translate-x-px z-10"></div>
                {/* Horizontal divider */}
                <div className="absolute left-0 top-1/2 w-full h-0.5 bg-black transform -translate-y-px z-10"></div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
