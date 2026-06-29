import { useState, useMemo, useEffect } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Check, Play, Filter, Clock, CheckCircle, Calendar } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatTimeAgo } from "@/lib/utils";
import type { Video, Room, Schedule } from "@shared/schema";
import VideoThumbnail from "./video-thumbnail";
import ImageThumbnail from "./image-thumbnail";

interface VideoAssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedVideo: Video | null;
  selectedRoom: number | null;
  rooms: Room[];
  currentDate: string;
}

export default function VideoAssignmentModal({
  isOpen,
  onClose,
  selectedVideo,
  selectedRoom,
  rooms,
  currentDate,
}: VideoAssignmentModalProps) {
  const [roomId, setRoomId] = useState<string>(selectedRoom?.toString() || "");

  // Update roomId when selectedRoom changes
  useEffect(() => {
    if (selectedRoom) {
      setRoomId(selectedRoom.toString());
    }
  }, [selectedRoom]);

  // Reset selected videos when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setSelectedVideoIds(selectedVideo ? [selectedVideo.id] : []);
    } else {
      setSelectedVideoIds([]);
    }
  }, [isOpen, selectedVideo]);
  const [selectedVideoIds, setSelectedVideoIds] = useState<number[]>([]);
  
  // Filter states
  const [bodyPartFilter, setBodyPartFilter] = useState<string>("all");
  const [secondaryMuscleFilter, setSecondaryMuscleFilter] = useState<string>("all");
  const [equipmentFilter, setEquipmentFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [lastUsedFilter, setLastUsedFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState<string>("");
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

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

  // Fetch all videos
  const { data: videos = [] } = useQuery<Video[]>({
    queryKey: ["/api/videos"],
    enabled: isOpen,
  });

  // Fetch all schedules to show which videos are scheduled
  const { data: schedules = [] } = useQuery<Schedule[]>({
    queryKey: ["/api/schedules", "all"],
    queryFn: async () => {
      const response = await fetch(`/api/schedules`);
      return response.json();
    },
    enabled: isOpen,
  });

  // Filter videos based on criteria - handle comma-separated values
  const filteredVideos = useMemo(() => {
    return videos.filter(video => {
      // Check category filter first
      const matchesCategory = categoryFilter === "all" || 
        deriveCategories(video.bodyPart, video.equipment).includes(categoryFilter);

      // Check primary muscles (bodyPart)
      const matchesBodyPart = bodyPartFilter === "all" || 
        (video.bodyPart && video.bodyPart.split(',').some(part => 
          part.trim().toLowerCase() === bodyPartFilter.toLowerCase()
        ));
      
      // Check secondary muscles
      const matchesSecondaryMuscle = secondaryMuscleFilter === "all" || 
        (secondaryMuscleFilter === "none" && (!video.secondaryMuscle || video.secondaryMuscle === "none")) ||
        (video.secondaryMuscle && video.secondaryMuscle !== "none" && 
         video.secondaryMuscle.split(',').some(muscle => 
           muscle.trim().toLowerCase() === secondaryMuscleFilter.toLowerCase()
         ));
      
      // Check equipment
      const matchesEquipment = equipmentFilter === "all" || 
        (video.equipment && video.equipment.split(',').some(eq => 
          eq.trim().toLowerCase() === equipmentFilter.toLowerCase()
        ));
      
      // Check last used filter
      let matchesLastUsed = true;
      if (lastUsedFilter !== "all") {
        const videoSchedules = schedules.filter(s => s.videoId === video.id);
        const today = new Date();
        const pastSchedules = videoSchedules.filter(s => new Date(s.scheduleDate) < today);
        
        if (lastUsedFilter === "never") {
          matchesLastUsed = pastSchedules.length === 0;
        } else {
          const mostRecent = pastSchedules.length > 0 
            ? Math.max(...pastSchedules.map(s => new Date(s.scheduleDate).getTime()))
            : 0;
          
          if (mostRecent === 0) {
            matchesLastUsed = lastUsedFilter === "never";
          } else {
            const daysSince = Math.floor((today.getTime() - mostRecent) / (1000 * 60 * 60 * 24));
            
            switch (lastUsedFilter) {
              case "week":
                matchesLastUsed = daysSince >= 7;
                break;
              case "month":
                matchesLastUsed = daysSince >= 30;
                break;
              case "2months":
                matchesLastUsed = daysSince >= 60;
                break;
              case "3months":
                matchesLastUsed = daysSince >= 90;
                break;
              default:
                matchesLastUsed = true;
            }
          }
        }
      }
      
      // Check search term
      const matchesSearch = searchTerm === "" || video.title.toLowerCase().includes(searchTerm.toLowerCase());
      
      return matchesCategory && matchesBodyPart && matchesSecondaryMuscle && matchesEquipment && matchesLastUsed && matchesSearch;
    }).sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
  }, [videos, categoryFilter, bodyPartFilter, secondaryMuscleFilter, equipmentFilter, lastUsedFilter, schedules, searchTerm]);

  // Get unique values for filters - handle comma-separated values
  const bodyParts = useMemo(() => {
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

  const secondaryMuscles = useMemo(() => {
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

  const equipmentTypes = useMemo(() => {
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

  const categories = useMemo(() => {
    const cats = new Set<string>();
    videos.forEach(video => {
      const videoCategories = deriveCategories(video.bodyPart, video.equipment);
      videoCategories.forEach(category => cats.add(category));
    });
    return Array.from(cats).sort((a, b) => {
      // Sort so "Missing" comes last
      if (a === 'Missing' && b !== 'Missing') return 1;
      if (b === 'Missing' && a !== 'Missing') return -1;
      return a.localeCompare(b);
    });
  }, [videos]);

  const assignVideosMutation = useMutation({
    mutationFn: async (videoIds: number[]) => {
      // Process videos sequentially, automatically assigning positions
      for (let i = 0; i < videoIds.length; i++) {
        await apiRequest("POST", "/api/schedules", {
          roomId: parseInt(roomId),
          videoId: videoIds[i],
          sets: 1,
          reps: 15, // Default reps, can be edited on schedule page
          restTime: 0,
          position: i + 1, // Auto-assign position 1, 2
          scheduleDate: currentDate,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules", "date", currentDate] });
      queryClient.invalidateQueries({ queryKey: ["/api/schedules", "all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: `${selectedVideoIds.length} video(s) scheduled successfully` });
      onClose();
    },
    onError: () => {
      toast({ 
        title: "Failed to schedule videos", 
        description: "Please try again",
        variant: "destructive" 
      });
    },
  });

  // Calculate how many videos are already scheduled for the selected room on current date
  const existingSchedulesForRoom = useMemo(() => {
    if (!roomId || !currentDate) return [];
    return schedules.filter(schedule => 
      schedule.roomId === parseInt(roomId) && schedule.scheduleDate === currentDate
    );
  }, [schedules, roomId, currentDate]);

  // Calculate maximum videos that can be selected (4 total - existing)
  const maxSelectableVideos = Math.max(0, 4 - existingSchedulesForRoom.length);

  const handleAssign = () => {
    if (selectedVideoIds.length === 0 || !roomId) return;
    assignVideosMutation.mutate(selectedVideoIds);
  };

  const toggleVideoSelection = (videoId: number) => {
    setSelectedVideoIds(prev => {
      if (prev.includes(videoId)) {
        return prev.filter(id => id !== videoId);
      } else if (prev.length < maxSelectableVideos) {
        return [...prev, videoId];
      } else if (maxSelectableVideos > 0) {
        // Replace the first selected video if already at max
        return [...prev.slice(1), videoId];
      } else {
        // Can't select any videos if room is full
        return prev;
      }
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-7xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Filter className="h-5 w-5" />
            <span>Select Video for Room</span>
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Room Selection */}
          <div>
            <Label htmlFor="room-select" className="text-sm font-medium mb-2 block">
              {selectedRoom ? "Assigning to Room" : "Select Room"}
            </Label>
            {selectedRoom ? (
              <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-md text-sm">
                Round {rooms.find(r => r.id === selectedRoom)?.number} - {rooms.find(r => r.id === selectedRoom)?.name}
              </div>
            ) : (
              <Select value={roomId} onValueChange={setRoomId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a room" />
                </SelectTrigger>
                <SelectContent>
                  {rooms.map((room) => (
                    <SelectItem key={room.id} value={room.id.toString()}>
                      Round {room.number} - {room.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Search Filter and Action Buttons */}
          <div className="mb-4 flex items-center justify-between gap-4">
            <Input
              type="text"
              placeholder="Search videos..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-md"
            />
            <div className="flex space-x-2">
              <Button
                onClick={handleAssign}
                disabled={selectedVideoIds.length === 0 || !roomId || assignVideosMutation.isPending || maxSelectableVideos === 0}
                className="bg-[hsl(207,90%,54%)] hover:bg-blue-700 disabled:opacity-50"
              >
                <Check className="mr-2 h-4 w-4" />
                {assignVideosMutation.isPending ? "Scheduling..." : 
                 maxSelectableVideos === 0 ? "Room Full" : 
                 `Schedule ${selectedVideoIds.length} Video${selectedVideoIds.length > 1 ? 's' : ''}`}
              </Button>
              <Button
                onClick={onClose}
                variant="outline"
                className="bg-gray-500 hover:bg-gray-600 text-white border-gray-500 hover:border-gray-600"
              >
                Cancel
              </Button>
            </div>
          </div>

          {/* Video Table with Column Filters */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <Label className="text-sm font-medium">
                {maxSelectableVideos === 0 ? (
                  <span className="text-red-600">Room is full (4/4 videos). Remove existing videos to add new ones.</span>
                ) : (
                  <>
                    Select up to {maxSelectableVideos} video{maxSelectableVideos !== 1 ? 's' : ''} 
                    {existingSchedulesForRoom.length > 0 && (
                      <span className="text-gray-600"> ({existingSchedulesForRoom.length}/4 slots used)</span>
                    )}
                    <span className="text-gray-500 text-xs block mt-1">
                      1 video = full center, 2-4 videos = grid layout
                    </span>
                  </>
                )}
              </Label>
              {maxSelectableVideos > 0 && (
                <div className="text-sm">
                  <span className="font-medium text-blue-600">{selectedVideoIds.length}</span>
                  <span className="text-gray-500">/{maxSelectableVideos} selected</span>
                </div>
              )}
            </div>
            <div className="border rounded-lg overflow-hidden max-h-96 overflow-y-auto">
              <Table className="text-xs">
                <TableHeader className="sticky top-0 bg-gray-50 z-10">
                  {/* Column Headers */}
                  <TableRow>
                    <TableHead className="w-8 p-2 text-xs">Select</TableHead>
                    <TableHead className="w-12 p-2 text-xs">Thumbnail</TableHead>
                    <TableHead className="p-2 text-xs">Video</TableHead>
                    <TableHead className="p-2 text-xs">Category</TableHead>
                    <TableHead className="p-2 text-xs">Primary Muscle</TableHead>
                    <TableHead className="p-2 text-xs">Secondary Muscle</TableHead>
                    <TableHead className="p-2 text-xs">Equipment</TableHead>
                    <TableHead className="p-2 text-xs">Last Scheduled</TableHead>
                    <TableHead className="p-2 text-xs">Usage Count</TableHead>
                    <TableHead className="p-2 text-xs">Future Schedule</TableHead>
                  </TableRow>
                  {/* Column Filters */}
                  <TableRow className="bg-gray-100">
                    <TableHead className="p-1"></TableHead>
                    <TableHead className="p-1"></TableHead>
                    <TableHead className="p-1"></TableHead>
                    <TableHead className="p-1">
                      <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue placeholder="All" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          {categories.map((category) => (
                            <SelectItem key={category} value={category}>{category}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableHead>
                    <TableHead className="p-1">
                      <Select value={bodyPartFilter} onValueChange={setBodyPartFilter}>
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue placeholder="All" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          {bodyParts.map((part) => (
                            <SelectItem key={part} value={part}>{part}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableHead>
                    <TableHead className="p-1">
                      <Select value={secondaryMuscleFilter} onValueChange={setSecondaryMuscleFilter}>
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue placeholder="All" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          <SelectItem value="none">None</SelectItem>
                          {secondaryMuscles.map((muscle) => (
                            <SelectItem key={muscle} value={muscle}>{muscle}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableHead>
                    <TableHead className="p-1">
                      <Select value={equipmentFilter} onValueChange={setEquipmentFilter}>
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue placeholder="All" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          {equipmentTypes.map((equipment) => (
                            <SelectItem key={equipment} value={equipment}>{equipment}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableHead>
                    <TableHead className="p-1">
                      <Select value={lastUsedFilter} onValueChange={setLastUsedFilter}>
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue placeholder="All" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          <SelectItem value="never">Never used</SelectItem>
                          <SelectItem value="week">More than a week ago</SelectItem>
                          <SelectItem value="month">More than a month ago</SelectItem>
                          <SelectItem value="2months">More than 2 months ago</SelectItem>
                          <SelectItem value="3months">More than 3 months ago</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableHead>
                    <TableHead className="p-1"></TableHead>
                    <TableHead className="p-1"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredVideos.map((video) => {
                    // Get all schedules for this video
                    const videoSchedules = schedules.filter(s => s.videoId === video.id);
                    
                    // Separate past and future schedules
                    const today = new Date().toISOString().split('T')[0];
                    const pastSchedules = videoSchedules.filter(s => s.scheduleDate < today);
                    const futureSchedules = videoSchedules.filter(s => s.scheduleDate >= today);
                    
                    // Get the most recent past schedule date
                    const lastScheduledDate = pastSchedules.length > 0 
                      ? pastSchedules.sort((a, b) => b.scheduleDate.localeCompare(a.scheduleDate))[0].scheduleDate
                      : null;
                    
                    // Get the next future schedule date
                    const nextScheduledDate = futureSchedules.length > 0
                      ? futureSchedules.sort((a, b) => a.scheduleDate.localeCompare(b.scheduleDate))[0].scheduleDate
                      : null;
                    
                    // Usage count is total past schedules
                    const usageCount = pastSchedules.length;
                    
                    return (
                      <TableRow
                        key={video.id}
                        className={`cursor-pointer hover:bg-gray-50 ${
                          selectedVideoIds.includes(video.id) ? 'bg-blue-50 border-blue-200' : ''
                        }`}
                        onClick={() => toggleVideoSelection(video.id)}
                      >
                        <TableCell className="text-center p-2">
                          {selectedVideoIds.includes(video.id) && (
                            <div className="w-4 h-4 bg-blue-600 text-white rounded-full flex items-center justify-center mx-auto">
                              <span className="text-xs font-bold">{selectedVideoIds.indexOf(video.id) + 1}</span>
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="p-2">
                          <ImageThumbnail video={video} size="small" showPlayButton={false} />
                        </TableCell>
                        <TableCell className="font-medium p-2 text-xs">{video.title}</TableCell>
                        <TableCell className="p-2">
                          <div className="flex flex-wrap gap-1">
                            {deriveCategories(video.bodyPart, video.equipment).map((category, index) => (
                              <div key={index} className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                                category === 'Missing' 
                                  ? 'bg-gray-100 text-gray-800' 
                                  : category === 'HIIT'
                                  ? 'bg-red-100 text-red-800'
                                  : 'bg-blue-100 text-blue-800'
                              }`}>
                                {category}
                              </div>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="p-2">
                          <Badge variant="secondary" className="bg-green-100 text-green-800 text-xs px-1 py-0">
                            {video.bodyPart}
                          </Badge>
                        </TableCell>
                        <TableCell className="p-2">
                          {video.secondaryMuscle ? (
                            <Badge variant="outline" className="bg-blue-50 text-blue-800 text-xs px-1 py-0">
                              {video.secondaryMuscle}
                            </Badge>
                          ) : (
                            <span className="text-gray-400 text-xs">-</span>
                          )}
                        </TableCell>
                        <TableCell className="p-2">
                          <Badge variant="outline" className="text-xs px-1 py-0">
                            {video.equipment}
                          </Badge>
                        </TableCell>
                        <TableCell className="p-2">
                          {lastScheduledDate ? (
                            <div className="flex items-center space-x-1 text-xs">
                              <Clock className="h-3 w-3 text-gray-400" />
                              <span>{new Date(lastScheduledDate).toLocaleDateString()}</span>
                            </div>
                          ) : (
                            <span className="text-green-600 text-xs font-medium">Never scheduled</span>
                          )}
                        </TableCell>
                        <TableCell className="p-2">
                          <span className="text-xs font-medium text-gray-700">
                            {usageCount} time{usageCount !== 1 ? 's' : ''}
                          </span>
                        </TableCell>
                        <TableCell className="p-2">
                          {nextScheduledDate ? (
                            <div className="flex items-center space-x-1">
                              <Calendar className="h-3 w-3 text-blue-600" />
                              <span className="text-blue-600 text-xs font-medium">
                                {new Date(nextScheduledDate).toLocaleDateString()}
                                {futureSchedules.length > 1 && ` (+${futureSchedules.length - 1})`}
                              </span>
                            </div>
                          ) : (
                            <span className="text-gray-400 text-xs">None scheduled</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Configuration */}
          {selectedVideoIds.length > 0 && (
            <div className="pt-4 border-t space-y-3">
              <div className="text-xs text-gray-600 bg-blue-50 p-3 rounded-lg">
                <strong>Auto Screen Positioning:</strong>
                <br />
                • 1 video selected = Full center display
                <br />
                • 2 videos selected = Split screen (left/right)
                <br />
                <br />
                <strong>Note:</strong> Repetitions can be edited on the main schedule page after assignment.
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
