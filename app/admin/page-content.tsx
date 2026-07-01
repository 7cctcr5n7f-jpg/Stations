"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { QueryClientProvider, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryClient as sharedQueryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import VideoAssignmentModal from "@/components/video-assignment-modal";
import VideoUploadModal from "@/components/video-upload-modal";
import VideoEditModal from "@/components/video-edit-modal";
// Removed VideoPopup import - using simple HTML popup instead
import { SimpleBulkUploadModal } from "@/components/simple-bulk-upload-modal";
import CacheManager from "@/components/cache-manager";
import VideoHealthDashboard from "@/components/video-health-dashboard";
import VideoThumbnail from "@/components/video-thumbnail";
import ImageThumbnail from "@/components/image-thumbnail";
import EnhancedCacheDashboard from "@/components/enhanced-cache-dashboard";
import { ExerciseDictionary } from "@/components/exercise-dictionary";
import { WorkoutBuilder } from "@/components/workout-builder/workout-builder";
import { BuilderConfig } from "@/components/workout-builder/builder-config";
import { UnknownTermsBanner, UnknownTermsReviewDialog, type UnknownTerm } from "@/components/unknown-terms-review";
import { 
  Dumbbell, LogOut, TrendingUp, Play, Video as VideoIcon, Calendar, 
  DoorOpen, Plus, Trash2, Edit, Clock, CheckCircle, Download, Wifi, WifiOff,
  Monitor, ZoomIn, ZoomOut, Save, ChevronsUpDown, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, GripVertical, X, Copy,
  Sparkles, AlertCircle, Loader2, Search, CalendarDays, BookOpen, Image,
  Wand2, Settings2
} from "lucide-react";
import { getIntensityStyle, INTENSITY_LEVELS } from "@/lib/intensity";
const tenRoundsLogo = "/logo.png";
import { getRoomColorClasses, formatTimeAgo, formatTimeAgoShort, getDayOfWeek, capitalizeFirst } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { videoCacheManager } from "@/lib/video-cache";
import { EditableSelect } from "@/components/editable-select";
import { SimpleMultiSelect } from "@/components/simple-multi-select";
import { SearchableSelect } from "@/components/searchable-select";
import { VideoOptionsButton } from "@/components/video-options-manager";
import type { Room, Video, RoomAssignment, Schedule } from "@/lib/shared/schema";

interface Stats {
  activeRooms: number;
  videosInUse: number;
  totalVideos: number;
  todaySchedules: number;
}

interface RoomWithAssignments extends Room {
  assignments: Array<Schedule & { video: Video }>;
}

const VALID_TABS = ["liveview", "library", "schedule", "cache", "dictionary"] as const;

function TrainerDashboardInner() {
  const router = useRouter();
  const setLocation = (path: string) => router.push(path);
  // Persist the selected tab to the URL hash so it survives re-renders,
  // background refetches, and full component remounts (which previously
  // snapped the uncontrolled Tabs back to "liveview").
  const [activeTab, setActiveTab] = useState<string>("liveview");

  // Restore the tab from the URL hash on mount and whenever the hash changes.
  useEffect(() => {
    const syncFromHash = () => {
      const hash = window.location.hash.replace("#", "");
      if ((VALID_TABS as readonly string[]).includes(hash)) {
        setActiveTab((prev) => (prev !== hash ? hash : prev));
      }
    };
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, []);

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    if (typeof window !== "undefined") {
      // replaceState keeps the selection in the URL without adding history
      // entries or causing the page to scroll/jump.
      window.history.replaceState(null, "", `#${value}`);
    }
  };

  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<number | null>(null);
  const [isAssignmentModalOpen, setIsAssignmentModalOpen] = useState(false);
  const [isVideoUploadModalOpen, setIsVideoUploadModalOpen] = useState(false);
  const [isSimpleBulkUploadModalOpen, setIsSimpleBulkUploadModalOpen] = useState(false);
  const [isVideoEditModalOpen, setIsVideoEditModalOpen] = useState(false);
  const [editingVideo, setEditingVideo] = useState<Video | null>(null);
  // Simple video popup without React state
  const [videoFilters, setVideoFilters] = useState({
    bodyPart: [] as string[],
    secondaryMuscle: [] as string[],
    equipment: [] as string[],
    category: [] as string[],
    search: "",
    lastUsed: "",
    scheduled: "",
    intensity: "",
    needsReview: false,
  });
  // AI metadata generation progress
  const [aiProgress, setAiProgress] = useState<{
    running: boolean;
    processed: number;
    total: number;
  } | null>(null);
  // Bulk thumbnail generation progress
  const [thumbProgress, setThumbProgress] = useState<{
    running: boolean;
    processed: number;
    total: number;
  } | null>(null);
  // Unknown abbreviations surfaced by the AI dictionary lookup
  const [unknownTerms, setUnknownTerms] = useState<UnknownTerm[]>([]);
  const [showTermsReview, setShowTermsReview] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date().toISOString().split('T')[0]);

  // Auto-update current date at midnight only if user is on today's date
  useEffect(() => {
    const updateDate = () => {
      const todayDate = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      // Only auto-update if the user is currently viewing today's date or yesterday's date
      // This prevents interrupting users who are manually working on future dates
      if (todayDate !== currentDate && (currentDate === yesterday || currentDate === todayDate)) {
        console.log(`Admin dashboard: Date changed from ${currentDate} to ${todayDate} - switching to new schedule`);
        setCurrentDate(todayDate);
      }
    };

    // Check every minute for date changes
    const interval = setInterval(updateDate, 60000);
    
    return () => clearInterval(interval);
  }, [currentDate]);
  const [videoCacheStatus, setVideoCacheStatus] = useState<{[key: number]: boolean}>({});
  const [pendingChanges, setPendingChanges] = useState<{[key: string]: any}>({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [videoChanges, setVideoChanges] = useState<{[key: number]: any}>({});
  const [scheduleChanges, setScheduleChanges] = useState<{[key: number]: any}>({});
  const [liveViewZoom, setLiveViewZoom] = useState<{[key: number]: number}>({});
  const [liveViewVideoZoom, setLiveViewVideoZoom] = useState<{[key: number]: number}>({});
  const [liveViewVerticalPosition, setLiveViewVerticalPosition] = useState<{[key: number]: number}>({});
  const [liveViewChanges, setLiveViewChanges] = useState<{[key: string]: any}>({});
  const [inlineEditingField, setInlineEditingField] = useState<{videoId: number, field: string} | null>(null);
  const [draggedSchedule, setDraggedSchedule] = useState<any>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();


  const { data: stats } = useQuery<Stats>({
    queryKey: ["/api/stats"],
  });

  const { data: rooms } = useQuery<Room[]>({
    queryKey: ["/api/rooms"],
  });

  const { data: videos } = useQuery<Video[]>({
    queryKey: ["/api/videos"],
  });

  const { data: videoOptions } = useQuery<{bodyParts: string[], secondaryMuscles: string[], equipment: string[]}>({
    queryKey: ["/api/video-options"],
  });

  // Function to derive categories from primary muscle and equipment (can return multiple)
  const deriveCategories = (primaryMuscle: string, equipment: string): string[] => {
    const muscle = primaryMuscle?.toLowerCase() || '';
    const equip = equipment?.toLowerCase() || '';
    const categories: string[] = [];
    
    if (muscle.includes('legs')) categories.push('Legs');
    if (muscle.includes('chest')) categories.push('Chest');
    if (muscle.includes('back')) categories.push('Back');
    if (muscle.includes('triceps')) categories.push('Triceps');
    if (muscle.includes('biceps')) categories.push('Biceps');
    if (muscle.includes('shoulders')) categories.push('Shoulders');
    if (muscle.includes('core')) categories.push('Core');
    if (muscle.includes('cardio') || equip.includes('boxing')) categories.push('HIIT');
    
    return categories.length > 0 ? categories : ['Missing'];
  };

  // Disabled cache system to prevent unhandled rejections
  // useEffect(() => {
  //   // Cache system disabled for now
  // }, [videos]);

  const { data: roomAssignments } = useQuery<RoomAssignment[]>({
    queryKey: ["/api/room-assignments"],
  });

  // Get schedules for the current selected date
  const { data: schedules = [] } = useQuery<any[]>({
    queryKey: ["/api/schedules", "date", currentDate],
    queryFn: async () => {
      try {
        const response = await fetch(`/api/schedules?date=${currentDate}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch schedules: ${response.status}`);
        }
        const data = await response.json();
        return data;
      } catch (error) {
        console.log('Schedule fetch error:', error);
        return [];
      }
    },
    staleTime: 0, // Always fetch fresh data when date changes
    gcTime: 0, // React Query v5 uses gcTime instead of cacheTime
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });

  // Get all schedules for the week to check completion status
  const { data: weekSchedules = [] } = useQuery<any[]>({
    queryKey: ["/api/schedules", "all"],
    queryFn: async () => {
      try {
        const response = await fetch(`/api/schedules`);
        if (!response.ok) {
          throw new Error(`Failed to fetch all schedules: ${response.status}`);
        }
        return response.json();
      } catch (error) {
        console.log('All schedules fetch error:', error);
        return [];
      }
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
  });

  const deleteScheduleMutation = useMutation({
    mutationFn: (scheduleId: number) => apiRequest("DELETE", `/api/schedules/${scheduleId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules", "date", currentDate] });
      queryClient.invalidateQueries({ queryKey: ["/api/schedules", "all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Video removed from schedule successfully" });
    },
    onError: (error: any) => {
      // Don't show error for 404s (already deleted), but do for other errors
      if (error?.status !== 404) {
        toast({ 
          title: "Failed to delete video", 
          description: "Please try again",
          variant: "destructive" 
        });
      }
      // Still invalidate queries to refresh the UI
      queryClient.invalidateQueries({ queryKey: ["/api/schedules", "date", currentDate] });
      queryClient.invalidateQueries({ queryKey: ["/api/schedules", "all"] });
    },
  });

  const updateRoomMutation = useMutation({
    mutationFn: ({ roomId, data }: { roomId: number; data: Partial<Room> }) =>
      apiRequest("PATCH", `/api/rooms/${roomId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rooms"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
    },
  });

  const updateScheduleMutation = useMutation({
    mutationFn: ({ scheduleId, data }: { scheduleId: number; data: any }) =>
      apiRequest("PATCH", `/api/schedules/${scheduleId}`, data),
    onSuccess: (data, variables, context) => {
      // Always invalidate to ensure UI updates, but don't show toast for reps-only updates
      queryClient.invalidateQueries({ queryKey: ["/api/schedules", "date", currentDate] });
      queryClient.invalidateQueries({ queryKey: ["/api/schedules", "all"] });
      
      // Only show toast for non-reps updates
      if (!variables.data.reps || Object.keys(variables.data).length > 1) {
        toast({ title: "Schedule updated successfully" });
      }
    },
    onError: () => {
      toast({ 
        title: "Failed to update schedule", 
        description: "Please try again",
        variant: "destructive" 
      });
    },
  });

  const updateVideoMutation = useMutation({
    mutationFn: ({ videoId, data }: { videoId: number; data: any }) =>
      apiRequest("PATCH", `/api/videos/${videoId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
      queryClient.invalidateQueries({ queryKey: ["/api/schedules", "date", currentDate] });
      toast({ title: "Video updated successfully" });
    },
    onError: () => {
      toast({ 
        title: "Failed to update video", 
        description: "Please try again",
        variant: "destructive" 
      });
    },
  });

  const moveScheduleMutation = useMutation({
    mutationFn: async ({ scheduleId, toRoomId }: { scheduleId: number; toRoomId: number }) => {
      // First, get the current schedule to preserve its data
      const currentSchedule = schedules.find((s: any) => s.id === scheduleId);
      if (!currentSchedule) throw new Error('Schedule not found');

      // Get existing schedules for the target room to determine position
      const targetRoomSchedules = schedules.filter((s: any) => s.roomId === toRoomId && s.scheduleDate === currentDate);
      const position = targetRoomSchedules.length; // New position will be at the end

      return apiRequest("PATCH", `/api/schedules/${scheduleId}`, {
        roomId: toRoomId,
        position: position
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules", "date", currentDate] });
      queryClient.invalidateQueries({ queryKey: ["/api/schedules", "all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Exercise moved successfully" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to move exercise", 
        description: error?.message || "Please try again",
        variant: "destructive" 
      });
    },
  });

  // Copy schedules mutation
  // Build (auto-fill) the schedule for the current date. Existing entries are
  // kept and locked; only empty rounds get generated by the rule engine.
  const fillScheduleMutation = useMutation({
    mutationFn: async (date: string) => {
      const res = await fetch("/api/workout-builder/fill-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed to build schedule");
      }
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules", "date", currentDate] });
      queryClient.invalidateQueries({ queryKey: ["/api/schedules", "all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({
        title: "Schedule built",
        description:
          data.keptRooms > 0
            ? `Kept ${data.keptRooms} existing round(s) and filled ${data.filledRooms} empty round(s) with ${data.addedExercises} exercise(s).`
            : `Filled ${data.filledRooms} round(s) with ${data.addedExercises} exercise(s).`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Build failed", description: error.message, variant: "destructive" });
    },
  });

  const copyScheduleMutation = useMutation({
    mutationFn: async ({ sourceDate, targetDate }: { sourceDate: string; targetDate: string }) => {
      // Get all schedules from source date
      const sourceSchedules = weekSchedules.filter((s: any) => s.scheduleDate === sourceDate);
      
      if (sourceSchedules.length === 0) {
        throw new Error(`No schedules found for ${sourceDate}`);
      }

      // Delete all existing schedules for target date first
      const existingTargetSchedules = weekSchedules.filter((s: any) => s.scheduleDate === targetDate);
      const deletePromises = existingTargetSchedules.map((s: any) => 
        apiRequest("DELETE", `/api/schedules/${s.id}`)
      );
      
      if (deletePromises.length > 0) {
        await Promise.all(deletePromises);
      }

      // Create new schedules for target date based on source
      const createPromises = sourceSchedules.map((sourceSchedule: any) => 
        apiRequest("POST", "/api/schedules", {
          roomId: sourceSchedule.roomId,
          videoId: sourceSchedule.videoId,
          scheduleDate: targetDate,
          sets: sourceSchedule.sets,
          reps: sourceSchedule.reps,
          restTime: sourceSchedule.restTime,
          position: sourceSchedule.position,
          displayTitle: sourceSchedule.displayTitle,
          displayEquipment: sourceSchedule.displayEquipment,
          zoomLevel: sourceSchedule.zoomLevel,
          verticalPosition: sourceSchedule.verticalPosition
        })
      );

      return Promise.all(createPromises);
    },
    onSuccess: (data, { sourceDate, targetDate }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules", "date", currentDate] });
      queryClient.invalidateQueries({ queryKey: ["/api/schedules", "all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      
      const sourceDayName = new Date(sourceDate).toLocaleDateString('en-US', { weekday: 'long' });
      const targetDayName = new Date(targetDate).toLocaleDateString('en-US', { weekday: 'long' });
      
      toast({ 
        title: `Schedule copied successfully`,
        description: `${sourceDayName}'s schedule copied to ${targetDayName}`
      });
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to copy schedule", 
        description: error?.message || "Please try again",
        variant: "destructive" 
      });
    },
  });

  // Generate dynamic filter options from loaded videos
  const dynamicBodyParts = useMemo(() => {
    if (!videos) return [];
    const parts = new Set<string>();
    videos.forEach(video => {
      if (video.bodyPart) {
        video.bodyPart.split(',').forEach(part => {
          const trimmed = part.trim();
          if (trimmed) parts.add(trimmed);
        });
      }
    });
    return Array.from(parts).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }, [videos]);

  const dynamicSecondaryMuscles = useMemo(() => {
    if (!videos) return [];
    const muscles = new Set<string>();
    videos.forEach(video => {
      if (video.secondaryMuscle && video.secondaryMuscle !== "none") {
        video.secondaryMuscle.split(',').forEach(muscle => {
          const trimmed = muscle.trim();
          if (trimmed) muscles.add(trimmed);
        });
      }
    });
    return Array.from(muscles).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }, [videos]);

  const dynamicEquipment = useMemo(() => {
    if (!videos) return [];
    const equipment = new Set<string>();
    videos.forEach(video => {
      if (video.equipment) {
        video.equipment.split(',').forEach(eq => {
          const trimmed = eq.trim();
          if (trimmed) equipment.add(trimmed);
        });
      }
    });
    return Array.from(equipment).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }, [videos]);

  const dynamicCategories = useMemo(() => {
    if (!videos) return [];
    const categories = new Set<string>();
    videos.forEach(video => {
      const videoCategories = deriveCategories(video.bodyPart, video.equipment);
      videoCategories.forEach(category => categories.add(category));
    });
    return Array.from(categories).sort((a, b) => {
      // Sort so "Missing" comes last
      if (a === 'Missing' && b !== 'Missing') return 1;
      if (b === 'Missing' && a !== 'Missing') return -1;
      return a.localeCompare(b);
    });
  }, [videos]);

  const filteredVideos = videos?.filter(video => {
    // Check category filter first
    if (videoFilters.category.length > 0) {
      const videoCategories = deriveCategories(video.bodyPart, video.equipment);
      const hasMatch = videoFilters.category.some(filterCategory => 
        videoCategories.includes(filterCategory)
      );
      if (!hasMatch) return false;
    }

    // Check primary muscles (bodyPart) - multiple selection
    if (videoFilters.bodyPart.length > 0) {
      const videoBodyParts = video.bodyPart ? video.bodyPart.split(',').map(part => part.trim()) : [];
      const hasMatch = videoFilters.bodyPart.some(filterPart => {
        if (filterPart === 'General') {
          return !video.bodyPart || video.bodyPart === 'General';
        }
        return videoBodyParts.some(videoPart => 
          videoPart.toLowerCase() === filterPart.toLowerCase()
        );
      });
      if (!hasMatch) return false;
    }
    
    // Secondary muscle filter - multiple selection
    if (videoFilters.secondaryMuscle.length > 0) {
      const videoSecondaryMuscles = video.secondaryMuscle ? video.secondaryMuscle.split(',').map(muscle => muscle.trim()) : [];
      const hasMatch = videoFilters.secondaryMuscle.some(filterMuscle => {
        if (filterMuscle === "none") {
          return !video.secondaryMuscle || video.secondaryMuscle === "none" || video.secondaryMuscle === "";
        }
        if (filterMuscle === "to_be_assigned") {
          return !video.secondaryMuscle || video.secondaryMuscle.trim() === "";
        }
        return videoSecondaryMuscles.some(videoMuscle => 
          videoMuscle.toLowerCase() === filterMuscle.toLowerCase()
        );
      });
      if (!hasMatch) return false;
    }
    
    // Check equipment - multiple selection
    if (videoFilters.equipment.length > 0) {
      const videoEquipment = video.equipment ? video.equipment.split(',').map(eq => eq.trim()) : [];
      const hasMatch = videoFilters.equipment.some(filterEq => {
        if (filterEq === 'To be assigned') {
          return !video.equipment || video.equipment === 'To be assigned';
        }
        return videoEquipment.some(videoEq => 
          videoEq.toLowerCase() === filterEq.toLowerCase()
        );
      });
      if (!hasMatch) return false;
    }
    
    if (videoFilters.search && !video.title.toLowerCase().includes(videoFilters.search.toLowerCase())) return false;

    // Intensity filter (derived heart-rate zone)
    if (videoFilters.intensity) {
      if (videoFilters.intensity === "unset") {
        if (video.intensity) return false;
      } else if (video.intensity !== videoFilters.intensity) {
        return false;
      }
    }

    // Needs Review filter (no AI metadata yet or low confidence)
    if (videoFilters.needsReview) {
      if (!(video.aiConfidence == null || video.aiConfidence < 70)) return false;
    }
    
    // Last Used filter
    if (videoFilters.lastUsed) {
      const now = new Date();
      const lastUsed = video.lastUsed ? new Date(video.lastUsed) : null;
      
      switch (videoFilters.lastUsed) {
        case 'today':
          if (!lastUsed || lastUsed.toDateString() !== now.toDateString()) return false;
          break;
        case 'week':
          if (!lastUsed || (now.getTime() - lastUsed.getTime()) > 7 * 24 * 60 * 60 * 1000) return false;
          break;
        case 'month':
          if (!lastUsed || (now.getTime() - lastUsed.getTime()) > 30 * 24 * 60 * 60 * 1000) return false;
          break;
        case 'never':
          if (lastUsed) return false;
          break;
      }
    }
    
    // Scheduled filter — use nextScheduled from the video itself (future dates)
    if (videoFilters.scheduled) {
      const isScheduled = !!video.nextScheduled;
      if (videoFilters.scheduled === 'scheduled' && !isScheduled) return false;
      if (videoFilters.scheduled === 'unscheduled' && isScheduled) return false;
    }
    
    return true;
  })?.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase())) || [];

  const roomsWithAssignments: RoomWithAssignments[] = rooms?.map(room => {
    // Use schedules for the selected date instead of room assignments
    const roomSchedules = (schedules || []).filter((s: any) => s.roomId === room.id && s.scheduleDate === currentDate);
    const assignmentsWithVideos = roomSchedules.map((schedule: any) => {
      const video = videos?.find(v => v.id === schedule.videoId);
      return { 
        ...schedule, 
        video: video!,
        isActive: true // schedules are always active for the date
      };
    }).filter((a: any) => a.video);
    
    return { ...room, assignments: assignmentsWithVideos };
  }) || [];

  const handleAssignVideo = (video: Video | null, roomId?: number) => {
    setSelectedVideo(video);
    setSelectedRoom(roomId || null);
    setIsAssignmentModalOpen(true);
  };

  const handleEditVideo = (video: Video) => {
    setEditingVideo(video);
    setIsVideoEditModalOpen(true);
  };

  const [videoPreview, setVideoPreview] = useState<{url: string, title: string, key: number} | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);

  const handlePreviewVideo = (video: Video) => {
    setVideoPreview({
      url: video.url,
      title: video.title || 'Video Preview',
      key: Date.now()
    });
  };

  const closeVideoPreview = () => {
    setVideoPreview(null);
  };

  // Inline editing mutation for quick metadata updates
  const updateVideoInlineMutation = useMutation({
    mutationFn: async ({ videoId, field, value }: { videoId: number, field: string, value: string | string[] }) => {
      console.log('Inline edit mutation:', { videoId, field, value });
      return apiRequest("PATCH", `/api/videos/${videoId}`, { field, value });
    },
    onSuccess: (data, variables) => {
      // Update the local cache immediately for fast UI response
      queryClient.setQueryData(["/api/videos"], (oldData: any) => {
        if (!oldData) return oldData;
        return oldData.map((video: any) => {
          if (video.id !== variables.videoId) return video;
          const patch: any = { [variables.field]: variables.value };
          // Keep deprecated aliases in sync for display consistency
          if (variables.field === "category") patch.bodyPart = variables.value;
          if (variables.field === "muscleGroups" && Array.isArray(variables.value)) {
            patch.secondaryMuscle = variables.value.join(", ");
          }
          return { ...video, ...patch };
        });
      });
      // Invalidate video options to refresh dropdown options
      queryClient.invalidateQueries({ queryKey: ["/api/video-options"] });
      // Don't close field immediately - let onClose handle it
      // Don't show toast for each selection to reduce noise
    },
    onError: () => {
      toast({
        title: "Error", 
        description: "Failed to update video metadata",
        variant: "destructive",
      });
    },
  });

  // ---- AI metadata generation ----
  // A video "needs review" when it has no AI metadata yet or the model was unsure.
  const videoNeedsReview = (video: Video) =>
    video.aiConfidence == null || video.aiConfidence < 70;

  const runAiMetadata = async () => {
    if (aiProgress?.running) return;
    try {
      // Get the initial count of videos that still need metadata.
      const countRes = await apiRequest("GET", "/api/videos/ai-metadata");
      const { needsReview } = await countRes.json();
      if (!needsReview || needsReview === 0) {
        toast({ title: "All exercises are complete", description: "Every video has category, muscles, intensity and movement filled." });
        return;
      }

      const total = needsReview;
      setAiProgress({ running: true, processed: 0, total });
      toast({ title: "Filling missing metadata", description: `${total} exercises need category, muscles, intensity or movement data...` });

      let processed = 0;
      let consecutiveErrors = 0;
      let safety = 0;
      // Accumulate unknown terms across all batches (deduped by term string)
      const allUnknownMap: Record<string, UnknownTerm> = {};
      // Keep going until the server says done OR we have too many consecutive failures
      while (safety < 500 && consecutiveErrors < 3) {
        safety++;
        let data: any = null;
        try {
          const res = await apiRequest("POST", "/api/videos/ai-metadata", { mode: "fill", batchSize: 4 });
          if (!res.ok) {
            consecutiveErrors++;
            console.warn(`[v0] AI metadata batch ${safety} returned ${res.status} — retrying (${consecutiveErrors}/3)`);
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
          data = await res.json();
          consecutiveErrors = 0; // reset on success
        } catch (fetchErr) {
          consecutiveErrors++;
          console.warn(`[v0] AI metadata fetch error batch ${safety}:`, fetchErr);
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }

        processed += data.processedCount ?? 0;
        setAiProgress({ running: true, processed: Math.min(processed, total), total });

        // Merge unknown terms from this batch
        if (Array.isArray(data.unknownTerms)) {
          for (const t of data.unknownTerms as UnknownTerm[]) {
            if (!allUnknownMap[t.term]) {
              allUnknownMap[t.term] = { term: t.term, videoIds: [], videoTitles: [] };
            }
            for (const id of t.videoIds) {
              if (!allUnknownMap[t.term].videoIds.includes(id)) {
                allUnknownMap[t.term].videoIds.push(id);
              }
            }
            for (const title of t.videoTitles) {
              if (!allUnknownMap[t.term].videoTitles.includes(title)) {
                allUnknownMap[t.term].videoTitles.push(title);
              }
            }
          }
        }

        // Refresh the table as batches complete so trainers see progress live.
        queryClient.invalidateQueries({ queryKey: ["/api/videos"] });

        // Stop when the server says there's nothing left to process
        if (data.done || data.remaining === 0) break;

        // If the whole batch was rate-limited (zero successes), wait longer
        // before retrying so the AI Gateway quota window has time to reset.
        const batchDelay = (data.processedCount ?? 0) === 0 ? 10000 : 1500;
        setAiProgress((p) => p ? ({ ...p, rateLimited: (data.processedCount ?? 0) === 0 }) : p);
        await new Promise((r) => setTimeout(r, batchDelay));
      }

      const collectedTerms = Object.values(allUnknownMap);
      if (collectedTerms.length > 0) {
        setUnknownTerms(collectedTerms);
      }

      setAiProgress({ running: false, processed: total, total });
      toast({ title: "AI metadata complete", description: `Processed ${processed} exercises.` });
      setTimeout(() => setAiProgress(null), 4000);
    } catch (error) {
      console.error("[v0] AI metadata run failed:", error);
      setAiProgress(null);
      toast({ title: "AI metadata failed", description: "Please try again.", variant: "destructive" });
    }
  };

  // Generate thumbnails for all videos that are missing one.
  const runBulkThumbnails = async () => {
    if (thumbProgress?.running) return;

    // Ask the server for all video IDs missing a thumbnail — this covers
    // every video in the DB, not just what the SWR cache has loaded.
    let missingIds: number[] = [];
    try {
      const countRes = await fetch("/api/videos/missing-thumbnails");
      if (countRes.ok) {
        const json = await countRes.json();
        missingIds = json.ids ?? [];
      }
    } catch {}

    // Fallback: derive from the in-memory SWR cache
    if (missingIds.length === 0) {
      missingIds = (videos ?? []).filter((v) => !v.thumbnailUrl).map((v) => v.id);
    }

    if (missingIds.length === 0) {
      toast({ title: "All videos already have thumbnails", description: "Nothing to process." });
      return;
    }

    const total = missingIds.length;
    setThumbProgress({ running: true, processed: 0, total });
    toast({ title: "Generating thumbnails", description: `Processing ${total} videos...` });

    let processed = 0;
    // Process in chunks of 3 concurrent requests to stay within rate limits
    const CONCURRENCY = 3;
    for (let i = 0; i < missingIds.length; i += CONCURRENCY) {
      const chunk = missingIds.slice(i, i + CONCURRENCY);
      await Promise.all(
        chunk.map(async (videoId) => {
          try {
            const res = await fetch(`/api/videos/${videoId}/thumbnail/generate`, { method: "POST" });
            if (!res.ok) {
              const body = await res.json().catch(() => ({}));
              console.warn(`[bulk-thumbnails] server error for ${videoId}:`, body);
            }
          } catch (err) {
            console.warn(`[bulk-thumbnails] failed for video ${videoId}:`, err);
          } finally {
            processed++;
            setThumbProgress({ running: true, processed, total });
          }
        }),
      );
      // Refresh the table every chunk so thumbnails appear as they're generated
      queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
    }

    queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
    setThumbProgress({ running: false, processed: total, total });
    toast({ title: "Thumbnails complete", description: `Generated ${processed} thumbnails.` });
    setTimeout(() => setThumbProgress(null), 4000);
  };

  // Handle new custom entries for inline editing
  const handleNewPrimaryMuscle = async (newMuscle: string) => {
    try {
      await apiRequest("POST", '/api/video-options/add-body-part', { bodyPart: newMuscle });
      queryClient.invalidateQueries({ queryKey: ["/api/video-options"] });
    } catch (error) {
      console.error('Failed to save new body part:', error);
    }
  };

  const handleNewMuscleGroup = async (newMuscle: string) => {
    try {
      await apiRequest("POST", '/api/video-options/add-muscle-group', { muscleGroup: newMuscle });
      queryClient.invalidateQueries({ queryKey: ["/api/video-options"] });
    } catch (error) {
      console.error('Failed to save new muscle group:', error);
    }
  };

  const handleNewSecondaryMuscle = async (newMuscle: string) => {
    try {
      await apiRequest("POST", '/api/video-options/add-secondary-muscle', { secondaryMuscle: newMuscle });
      queryClient.invalidateQueries({ queryKey: ["/api/video-options"] });
    } catch (error) {
      console.error('Failed to save new secondary muscle:', error);
    }
  };

  const handleNewEquipment = async (newEquipment: string) => {
    try {
      await apiRequest("POST", '/api/video-options/add-equipment', { equipment: newEquipment });
      queryClient.invalidateQueries({ queryKey: ["/api/video-options"] });
    } catch (error) {
      console.error('Failed to save new equipment:', error);
    }
  };

  const deleteVideoMutation = useMutation({
    mutationFn: async (videoId: number) => {
      // Delete the video (this will handle schedules, files, and database cleanup)
      console.log(`Attempting to delete video ${videoId}`);
      const response = await apiRequest("DELETE", `/api/videos/${videoId}`);
      const result = await response.json();
      console.log(`Delete response:`, result);
      return result;
    },
    onSuccess: (data, videoId) => {
      console.log(`Video ${videoId} deletion completed successfully:`, data);
      
      // Invalidate all relevant queries to refresh the UI
      queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/video-options"] });
      
      toast({
        title: "Video deleted",
        description: "Video, files, thumbnails, and all schedules have been completely removed.",
      });
    },
    onError: (error, videoId) => {
      console.error(`Delete video ${videoId} error:`, error);
      toast({
        title: "Error",
        description: "Failed to delete video completely. Please try again.",
        variant: "destructive",
      });
    },
  });



  const handleDeleteVideo = (video: Video) => {
    if (confirm(`Are you sure you want to delete "${video.title}"? This will remove it from all schedules and cannot be undone.`)) {
      deleteVideoMutation.mutate(video.id);
    }
  };



  const handleScheduleDisplayChange = (scheduleId: number, field: string, value: string) => {
    setScheduleChanges(prev => ({
      ...prev,
      [scheduleId]: {
        ...prev[scheduleId],
        [field]: value
      }
    }));
  };

  const handleFieldChange = (type: 'video' | 'schedule' | 'room', id: number, field: string, value: string) => {
    const changeKey = `${type}_${id}_${field}`;
    setPendingChanges(prev => ({
      ...prev,
      [changeKey]: { type, id, field, value }
    }));
    setHasUnsavedChanges(true);
  };

  const saveVideoChanges = async (videoId: number) => {
    const changes = videoChanges[videoId];
    if (!changes) return;

    try {
      await updateVideoMutation.mutateAsync({
        videoId,
        data: changes
      });
      
      setVideoChanges(prev => {
        const updated = { ...prev };
        delete updated[videoId];
        return updated;
      });
      
      toast({ title: "Video updated successfully" });
    } catch (error) {
      toast({ 
        title: "Failed to update video", 
        description: "Please try again",
        variant: "destructive" 
      });
    }
  };

  const saveScheduleChanges = async (scheduleId: number) => {
    const changes = scheduleChanges[scheduleId];
    if (!changes) return;

    try {
      await updateScheduleMutation.mutateAsync({
        scheduleId,
        data: changes
      });
      
      setScheduleChanges(prev => {
        const updated = { ...prev };
        delete updated[scheduleId];
        return updated;
      });
      
      toast({ title: "Display updated successfully" });
    } catch (error) {
      toast({ 
        title: "Failed to update display", 
        description: "Please try again",
        variant: "destructive" 
      });
    }
  };

  const saveAllChanges = async () => {
    const changes = Object.values(pendingChanges);
    const scheduleDisplayChanges = Object.entries(scheduleChanges);
    
    console.log('Saving changes:', { changes, scheduleDisplayChanges });
    
    try {
      // Save regular pending changes
      for (const change of changes) {
        const { type, id, field, value } = change as any;
        
        if (type === 'video') {
          await updateVideoMutation.mutateAsync({
            videoId: id,
            data: { [field]: value }
          });
        } else if (type === 'schedule') {
          await updateScheduleMutation.mutateAsync({
            scheduleId: id,
            data: { [field]: value }
          });
        } else if (type === 'room') {
          await updateRoomMutation.mutateAsync({
            roomId: id,
            data: { [field]: value }
          });
        }
      }
      
      // Save schedule display changes
      for (const [scheduleId, changeData] of scheduleDisplayChanges) {
        console.log('Saving schedule display change:', scheduleId, changeData);
        await updateScheduleMutation.mutateAsync({
          scheduleId: parseInt(scheduleId),
          data: changeData
        });
      }
      
      setPendingChanges({});
      setScheduleChanges({});
      setHasUnsavedChanges(false);
      
      // Force refresh of schedule data
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/schedules", currentDate] });
      
      toast({ title: "All changes saved successfully" });
    } catch (error) {
      console.error('Error saving changes:', error);
      toast({ 
        title: "Error saving changes", 
        description: "Some changes may not have been saved",
        variant: "destructive" 
      });
    }
  };

  const handleStopRoom = (roomId: number) => {
    updateRoomMutation.mutate({
      roomId,
      data: { isActive: false }
    });
  };

  const handleStartAllRooms = () => {
    rooms?.forEach(room => {
      if (!room.isActive) {
        updateRoomMutation.mutate({
          roomId: room.id,
          data: { isActive: true }
        });
      }
    });
  };

  const handleStopAllRooms = () => {
    rooms?.forEach(room => {
      if (room.isActive) {
        updateRoomMutation.mutate({
          roomId: room.id,
          data: { isActive: false }
        });
      }
    });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center">
                <img 
                  src={tenRoundsLogo} 
                  alt="TENROUNDS Logo" 
                  className="w-10 h-10 object-contain"
                />
              </div>
              <div>
                <h1 className="text-xl font-bold text-[hsl(198,18%,21%)]">TENROUNDS Workout Scheduler</h1>
                <p className="text-sm text-gray-600">Workout Management System</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="text-right">
                <p className="text-sm font-medium text-[hsl(198,18%,21%)]">Personal Trainer</p>
                <p className="text-xs text-gray-500">Dashboard Access</p>
              </div>
              <Button
                onClick={() => setLocation("/")}
                variant="outline"
                className="bg-gray-500 hover:bg-gray-600 text-white border-gray-500 hover:border-gray-600"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-6">
        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
          <TabsList className="bg-white shadow-sm">
            <TabsTrigger value="liveview" className="flex items-center">
              <Monitor className="mr-2 h-4 w-4" />
              Live View
            </TabsTrigger>
            <TabsTrigger value="library" className="flex items-center">
              <VideoIcon className="mr-2 h-4 w-4" />
              Video Library
            </TabsTrigger>
            <TabsTrigger value="schedule" className="flex items-center">
              <Calendar className="mr-2 h-4 w-4" />
              Schedule
            </TabsTrigger>
            <TabsTrigger value="builder" className="flex items-center">
              <Wand2 className="mr-2 h-4 w-4" />
              Builder
            </TabsTrigger>
            <TabsTrigger value="builder-config" className="flex items-center">
              <Settings2 className="mr-2 h-4 w-4" />
              Builder Config
            </TabsTrigger>

            <TabsTrigger value="cache" className="flex items-center">
              <VideoIcon className="mr-2 h-4 w-4" />
              Cache
            </TabsTrigger>
            <TabsTrigger value="dictionary" className="flex items-center">
              <BookOpen className="mr-2 h-4 w-4" />
              Dictionary
            </TabsTrigger>
          </TabsList>



          {/* Video Library Tab */}
          <TabsContent value="library" className="space-y-6">
            <Card>
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xl font-semibold">Video Library</CardTitle>
                  <div className="flex items-center space-x-2">

                    <Button
                      onClick={runAiMetadata}
                      disabled={aiProgress?.running}
                      className="bg-blue-600 hover:bg-blue-700"
                    >
                      {aiProgress?.running ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="mr-2 h-4 w-4" />
                      )}
                      AI Complete Metadata
                    </Button>

                    <Button
                      onClick={runBulkThumbnails}
                      disabled={thumbProgress?.running}
                      variant="outline"
                    >
                      {thumbProgress?.running ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Image className="mr-2 h-4 w-4" />
                      )}
                      {thumbProgress?.running
                        ? `${thumbProgress.processed}/${thumbProgress.total} thumbnails`
                        : "Generate Thumbnails"}
                    </Button>

                    <Button 
                      onClick={() => setIsSimpleBulkUploadModalOpen(true)}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      <VideoIcon className="mr-2 h-4 w-4" />
                      Bulk Upload Videos
                    </Button>

                  </div>
                </div>
                {aiProgress && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                      <span>
                        {aiProgress.running
  ? (aiProgress as any).rateLimited
    ? "Rate limited — waiting to retry..."
    : "Generating AI metadata..."
  : "AI metadata complete"}
                      </span>
                      <span>
                        {aiProgress.processed} / {aiProgress.total}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                      <div
                        className="h-full rounded-full bg-blue-600 transition-all duration-500"
                        style={{
                          width: `${aiProgress.total ? Math.round((aiProgress.processed / aiProgress.total) * 100) : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
                {thumbProgress && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                      <span>
                        {thumbProgress.running ? "Generating thumbnails..." : "Thumbnails complete"}
                      </span>
                      <span>
                        {thumbProgress.processed} / {thumbProgress.total}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                      <div
                        className="h-full rounded-full bg-gray-700 transition-all duration-500"
                        style={{
                          width: `${thumbProgress.total ? Math.round((thumbProgress.processed / thumbProgress.total) * 100) : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
              </CardHeader>
              {unknownTerms.length > 0 && (
                <div className="px-6 pb-2">
                  <UnknownTermsBanner
                    terms={unknownTerms}
                    onReview={() => setShowTermsReview(true)}
                  />
                </div>
              )}
              {showTermsReview && unknownTerms.length > 0 && (
                <UnknownTermsReviewDialog
                  terms={unknownTerms}
                  onDismiss={() => {
                    setShowTermsReview(false);
                    setUnknownTerms([]);
                  }}
                />
              )}
              <CardContent className="space-y-6">
                {/* Toolbar: search + filters */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative flex-1 min-w-48 max-w-sm">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
                    <Input
                      type="text"
                      placeholder="Search videos..."
                      value={videoFilters.search}
                      onChange={(e) => setVideoFilters(prev => ({ ...prev, search: e.target.value }))}
                      className="h-8 pl-8 text-xs"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setVideoFilters(prev => ({ ...prev, needsReview: !prev.needsReview }))}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors ${
                      videoFilters.needsReview
                        ? "border-amber-400 bg-amber-50 text-amber-700"
                        : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <AlertCircle className="h-3.5 w-3.5" />
                    Needs Review
                  </button>
                  <span className="ml-auto text-xs text-gray-400 tabular-nums">
                    {filteredVideos?.length ?? 0} videos
                  </span>
                </div>

                {/* Video Table */}
                <div className="rounded-lg border border-gray-200 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50/80">
                        <th className="w-10 p-2"></th>
                        <th className="w-6 p-1"></th>
                        <th className="text-left p-2 font-medium text-gray-500 uppercase tracking-wide text-[10px]">Name</th>
                        <th className="text-left p-2 font-medium text-gray-500 uppercase tracking-wide text-[10px] w-24">Cat.</th>
                        <th className="text-left p-2 font-medium text-gray-500 uppercase tracking-wide text-[10px]">
                          <div className="flex items-center gap-1">
                            Muscles
                            <VideoOptionsButton
                              category="bodyPart"
                              options={videoOptions?.bodyParts || []}
                              title="Primary Muscles"
                            />
                          </div>
                        </th>
                        <th className="text-left p-2 font-medium text-gray-500 uppercase tracking-wide text-[10px]">
                          <div className="flex items-center gap-1">
                            Equipment
                            <VideoOptionsButton
                              category="equipment"
                              options={videoOptions?.equipment || []}
                              title="Equipment"
                            />
                          </div>
                        </th>
                        <th className="text-left p-2 font-medium text-gray-500 uppercase tracking-wide text-[10px] w-20">Last Used</th>
                        <th className="text-center p-2 font-medium text-gray-500 uppercase tracking-wide text-[10px] w-14">Times</th>
                        <th className="text-left p-2 font-medium text-gray-500 uppercase tracking-wide text-[10px] w-28">Scheduled</th>
                        <th className="text-center p-2 font-medium text-gray-500 uppercase tracking-wide text-[10px] w-10">Int.</th>
                        <th className="text-left p-2 font-medium text-gray-500 uppercase tracking-wide text-[10px] w-28">Movement</th>
                        <th className="w-8 p-2"></th>
                      </tr>
                      {/* Filter row — each control sits directly under its column */}
                      <tr className="border-b border-gray-200 bg-white">
                        {/* Thumbnail col — no filter */}
                        <th className="p-1.5 pl-2 w-10"></th>
                        {/* AI status col — no filter */}
                        <th className="p-1 w-6"></th>
                        {/* Name — no column filter (uses search bar above) */}
                        <th className="p-1.5"></th>
                        {/* Cat. */}
                        <th className="p-1.5 w-24">
                          <SearchableSelect
                            options={dynamicCategories}
                            value={videoFilters.category[0] || "all"}
                            placeholder="All"
                            onValueChange={(value) =>
                              setVideoFilters(prev => ({ ...prev, category: value === "all" ? [] : [value] }))
                            }
                            allowAll={true}
                            className="h-7 text-[11px] w-full"
                          />
                        </th>
                        {/* Muscles */}
                        <th className="p-1.5">
                          <SearchableSelect
                            options={dynamicBodyParts}
                            value={videoFilters.bodyPart[0] || "all"}
                            placeholder="All"
                            onValueChange={(value) =>
                              setVideoFilters(prev => ({ ...prev, bodyPart: value === "all" ? [] : [value] }))
                            }
                            allowAll={true}
                            className="h-7 text-[11px] w-full"
                          />
                        </th>
                        {/* Equipment */}
                        <th className="p-1.5">
                          <SearchableSelect
                            options={dynamicEquipment}
                            value={videoFilters.equipment[0] || "all"}
                            placeholder="All"
                            onValueChange={(value) =>
                              setVideoFilters(prev => ({ ...prev, equipment: value === "all" ? [] : [value] }))
                            }
                            allowAll={true}
                            className="h-7 text-[11px] w-full"
                          />
                        </th>
                        {/* Last Used */}
                        <th className="p-1.5 w-20">
                          <Select
                            value={videoFilters.lastUsed || "all"}
                            onValueChange={(value) =>
                              setVideoFilters(prev => ({ ...prev, lastUsed: value === "all" ? "" : value }))
                            }
                          >
                            <SelectTrigger className="h-7 w-full text-[11px]">
                              <SelectValue placeholder="Any time" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">Any time</SelectItem>
                              <SelectItem value="today">Today</SelectItem>
                              <SelectItem value="week">This week</SelectItem>
                              <SelectItem value="month">This month</SelectItem>
                              <SelectItem value="never">Never used</SelectItem>
                            </SelectContent>
                          </Select>
                        </th>
                        {/* Times — no filter */}
                        <th className="p-1.5 w-14"></th>
                        {/* Scheduled */}
                        <th className="p-1.5 w-28">
                          <Select
                            value={videoFilters.scheduled || "all"}
                            onValueChange={(value) =>
                              setVideoFilters(prev => ({ ...prev, scheduled: value === "all" ? "" : value }))
                            }
                          >
                            <SelectTrigger className="h-7 w-full text-[11px]">
                              <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All</SelectItem>
                              <SelectItem value="scheduled">Scheduled</SelectItem>
                              <SelectItem value="unscheduled">Not scheduled</SelectItem>
                            </SelectContent>
                          </Select>
                        </th>
                        {/* Intensity */}
                        <th className="p-1.5 w-10">
                          <Select
                            value={videoFilters.intensity || "all"}
                            onValueChange={(value) =>
                              setVideoFilters(prev => ({ ...prev, intensity: value === "all" ? "" : value }))
                            }
                          >
                            <SelectTrigger className="h-7 w-full text-[11px]">
                              <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All</SelectItem>
                              {INTENSITY_LEVELS.map((level) => (
                                <SelectItem key={level} value={level}>{level}</SelectItem>
                              ))}
                              <SelectItem value="unset">Unset</SelectItem>
                            </SelectContent>
                          </Select>
                        </th>
                        {/* Movement — no filter */}
                        <th className="p-1.5 w-28"></th>
                        {/* Actions col — no filter */}
                        <th className="w-8 p-1.5"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredVideos.map((video) => {
                        const isReview = videoNeedsReview(video);
                        const intensityStyle = getIntensityStyle(video.intensity);
                        return (
                          <tr key={video.id} className="group hover:bg-gray-50/70 transition-colors">
                            {/* Thumbnail */}
                            <td className="p-1.5 pl-2">
                              <button
                                onClick={() => handlePreviewVideo(video)}
                                className="block w-8 h-8 rounded overflow-hidden bg-gray-100 flex-shrink-0 hover:ring-2 hover:ring-blue-400 transition-all"
                                title="Preview video"
                              >
                                <ImageThumbnail
                                  video={video}
                                  size="small"
                                  showPlayButton={false}
                                  onClick={() => handlePreviewVideo(video)}
                                />
                              </button>
                            </td>

                            {/* AI status — own column */}
                            <td className="p-1 text-center">
                              {isReview ? (
                                <span
                                  className="inline-flex h-4 w-4 rounded-full bg-amber-100 items-center justify-center"
                                  title="Needs metadata review"
                                >
                                  <AlertCircle className="h-2.5 w-2.5 text-amber-600" />
                                </span>
                              ) : video.aiConfidence ? (
                                <span
                                  className="inline-flex items-center gap-0.5 rounded-full bg-green-50 px-1 py-0.5 text-[9px] font-semibold text-green-700 border border-green-200"
                                  title={`AI confidence ${video.aiConfidence}%`}
                                >
                                  <Sparkles className="h-2 w-2" />
                                  {video.aiConfidence}%
                                </span>
                              ) : null}
                            </td>

                            {/* Name */}
                            <td className="p-2 max-w-[220px]">
                              <div className="flex items-center min-w-0">
                                <span className="truncate font-medium text-gray-800 text-xs leading-tight" title={video.title}>
                                  {video.title}
                                </span>
                              </div>
                            </td>

                            {/* Category chips */}
                            <td className="p-2">
                              <div className="flex flex-wrap gap-0.5">
                                {deriveCategories(video.bodyPart, video.equipment).map((cat, i) => (
                                  <span
                                    key={i}
                                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                      cat === "HIIT"
                                        ? "bg-red-50 text-red-700"
                                        : cat === "Missing"
                                        ? "bg-gray-100 text-gray-500"
                                        : "bg-blue-50 text-blue-700"
                                    }`}
                                  >
                                    {cat}
                                  </span>
                                ))}
                              </div>
                            </td>

                            {/* Category + Muscle Groups */}
                            <td className="p-2 max-w-[160px]">
                              {inlineEditingField?.videoId === video.id && inlineEditingField?.field === "muscleGroups" ? (
                                <SimpleMultiSelect
                                  options={(videoOptions as any)?.muscleGroups || videoOptions?.secondaryMuscles || []}
                                  selectedValues={Array.isArray(video.muscleGroups) ? video.muscleGroups : (video.secondaryMuscle ? video.secondaryMuscle.split(",").map((s: string) => s.trim()).filter((s: string) => s !== "none" && s !== "") : [])}
                                  onSelectionChange={(values) => updateVideoInlineMutation.mutate({ videoId: video.id, field: "muscleGroups", value: values })}
                                  onClose={() => setInlineEditingField(null)}
                                  onNewItemAdded={handleNewMuscleGroup}
                                  placeholder="Muscle groups"
                                  className="h-6 text-xs"
                                />
                              ) : (
                                <div className="flex flex-wrap gap-1 items-center">
                                  {/* Muscle group pills — granular secondary muscles only, no broad category terms */}
                                  {(() => {
                                    // Broad category-level terms that belong in the Cat. column only
                                    const BROAD_TERMS = new Set([
                                      'legs','core','cardio','shoulders','general','back','chest',
                                      'biceps','triceps','arms','none','ladies','hiit','boxing',
                                      'upper body','lower body','full body','abdominals','abs',
                                    ])
                                    const catChips = deriveCategories(video.bodyPart, video.equipment).map((c: string) => c.toLowerCase())
                                    const catLower = (video.category ?? "").toLowerCase()
                                    const uniqueMuscles = Array.isArray(video.muscleGroups)
                                      ? video.muscleGroups.filter((m: string) => {
                                          const ml = m.trim().toLowerCase()
                                          return ml && !BROAD_TERMS.has(ml) && !catChips.includes(ml) && ml !== catLower
                                        })
                                      : []
                                    return uniqueMuscles.length > 0 ? (
                                      uniqueMuscles.slice(0, 3).map((m: string, i: number) => (
                                        <button
                                          key={i}
                                          className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                                          onClick={() => setInlineEditingField({ videoId: video.id, field: "muscleGroups" })}
                                          title="Edit muscle groups"
                                        >
                                          {m.trim()}
                                        </button>
                                      ))
                                    ) : (
                                      <button
                                        className="rounded px-1 py-0.5 text-[10px] text-gray-300 hover:text-gray-500 hover:bg-gray-100 transition-colors"
                                        onClick={() => setInlineEditingField({ videoId: video.id, field: "muscleGroups" })}
                                        title="Add muscle groups"
                                      >
                                        +
                                      </button>
                                    )
                                  })()}
                                </div>
                              )}
                            </td>

                            {/* Equipment */}
                            <td className="p-2">
                              {inlineEditingField?.videoId === video.id && inlineEditingField?.field === "equipment" ? (
                                <SimpleMultiSelect
                                  options={videoOptions?.equipment || []}
                                  selectedValues={video.equipment && video.equipment !== "To be assigned" ? video.equipment.split(",").map(s => s.trim()).filter(s => s !== "To be assigned" && s !== "") : []}
                                  onSelectionChange={(values) => updateVideoInlineMutation.mutate({ videoId: video.id, field: "equipment", value: values.join(", ") })}
                                  onClose={() => setInlineEditingField(null)}
                                  onNewItemAdded={handleNewEquipment}
                                  placeholder="Equipment"
                                  className="h-6 text-xs"
                                />
                              ) : (
                                <button
                                  className={`inline-flex flex-wrap gap-0.5 rounded px-1.5 py-0.5 transition-colors text-left ${
                                    !video.equipment || video.equipment === "To be assigned"
                                      ? "bg-red-50 text-red-600 hover:bg-red-100"
                                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                  }`}
                                  onClick={() => setInlineEditingField({ videoId: video.id, field: "equipment" })}
                                  title="Edit equipment"
                                >
                                  {!video.equipment || video.equipment === "To be assigned" ? (
                                    <span className="text-[10px]">+ set</span>
                                  ) : (
                                    video.equipment.split(",").map((eq, i) => (
                                      <span key={i} className="text-[10px] font-medium">{eq.trim()}{i < video.equipment!.split(",").length - 1 ? "," : ""}</span>
                                    ))
                                  )}
                                </button>
                              )}
                            </td>

                            {/* Last Used */}
                            <td className="p-2 whitespace-nowrap">
                              <div className="flex items-center gap-1 text-[10px] text-gray-500">
                                <Clock className="h-3 w-3 shrink-0 text-gray-400" />
                                <span className="tabular-nums">{formatTimeAgoShort(video.lastUsed ?? null)}</span>
                              </div>
                            </td>

                            {/* Times Used */}
                            <td className="p-2 text-center whitespace-nowrap">
                              {(video.timesUsed ?? 0) > 0 ? (
                                <span className="tabular-nums rounded-full bg-gray-100 px-1.5 py-0.5 text-gray-600 font-semibold text-[10px]">
                                  {video.timesUsed}
                                </span>
                              ) : (
                                <span className="text-[10px] text-gray-300">—</span>
                              )}
                            </td>

                            {/* Scheduled */}
                            <td className="p-2">
                              {video.nextScheduled ? (
                                <div className="flex items-center gap-1 text-[10px]">
                                  <CalendarDays className="h-3 w-3 shrink-0 text-green-500" />
                                  <span className="text-green-600 font-medium tabular-nums">
                                    {new Date(video.nextScheduled + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-[10px] text-gray-300">–</span>
                              )}
                            </td>

                            {/* Intensity — colour circle only, click to change */}
                            <td className="p-2 text-center">
                              <Select
                                value={video.intensity ?? "unset"}
                                onValueChange={(value) =>
                                  updateVideoInlineMutation.mutate({
                                    videoId: video.id,
                                    field: "intensity",
                                    value: value === "unset" ? "" : value,
                                  })
                                }
                              >
                                <SelectTrigger
                                  className="h-5 w-5 rounded-full border-0 p-0 shadow-none ring-0 focus:ring-1 focus:ring-offset-0 mx-auto"
                                  title={video.intensity ?? "Unset — click to set intensity"}
                                  style={{ background: "transparent" }}
                                >
                                  <span
                                    className={`block h-4 w-4 rounded-full mx-auto transition-transform hover:scale-110 ${intensityStyle.dot} ${!video.intensity ? "opacity-30" : ""}`}
                                  />
                                </SelectTrigger>
                                <SelectContent>
                                  {INTENSITY_LEVELS.map((level) => (
                                    <SelectItem key={level} value={level}>
                                      <span className="flex items-center gap-2">
                                        <span className={`h-2.5 w-2.5 rounded-full ${getIntensityStyle(level).dot}`} />
                                        {level}
                                      </span>
                                    </SelectItem>
                                  ))}
                                  <SelectItem value="unset">
                                    <span className="flex items-center gap-2">
                                      <span className="h-2.5 w-2.5 rounded-full bg-gray-300" />
                                      Unset
                                    </span>
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </td>

                            {/* Movement pattern */}
                            <td className="p-2">
                              {inlineEditingField?.videoId === video.id && inlineEditingField?.field === "movementPattern" ? (
                                <Input
                                  autoFocus
                                  defaultValue={video.movementPattern ?? ""}
                                  className="h-6 text-[10px] px-1.5"
                                  onBlur={(e) => {
                                    updateVideoInlineMutation.mutate({ videoId: video.id, field: "movementPattern", value: e.target.value.trim() });
                                    setInlineEditingField(null);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
                                    else if (e.key === "Escape") setInlineEditingField(null);
                                  }}
                                />
                              ) : (
                                <button
                                  className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                                    video.movementPattern
                                      ? "bg-gray-100 text-gray-700 hover:bg-gray-200 font-medium"
                                      : "text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                                  }`}
                                  onClick={() => setInlineEditingField({ videoId: video.id, field: "movementPattern" })}
                                  title="Click to edit movement pattern"
                                >
                                  {video.movementPattern || "+ set"}
                                </button>
                              )}
                            </td>

                            {/* Actions — single edit button, delete on hover */}
                            <td className="p-2 pr-3">
                              <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => handleEditVideo(video)}
                                  className="h-6 w-6 flex items-center justify-center rounded hover:bg-gray-200 text-gray-500 hover:text-gray-800 transition-colors"
                                  title="Edit video"
                                >
                                  <Edit className="h-3 w-3" />
                                </button>
                                <button
                                  onClick={() => handleDeleteVideo(video)}
                                  className="h-6 w-6 flex items-center justify-center rounded hover:bg-red-100 text-gray-400 hover:text-red-600 transition-colors"
                                  title="Delete video"
                                  disabled={deleteVideoMutation.isPending}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {filteredVideos.length === 0 && (
                    <div className="text-center py-10 text-gray-400 text-sm">
                      No videos match your current filters
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Schedule Tab */}
          <TabsContent value="schedule" className="space-y-4">
            {/* ── Week navigator ───────────────────────────────────────────── */}
            {(() => {
              const currentDateObj = new Date(currentDate);
              const currentDay = currentDateObj.getDay();
              const daysFromMonday = currentDay === 0 ? 6 : currentDay - 1;
              const weekStart = new Date(currentDateObj);
              weekStart.setDate(currentDateObj.getDate() - daysFromMonday);
              const weekEnd = new Date(weekStart);
              weekEnd.setDate(weekStart.getDate() + 5);

              const mondayStr = weekStart.toISOString().split('T')[0];
              const tuesdayStr = new Date(weekStart.getTime() + 86400000).toISOString().split('T')[0];
              const wednesdayStr = new Date(weekStart.getTime() + 2*86400000).toISOString().split('T')[0];
              const thursdayStr = new Date(weekStart.getTime() + 3*86400000).toISOString().split('T')[0];
              const fridayStr = new Date(weekStart.getTime() + 4*86400000).toISOString().split('T')[0];
              const saturdayStr = new Date(weekStart.getTime() + 5*86400000).toISOString().split('T')[0];

              const weekDays = [mondayStr, tuesdayStr, wednesdayStr, thursdayStr, fridayStr, saturdayStr];

              const weekLabel = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

              // Category donut data
              const categoryCounts = schedules?.reduce((acc: Record<string, number>, schedule: any) => {
                const video = videos?.find((v: any) => v.id === schedule.videoId);
                if (video) {
                  const cats = deriveCategories(video.bodyPart, video.equipment);
                  cats.forEach((c: string) => { acc[c] = (acc[c] || 0) + 1; });
                }
                return acc;
              }, {} as Record<string, number>) || {};

              const CATEGORY_COLORS: Record<string, string> = {
                HIIT: '#ef4444', Chest: '#3b82f6', Core: '#8b5cf6', Shoulders: '#f59e0b',
                Back: '#10b981', Legs: '#06b6d4', Triceps: '#f97316', Biceps: '#ec4899',
                Boxing: '#6366f1', Missing: '#9ca3af',
              };
              const totalCats = Object.values(categoryCounts).reduce((a: number, b: number) => a + b, 0);
              const donutData = Object.entries(categoryCounts)
                .filter(([, v]) => v > 0)
                .sort(([, a], [, b]) => (b as number) - (a as number))
                .map(([name, value]) => ({
                  name,
                  value: value as number,
                  pct: totalCats > 0 ? Math.round(((value as number) / totalCats) * 100) : 0,
                  color: CATEGORY_COLORS[name] || '#6b7280',
                }));

              return (
                <>
                  {/* Header row: week label + prev/next + actions */}
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          const d = new Date(currentDate);
                          d.setDate(d.getDate() - 7);
                          setCurrentDate(d.toISOString().split('T')[0]);
                        }}
                        className="flex items-center justify-center w-8 h-8 rounded-full border border-gray-200 bg-white hover:bg-gray-50 transition-colors text-gray-600"
                        aria-label="Previous week"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <span className="text-base font-semibold text-gray-900 min-w-[200px] text-center">{weekLabel}</span>
                      <button
                        onClick={() => {
                          const d = new Date(currentDate);
                          d.setDate(d.getDate() + 7);
                          setCurrentDate(d.toISOString().split('T')[0]);
                        }}
                        className="flex items-center justify-center w-8 h-8 rounded-full border border-gray-200 bg-white hover:bg-gray-50 transition-colors text-gray-600"
                        aria-label="Next week"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>

                    {/* Quick copy + Build button */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 hidden sm:block">Copy:</span>
                      <button
                        onClick={() => copyScheduleMutation.mutate({ sourceDate: mondayStr, targetDate: thursdayStr })}
                        disabled={copyScheduleMutation.isPending}
                        className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 transition-colors disabled:opacity-50"
                        title="Copy Monday → Thursday"
                      >Mon → Thu</button>
                      <button
                        onClick={() => copyScheduleMutation.mutate({ sourceDate: tuesdayStr, targetDate: fridayStr })}
                        disabled={copyScheduleMutation.isPending}
                        className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 transition-colors disabled:opacity-50"
                        title="Copy Tuesday → Friday"
                      >Tue → Fri</button>
                      <button
                        onClick={() => copyScheduleMutation.mutate({ sourceDate: wednesdayStr, targetDate: saturdayStr })}
                        disabled={copyScheduleMutation.isPending}
                        className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 transition-colors disabled:opacity-50"
                        title="Copy Wednesday → Saturday"
                      >Wed → Sat</button>
                      <Button
                        onClick={() => fillScheduleMutation.mutate(currentDate)}
                        disabled={fillScheduleMutation.isPending}
                        size="sm"
                        className="bg-gray-900 text-white hover:bg-gray-800 gap-1.5 ml-2"
                      >
                        {fillScheduleMutation.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Wand2 className="h-3.5 w-3.5" />
                        )}
                        {(schedules?.length ?? 0) > 0 ? 'Fill Rounds' : 'Build Workout'}
                      </Button>
                    </div>
                  </div>

                  {/* Day pills */}
                  <div className="flex gap-1.5">
                    {weekDays.map((dateStr) => {
                      const d = new Date(dateStr);
                      const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
                      const dayNum = d.getDate();
                      const daySchedules = weekSchedules?.filter((s: any) => s.scheduleDate === dateStr) || [];
                      const filled = new Set(daySchedules.map((s: any) => s.roomId)).size;
                      const isSelected = currentDate === dateStr;
                      const isComplete = filled >= 10;
                      return (
                        <button
                          key={dateStr}
                          onClick={() => setCurrentDate(dateStr)}
                          className={`flex-1 flex flex-col items-center py-2 px-1 rounded-xl border transition-all ${
                            isSelected
                              ? 'bg-gray-900 border-gray-900 text-white shadow-md'
                              : isComplete
                              ? 'bg-green-50 border-green-200 text-green-800 hover:bg-green-100'
                              : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          <span className={`text-[10px] font-medium uppercase tracking-wider ${isSelected ? 'text-gray-300' : isComplete ? 'text-green-600' : 'text-gray-400'}`}>{dayName}</span>
                          <span className={`text-lg font-bold leading-tight ${isSelected ? 'text-white' : 'text-gray-900'}`}>{dayNum}</span>
                          <span className={`text-[10px] mt-0.5 ${isSelected ? 'text-gray-400' : isComplete ? 'text-green-500 font-medium' : 'text-gray-400'}`}>
                            {filled}/10
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Category donut + round grid */}
                  <div className="flex gap-4 items-start">
                    {/* Donut chart */}
                    {donutData.length > 0 && (
                      <div className="shrink-0 bg-white border border-gray-100 rounded-2xl p-4 shadow-sm w-[220px]">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                          {new Date(currentDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — Focus
                        </p>
                        <div className="flex items-center gap-3">
                          {/* SVG donut */}
                          <svg width="72" height="72" viewBox="0 0 72 72" className="shrink-0">
                            {(() => {
                              const r = 28; const cx = 36; const cy = 36;
                              const circumference = 2 * Math.PI * r;
                              let offset = 0;
                              return donutData.map((d, i) => {
                                const dash = (d.pct / 100) * circumference;
                                const gap = circumference - dash;
                                const el = (
                                  <circle
                                    key={d.name}
                                    cx={cx} cy={cy} r={r}
                                    fill="none"
                                    stroke={d.color}
                                    strokeWidth="12"
                                    strokeDasharray={`${dash} ${gap}`}
                                    strokeDashoffset={-offset}
                                    transform="rotate(-90 36 36)"
                                    className="transition-all duration-500"
                                  />
                                );
                                offset += dash;
                                return el;
                              });
                            })()}
                            <circle cx="36" cy="36" r="22" fill="white" />
                            <text x="36" y="40" textAnchor="middle" className="text-xs font-bold" style={{ fontSize: '11px', fontWeight: 700, fill: '#111' }}>
                              {donutData[0]?.pct}%
                            </text>
                          </svg>
                          {/* Legend */}
                          <div className="flex flex-col gap-1 min-w-0">
                            {donutData.map((d) => (
                              <div key={d.name} className="flex items-center gap-1.5 min-w-0">
                                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                                <span className="text-[10px] text-gray-600 truncate">{d.name}</span>
                                <span className="text-[10px] font-semibold text-gray-900 ml-auto pl-1">{d.pct}%</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* ── Round cards grid ──────────────────────────────────── */}
                    <div className="flex-1 grid grid-cols-2 gap-2">
                      {roomsWithAssignments.map((room) => {
                        const isEmpty = room.assignments.length === 0;
                        const isFull = room.assignments.length >= 2;
                        return (
                          <div
                            key={room.id}
                            className={`rounded-xl border bg-white overflow-hidden transition-shadow hover:shadow-md ${
                              isEmpty ? 'border-red-100 bg-red-50/30' : isFull ? 'border-green-100' : 'border-amber-100'
                            }`}
                          >
                            {/* Card header */}
                            <div className={`flex items-center justify-between px-3 py-2 border-b ${
                              isEmpty ? 'border-red-100 bg-red-50/40' : isFull ? 'border-green-100 bg-green-50/40' : 'border-amber-100 bg-amber-50/40'
                            }`}>
                              <div className="flex items-center gap-2">
                                <span className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${
                                  isEmpty ? 'bg-gray-300 text-gray-600' : isFull ? 'bg-green-600 text-white' : 'bg-amber-500 text-white'
                                }`}>{room.number}</span>
                                <span className="text-xs font-semibold text-gray-700">Round {room.number}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                                  isEmpty ? 'bg-red-100 text-red-600' : isFull ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                                }`}>
                                  {isEmpty ? 'empty' : `${room.assignments.length}/2`}
                                </span>
                                {!isFull && (
                                  <button
                                    onClick={() => handleAssignVideo(null, room.id)}
                                    className="w-5 h-5 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                                    title="Add video"
                                  >
                                    <Plus className="h-3 w-3" />
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Video rows */}
                            {isEmpty ? (
                              <button
                                onClick={() => handleAssignVideo(null, room.id)}
                                className="w-full py-3 text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-50/50 transition-colors text-center"
                              >
                                + assign video
                              </button>
                            ) : (
                              <div className="divide-y divide-gray-100">
                                {room.assignments.map((assignment, idx) => {
                                  const videoEquipmentOptions = assignment.video.equipment.split(',').map((e: string) => e.trim()).filter((e: string) => e);
                                  const allEquipmentOptions = videoOptions?.equipment || [];
                                  const defaultEquipment = assignment.displayEquipment || videoEquipmentOptions[0] || '';
                                  const repsVal = scheduleChanges[assignment.id]?.reps !== undefined ? scheduleChanges[assignment.id].reps : assignment.reps;

                                  return (
                                    <div
                                      key={assignment.id}
                                      className={`flex items-center gap-2 px-3 py-2 group ${draggedSchedule?.id === assignment.id ? 'opacity-40' : ''}`}
                                      draggable
                                      onDragStart={(e) => { setDraggedSchedule(assignment); e.dataTransfer.effectAllowed = 'move'; }}
                                      onDragEnd={() => setDraggedSchedule(null)}
                                    >
                                      <GripVertical className="h-3 w-3 text-gray-300 cursor-grab shrink-0" />
                                      {/* Thumbnail */}
                                      <div className="relative shrink-0 w-10 h-10 rounded-lg overflow-hidden bg-gray-100 border border-gray-200">
                                        {assignment.video.thumbnailUrl ? (
                                          <img
                                            src={assignment.video.thumbnailUrl}
                                            alt={assignment.video.title}
                                            className="w-full h-full object-cover"
                                          />
                                        ) : (
                                          <div className="w-full h-full bg-gray-200 flex items-center justify-center">
                                            <Monitor className="h-4 w-4 text-gray-400" />
                                          </div>
                                        )}
                                        {/* Intensity dot badge */}
                                        <span
                                          className={`absolute bottom-0.5 right-0.5 w-2 h-2 rounded-full border border-white ${getIntensityStyle(assignment.video.intensity).dot}`}
                                          title={getIntensityStyle(assignment.video.intensity).label}
                                        />
                                      </div>
                                      {/* Title */}
                                      <span className="text-xs font-medium text-gray-800 truncate flex-1 min-w-0" title={assignment.video.title}>
                                        {assignment.video.title}
                                      </span>
                                      {/* Reps inline input */}
                                      <Input
                                        type="text"
                                        value={repsVal}
                                        onChange={(e) => setScheduleChanges(prev => ({ ...prev, [assignment.id]: { ...prev[assignment.id], reps: e.target.value } }))}
                                        onBlur={async (e) => {
                                          const newReps = e.target.value;
                                          if (newReps !== String(assignment.reps)) {
                                            try {
                                              await apiRequest("PATCH", `/api/schedules/${assignment.id}`, { reps: newReps });
                                              queryClient.setQueryData(["/api/schedules", "date", currentDate], (oldData: any) => {
                                                if (!oldData) return oldData;
                                                return oldData.map((s: any) => s.id === assignment.id ? { ...s, reps: newReps } : s);
                                              });
                                            } catch {}
                                          }
                                          setScheduleChanges(prev => { const n = { ...prev }; delete n[assignment.id]; return n; });
                                        }}
                                        onKeyDown={async (e) => {
                                          if (e.nativeEvent.isComposing) return;
                                          if (e.key === 'Enter' || e.key === 'Tab') {
                                            const newReps = e.currentTarget.value;
                                            if (newReps !== String(assignment.reps)) {
                                              try {
                                                await apiRequest("PATCH", `/api/schedules/${assignment.id}`, { reps: newReps });
                                                queryClient.setQueryData(["/api/schedules", "date", currentDate], (oldData: any) => {
                                                  if (!oldData) return oldData;
                                                  return oldData.map((s: any) => s.id === assignment.id ? { ...s, reps: newReps } : s);
                                                });
                                              } catch {}
                                            }
                                            setScheduleChanges(prev => { const n = { ...prev }; delete n[assignment.id]; return n; });
                                          }
                                        }}
                                        className="w-16 h-6 text-[11px] px-1.5 text-center shrink-0 border-gray-200"
                                      />
                                      {/* Equipment select */}
                                      <SearchableSelect
                                        options={allEquipmentOptions}
                                        value={defaultEquipment}
                                        onValueChange={async (value) => {
                                          try {
                                            await apiRequest("PATCH", `/api/schedules/${assignment.id}`, { displayEquipment: value });
                                            queryClient.setQueryData(["/api/schedules", "date", currentDate], (oldData: any) => {
                                              if (!oldData) return oldData;
                                              return oldData.map((s: any) => s.id === assignment.id ? { ...s, displayEquipment: value } : s);
                                            });
                                            queryClient.invalidateQueries({ queryKey: ["/api/schedules", "all"] });
                                          } catch {}
                                        }}
                                        placeholder="Equip."
                                        className="w-28 h-6 text-[11px] shrink-0"
                                        allowAll={false}
                                      />
                                      {/* Delete */}
                                      <button
                                        onClick={() => deleteScheduleMutation.mutate(assignment.id)}
                                        className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-all shrink-0"
                                        title="Remove"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              );
            })()}
          </TabsContent>

          {/* Workout Builder Tab */}
          <TabsContent value="builder" className="space-y-6">
            <WorkoutBuilder />
          </TabsContent>

          {/* Builder Config Tab */}
          <TabsContent value="builder-config" className="space-y-6">
            <BuilderConfig />
          </TabsContent>

          {/* Cache Tab */}
          <TabsContent value="cache" className="space-y-6">
            <EnhancedCacheDashboard />
            <CacheManager />
          </TabsContent>

          {/* Exercise Dictionary Tab */}
          <TabsContent value="dictionary" className="space-y-6">
            <Card>
              <CardContent className="pt-6">
                <ExerciseDictionary />
              </CardContent>
            </Card>
          </TabsContent>



          {/* Live View Tab */}
          <TabsContent value="liveview" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Monitor className="h-5 w-5" />
                    <span>Live Room Monitor</span>
                  </div>
                  
                  {/* Date Navigation */}
                  <div className="flex items-center space-x-4">
                    <Button
                      onClick={() => {
                        const currentDateObj = new Date(currentDate);
                        currentDateObj.setDate(currentDateObj.getDate() - 7);
                        setCurrentDate(currentDateObj.toISOString().split('T')[0]);
                      }}
                      variant="outline"
                      size="sm"
                    >
                      Previous Week
                    </Button>
                    
                    <div className="flex space-x-2 overflow-x-auto">
                      {(() => {
                        const dates = [];
                        const startDate = new Date(currentDate);
                        
                        // Find Monday of the current week
                        const currentDay = startDate.getDay();
                        const daysFromMonday = currentDay === 0 ? 6 : currentDay - 1;
                        startDate.setDate(startDate.getDate() - daysFromMonday);
                        
                        // Generate dates for the week (Monday to Saturday only)
                        for (let i = 0; i < 6; i++) {
                          const date = new Date(startDate);
                          date.setDate(startDate.getDate() + i);
                          
                          const dateString = date.toISOString().split('T')[0];
                          const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
                          const dayNumber = date.getDate();
                          
                          dates.push({ dateString, dayName, dayNumber, date });
                        }
                        
                        return dates.map(({ dateString, dayName, dayNumber }) => {
                          // Check if this date has complete schedule (all 10 rounds have at least 1 video)
                          const dateSchedules = schedules?.filter((s: any) => s.scheduleDate === dateString) || [];
                          const scheduledRooms = new Set(dateSchedules.map((s: any) => s.roomId));
                          const totalRounds = 10;
                          const isCompleteSchedule = scheduledRooms.size === totalRounds;
                          
                          return (
                            <Button
                              key={dateString}
                              onClick={() => setCurrentDate(dateString)}
                              variant={currentDate === dateString ? "default" : "outline"}
                              size="sm"
                              className={`whitespace-nowrap min-w-[60px] ${
                                currentDate === dateString 
                                  ? isCompleteSchedule 
                                    ? "bg-green-600 hover:bg-green-700 text-white" 
                                    : "bg-[hsl(207,90%,54%)] hover:bg-blue-700 text-white"
                                  : isCompleteSchedule 
                                  ? "bg-green-100 hover:bg-green-200 border-green-300 text-green-800"
                                  : "hover:bg-gray-100"
                              }`}
                            >
                              <div className="text-center">
                                <div className="text-xs">{dayName}</div>
                                <div className="font-semibold text-xs">{dayNumber}</div>
                              </div>
                            </Button>
                          );
                        });
                      })()}
                    </div>
                    
                    <Button
                      onClick={() => {
                        const currentDateObj = new Date(currentDate);
                        currentDateObj.setDate(currentDateObj.getDate() + 7);
                        setCurrentDate(currentDateObj.toISOString().split('T')[0]);
                      }}
                      variant="outline"
                      size="sm"
                    >
                      Next Week
                    </Button>
                  </div>
                </CardTitle>
                <CardDescription>
                  Clean video display for room positioning and sizing - {new Date(currentDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* Live View Grid - 4x smaller than actual room displays (480x270 each) */}
                <div className="flex flex-wrap gap-3 justify-start">
                  {rooms?.slice(0, 10).map((room: Room) => {
                    const { colorClass } = getRoomColorClasses(room.number);
                    const roomSchedules = schedules
                      .filter((s: any) => s.roomId === room.id && s.scheduleDate === currentDate)
                      .sort((a: any, b: any) => a.position - b.position); // Sort by position to maintain consistent order
                    const roomZoom = liveViewZoom[room.id] || 1;
                    
                    return (
                      <Card key={room.id} className="border-2" style={{ width: 'fit-content' }}>
                        <CardHeader className="p-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                              <div className={`w-5 h-5 ${colorClass} rounded-full flex items-center justify-center`}>
                                <span className="text-white text-xs font-bold">{room.number}</span>
                              </div>
                              <span className="text-xs font-medium">{room.name.split('(')[0].trim()}</span>
                            </div>

                          </div>
                        </CardHeader>
                        <CardContent className="p-1">
                          {/* Room Video Display - 4x smaller than actual room display (1920x1080 → 480x270) */}
                          <div className="bg-white border rounded mb-1 relative overflow-hidden" style={{ width: '480px', height: '270px', aspectRatio: '16/9' }}>
                            {roomSchedules.length > 0 ? (
                              <div className={`h-full ${roomSchedules.length <= 2 ? 'flex' : 'grid grid-cols-2 grid-rows-2'}`}>
                                {roomSchedules.slice(0, 4).map((schedule: any, index: number) => {
                                  const video = videos?.find((v: any) => v.id === schedule.videoId);
                                  if (!video) return null;
                                  
                                  const displayTitle = liveViewChanges[`${schedule.id}_title`] || schedule.displayTitle || video.title;
                                  const displayReps = liveViewChanges[`${schedule.id}_reps`] || schedule.reps;
                                  const displayEquipment = schedule.displayEquipment || video.equipment;
                                  
                                  const videoZoom = liveViewVideoZoom[schedule.id] || parseFloat(schedule.zoomLevel || "1");
                                  const verticalPos = liveViewVerticalPosition[schedule.id] || parseFloat(schedule.verticalPosition || "0");
                                  
                                  // Calculate if this is compact mode (3+ videos) for proper scaling
                                  const isCompactMode = roomSchedules.length >= 3;
                                  
                                  return (
                                    <div key={schedule.id} className={roomSchedules.length === 1 ? "w-1/2 mx-auto h-full relative" : roomSchedules.length <= 2 ? "flex-1 relative" : "relative"}>
                                      <video
                                        ref={(videoEl) => {
                                          if (videoEl) {
                                            console.log(`Loading video ${video.id} with URL: ${video.url}`);
                                            videoEl.addEventListener('loadeddata', () => {
                                              console.log(`Video ${video.id} loaded successfully`);
                                              videoEl.play().catch(err => console.log('Play failed:', err));
                                            });
                                            videoEl.addEventListener('error', (e) => {
                                              console.error(`Video ${video.id} error loading from ${video.url}:`, e);
                                            });
                                            videoEl.addEventListener('loadstart', () => {
                                              console.log(`Video ${video.id} started loading from ${video.url}`);
                                            });
                                          }
                                        }}
                                        src={video.url}
                                        className="w-full h-full"
                                        style={{
                                          objectFit: 'contain',
                                          objectPosition: 'center',
                                          transform: `scale(${videoZoom}) translateY(${verticalPos}px)`,
                                          transformOrigin: 'center'
                                        }}
                                        loop
                                        muted
                                        playsInline
                                        autoPlay
                                      />
                                      
                                      {/* Logo - Top Left (4x smaller than room display) */}
                                      <div className={`absolute ${isCompactMode ? 'top-2 left-2' : 'top-6 left-6'} z-20`}>
                                        <img 
                                          src={tenRoundsLogo}
                                          alt="10Rounds Logo"
                                          className={`${isCompactMode ? 'w-4 h-4' : 'w-6 h-6'} object-contain`}
                                        />
                                      </div>
                                      
                                      {/* Video Title - Top Center (4x smaller than room display) */}
                                      <div className={`absolute ${isCompactMode ? 'top-2' : 'top-6'} left-1/2 transform -translate-x-1/2 z-10`}>
                                        <div className="bg-white/90 backdrop-blur-sm rounded-lg text-center" style={{ 
                                          paddingLeft: isCompactMode ? '3px' : '6px',
                                          paddingRight: isCompactMode ? '3px' : '6px',
                                          paddingTop: isCompactMode ? '1.5px' : '3px',
                                          paddingBottom: isCompactMode ? '1.5px' : '3px'
                                        }}>
                                          <h3 className="font-bold text-black" style={{ fontSize: isCompactMode ? '4.5px' : '6px' }}>{displayTitle}</h3>
                                        </div>
                                      </div>
                                      
                                      {/* Reps Display - Top Right (4x smaller than room display) */}
                                      <div className={`absolute ${isCompactMode ? 'top-2 right-2' : 'top-6 right-6'} z-20`}>
                                        <div className={`bg-black/80 backdrop-blur-sm rounded-xl ${isCompactMode ? 'w-16 h-16 px-2 py-2' : 'w-24 h-24 px-4 py-4'} flex flex-col items-center justify-center text-center`} style={{ 
                                          width: isCompactMode ? '16px' : '24px', 
                                          height: isCompactMode ? '16px' : '24px',
                                          padding: isCompactMode ? '2px' : '4px'
                                        }}>
                                          {(() => {
                                            const repsStr = String(displayReps);
                                            const isOnlyNumber = /^\d+$/.test(repsStr);
                                            
                                            if (isOnlyNumber) {
                                              return (
                                                <>
                                                  <div className="font-bold text-white leading-none" style={{ fontSize: isCompactMode ? '4.5px' : '6px' }}>
                                                    {repsStr}
                                                  </div>
                                                  <div className="text-gray-300 uppercase tracking-wider leading-none" style={{ fontSize: isCompactMode ? '3px' : '3.5px' }}>
                                                    REPS
                                                  </div>
                                                </>
                                              );
                                            } else {
                                              const match = repsStr.match(/^(\d+)\s*(.+)$/);
                                              if (match) {
                                                const [, number, text] = match;
                                                return (
                                                  <div className="text-center leading-tight">
                                                    <div className="font-bold text-white leading-none" style={{ fontSize: isCompactMode ? '4.5px' : '6px' }}>
                                                      {number}
                                                    </div>
                                                    <div className="text-gray-300 uppercase tracking-wider leading-none" style={{ fontSize: isCompactMode ? '3px' : '3.5px' }}>
                                                      {text}
                                                    </div>
                                                  </div>
                                                );
                                              } else {
                                                return (
                                                  <div className="font-bold text-white text-center leading-tight" style={{ fontSize: isCompactMode ? '3.5px' : '4.5px' }}>
                                                    {repsStr}
                                                  </div>
                                                );
                                              }
                                            }
                                          })()}
                                        </div>
                                        
                                        {/* Equipment Display - Below reps (scaled for live view) */}
                                        {(() => {
                                          if (!displayEquipment) return null;
                                          const equipment = displayEquipment.split(',')[0].trim();
                                          if (!equipment) return null;
                                          
                                          return (
                                            <div className="mt-1 bg-black/60 backdrop-blur-sm rounded-lg text-center" style={{
                                              paddingLeft: isCompactMode ? '2px' : '3px',
                                              paddingRight: isCompactMode ? '2px' : '3px', 
                                              paddingTop: isCompactMode ? '1px' : '1.5px',
                                              paddingBottom: isCompactMode ? '1px' : '1.5px',
                                              marginTop: '0.25px'
                                            }}>
                                              <div className="text-gray-200 uppercase tracking-wide font-medium" style={{ fontSize: isCompactMode ? '3px' : '3.5px' }}>
                                                {equipment}
                                              </div>
                                            </div>
                                          );
                                        })()}
                                      </div>
                                      
                                      {/* Individual Video Controls */}
                                      <div className="absolute bottom-2 right-2 flex flex-col space-y-1">
                                        {/* Vertical Position Controls */}
                                        <div className="flex space-x-1">
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-6 w-6 p-0 bg-white/90"
                                            onClick={async () => {
                                              const newPos = verticalPos - 10;
                                              setLiveViewVerticalPosition(prev => ({
                                                ...prev,
                                                [schedule.id]: newPos
                                              }));
                                              
                                              // Save position to database
                                              try {
                                                await apiRequest('PATCH', `/api/schedules/${schedule.id}`, {
                                                  verticalPosition: newPos.toString()
                                                });
                                              } catch (error) {
                                                console.error('Failed to save vertical position:', error);
                                              }
                                            }}
                                          >
                                            <ChevronUp className="h-3 w-3" />
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-6 w-6 p-0 bg-white/90"
                                            onClick={async () => {
                                              const newPos = verticalPos + 10;
                                              setLiveViewVerticalPosition(prev => ({
                                                ...prev,
                                                [schedule.id]: newPos
                                              }));
                                              
                                              // Save position to database
                                              try {
                                                await apiRequest('PATCH', `/api/schedules/${schedule.id}`, {
                                                  verticalPosition: newPos.toString()
                                                });
                                              } catch (error) {
                                                console.error('Failed to save vertical position:', error);
                                              }
                                            }}
                                          >
                                            <ChevronDown className="h-3 w-3" />
                                          </Button>
                                        </div>
                                        {/* Zoom Controls */}
                                        <div className="flex space-x-1">
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-6 w-6 p-0 bg-white/90"
                                            onClick={async () => {
                                              const newZoom = Math.max(videoZoom - 0.1, 0.5);
                                              setLiveViewVideoZoom(prev => ({
                                                ...prev,
                                                [schedule.id]: newZoom
                                              }));
                                              
                                              // Save zoom to database
                                              try {
                                                await apiRequest('PATCH', `/api/schedules/${schedule.id}`, {
                                                  zoomLevel: newZoom.toString()
                                                });
                                                // Don't invalidate queries to prevent re-render and position change
                                              } catch (error) {
                                                console.error('Failed to save zoom level:', error);
                                              }
                                            }}
                                          >
                                            <ZoomOut className="h-3 w-3" />
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-6 w-6 p-0 bg-white/90"
                                            onClick={async () => {
                                              const newZoom = Math.min(videoZoom + 0.1, 2);
                                              setLiveViewVideoZoom(prev => ({
                                                ...prev,
                                                [schedule.id]: newZoom
                                              }));
                                              
                                              // Save zoom to database
                                              try {
                                                await apiRequest('PATCH', `/api/schedules/${schedule.id}`, {
                                                  zoomLevel: newZoom.toString()
                                                });
                                                // Don't invalidate queries to prevent re-render and position change
                                              } catch (error) {
                                                console.error('Failed to save zoom level:', error);
                                              }
                                            }}
                                          >
                                            <ZoomIn className="h-3 w-3" />
                                          </Button>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                                
                                {/* Vertical divider for 2 videos */}
                                {roomSchedules.length === 2 && (
                                  <div className="absolute top-0 left-1/2 h-full w-px bg-black transform -translate-x-px z-10"></div>
                                )}
                                
                                {/* Grid dividers for 3-4 videos */}
                                {roomSchedules.length >= 3 && (
                                  <>
                                    <div className="absolute top-0 left-1/2 h-full w-px bg-black transform -translate-x-px z-10"></div>
                                    <div className="absolute left-0 top-1/2 w-full h-px bg-black transform -translate-y-px z-10"></div>
                                  </>
                                )}
                              </div>
                            ) : (
                              <div className="h-full flex items-center justify-center text-gray-400">
                                <div className="text-center">
                                  <VideoIcon className="h-8 w-8 mx-auto mb-1" />
                                  <p className="text-xs">No videos</p>
                                </div>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

        </Tabs>
      </div>

      {/* Video Assignment Modal */}
      <VideoAssignmentModal
        isOpen={isAssignmentModalOpen}
        onClose={() => {
          setIsAssignmentModalOpen(false);
          setSelectedVideo(null);
          setSelectedRoom(null);
        }}
        selectedVideo={selectedVideo}
        selectedRoom={selectedRoom}
        rooms={rooms || []}
        currentDate={currentDate}
      />

      {/* Video Upload Modal */}
      <VideoUploadModal
        isOpen={isVideoUploadModalOpen}
        onClose={() => setIsVideoUploadModalOpen(false)}
      />

      {/* Bulk Upload Modal */}
      <SimpleBulkUploadModal
        isOpen={isSimpleBulkUploadModalOpen}
        onClose={() => setIsSimpleBulkUploadModalOpen(false)}
      />

      {/* Video Edit Modal */}
      <VideoEditModal
        isOpen={isVideoEditModalOpen}
        onClose={() => {
          setIsVideoEditModalOpen(false);
          setEditingVideo(null);
        }}
        video={editingVideo}
      />

      {/* Simple Video Preview Modal */}
      {videoPreview && (
        <div 
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={closeVideoPreview}
        >
          <div 
            className="relative bg-black rounded-lg max-w-3xl w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={closeVideoPreview}
              className="absolute -top-10 right-0 text-white hover:text-gray-300 bg-black/50 rounded p-2"
            >
              <X className="h-5 w-5" />
            </button>
            
            <video
              key={videoPreview.key}
              src={videoPreview.url}
              className="w-full rounded-lg"
              controls
              muted
              loop
              playsInline
              preload="none"
              poster={`/uploads/thumbnails/${videoPreview.url.split('/').pop()?.replace(/\.[^/.]+$/, '')}.jpg`}
              style={{ maxHeight: '80vh' }}
            />
            
            <div className="p-3 text-white text-center text-sm bg-black/50 rounded-b-lg">
              {videoPreview.title}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function TrainerDashboard() {
  return (
    <QueryClientProvider client={sharedQueryClient}>
      <TrainerDashboardInner />
    </QueryClientProvider>
  );
}
