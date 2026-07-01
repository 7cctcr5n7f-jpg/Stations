"use client"

import { useState, useEffect, useMemo, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Trash2, X, Sparkles, Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { SimpleMultiSelect } from "@/components/simple-multi-select";
import { getIntensityStyle, INTENSITY_LEVELS } from "@/lib/intensity";
import type { Video } from "@/lib/shared/schema";

interface VideoEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  video: Video | null;
}

interface VideoEditData {
  title: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipment: string[];
  movementPattern: string;
  intensity: string;
  exerciseType: string;
  explosive: boolean;
  weightRequired: boolean;
  spaceRequirement: string;
  boxingType: string;
}

const EXERCISE_TYPES = ["Strength", "Cardio", "Conditioning", "Skill", "Mobility"];
const SPACE_REQUIREMENTS = ["Stationary", "Small", "Large"];

export default function VideoEditModal({ isOpen, onClose, video }: VideoEditModalProps) {
  const [formData, setFormData] = useState<VideoEditData>({
    title: "",
    primaryMuscles: [],
    secondaryMuscles: [],
    equipment: [],
    movementPattern: "",
    intensity: "",
    exerciseType: "",
    explosive: false,
    weightRequired: false,
    spaceRequirement: "",
    boxingType: "",
  });
  

  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch video options for dynamic dropdowns
  const { data: videoOptions } = useQuery<{bodyParts: string[], secondaryMuscles: string[], equipment: string[]}>({
    queryKey: ["/api/video-options"],
    enabled: isOpen,
  });

  // Get unique values from existing videos
  const uniquePrimaryMuscles = useMemo(() => {
    if (!videoOptions?.bodyParts) return [];
    return videoOptions.bodyParts.sort((a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }, [videoOptions]);

  const uniqueSecondaryMuscles = useMemo(() => {
    if (!videoOptions?.secondaryMuscles) return [];
    return videoOptions.secondaryMuscles.sort((a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }, [videoOptions]);

  const uniqueEquipment = useMemo(() => {
    if (!videoOptions?.equipment) return [];
    return videoOptions.equipment.sort((a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }, [videoOptions]);

  // Initialize form data when video changes
  useEffect(() => {
    if (video) {
      setFormData({
        title: video.title,
        primaryMuscles: video.bodyPart ? video.bodyPart.split(',').map(item => item.trim()) : [],
        secondaryMuscles: video.secondaryMuscle && video.secondaryMuscle !== "" ? video.secondaryMuscle.split(',').map(item => item.trim()) : [],
        equipment: video.equipment ? video.equipment.split(',').map(item => item.trim()) : [],
        movementPattern: video.movementPattern ?? "",
        intensity: video.intensity ?? "",
        exerciseType: (video.exerciseType as string) ?? "",
        explosive: video.explosive ?? false,
        weightRequired: video.weightRequired ?? false,
        spaceRequirement: (video.spaceRequirement as string) ?? "",
        boxingType: video.boxingType ?? "",
      });
    }
  }, [video]);

  // Optimized handlers using SimpleMultiSelect
  const handlePrimaryMuscleChange = (muscles: string[]) => {
    setFormData(prev => ({
      ...prev,
      primaryMuscles: muscles
    }));
  };

  const handleSecondaryMuscleChange = (muscles: string[]) => {
    setFormData(prev => ({
      ...prev,
      secondaryMuscles: muscles
    }));
  };

  const handleEquipmentChange = (equipment: string[]) => {
    setFormData(prev => ({
      ...prev,
      equipment: equipment
    }));
  };

  // Handle new custom entries
  const handleNewPrimaryMuscle = async (newMuscle: string) => {
    try {
      await apiRequest("POST", '/api/video-options/add-body-part', { bodyPart: newMuscle });
      // Refresh video options to include the new entry
      queryClient.invalidateQueries({ queryKey: ["/api/video-options"] });
    } catch (error) {
      console.error('Failed to save new body part:', error);
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

  const updateVideoMutation = useMutation({
    mutationFn: async (data: VideoEditData) => {
      // Update each field individually using the correct API format
      const updates = [
        { field: 'title', value: data.title },
        { field: 'bodyPart', value: data.primaryMuscles.join(', ') },
        { field: 'secondaryMuscle', value: data.secondaryMuscles.join(', ') },
        { field: 'equipment', value: data.equipment.join(', ') },
        { field: 'movementPattern', value: data.movementPattern },
        { field: 'intensity', value: data.intensity },
        { field: 'exerciseType', value: data.exerciseType },
        { field: 'explosive', value: data.explosive },
        { field: 'weightRequired', value: data.weightRequired },
        { field: 'spaceRequirement', value: data.spaceRequirement },
        { field: 'boxingType', value: data.boxingType },
      ];

      // Execute all updates
      for (const update of updates) {
        await apiRequest("PATCH", `/api/videos/${video?.id}`, update);
      }
      
      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
      queryClient.invalidateQueries({ queryKey: ["/api/video-options"] });
      toast({
        title: "Video updated successfully",
        description: "The video details have been saved.",
      });
      handleClose();
    },
    onError: () => {
      toast({
        title: "Error updating video",
        description: "Please try again.",
        variant: "destructive",
      });
    },
  });

  const deleteVideoMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("DELETE", `/api/videos/${video?.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/video-options"] });
      toast({
        title: "Video deleted successfully",
        description: "The video and all associated schedules have been removed.",
      });
      handleClose();
    },
    onError: () => {
      toast({
        title: "Error deleting video",
        description: "Please try again.",
        variant: "destructive",
      });
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/videos/ai-metadata", {
        mode: "regenerate",
        ids: [video?.id],
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
      const updated = data?.processed?.[0] as Video | undefined;
      if (updated) {
        setFormData(prev => ({
          ...prev,
          movementPattern: updated.movementPattern ?? prev.movementPattern,
          intensity: updated.intensity ?? prev.intensity,
          exerciseType: (updated.exerciseType as string) ?? prev.exerciseType,
          explosive: updated.explosive ?? prev.explosive,
          weightRequired: updated.weightRequired ?? prev.weightRequired,
          spaceRequirement: (updated.spaceRequirement as string) ?? prev.spaceRequirement,
          boxingType: updated.boxingType ?? prev.boxingType,
        }));
      }
      toast({ title: "AI metadata regenerated", description: "Review and save your changes." });
    },
    onError: () => {
      toast({ title: "Failed to regenerate", description: "Please try again.", variant: "destructive" });
    },
  });

  const handleClose = () => {
    setFormData({
      title: "",
      primaryMuscles: [],
      secondaryMuscles: [],
      equipment: [],
      movementPattern: "",
      intensity: "",
      exerciseType: "",
      explosive: false,
      weightRequired: false,
      spaceRequirement: "",
      boxingType: "",
    });

    onClose();
  };

  const handleSubmit = () => {
    if (!formData.title || formData.primaryMuscles.length === 0 || formData.equipment.length === 0) {
      toast({
        title: "Missing required fields",
        description: "Please fill in title, at least one primary muscle, and at least one equipment",
        variant: "destructive"
      });
      return;
    }

    updateVideoMutation.mutate(formData);
  };

  const handleDelete = () => {
    if (confirm("Are you sure you want to delete this video? This will also remove all associated schedules.")) {
      deleteVideoMutation.mutate();
    }
  };

  if (!video) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Video</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Video Thumbnail */}
          <div className="flex items-center space-x-4 p-4 bg-gray-50 rounded-lg">
            <div className="w-32 h-20 bg-gray-900 rounded-lg flex items-center justify-center overflow-hidden">
              <video 
                src={video.url} 
                className="w-full h-full object-cover"
                muted
                preload="metadata"
                poster="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='128' height='80' viewBox='0 0 128 80'%3E%3Crect width='128' height='80' fill='%23374151'/%3E%3Ctext x='64' y='40' text-anchor='middle' dy='0.3em' fill='%23fff' font-family='sans-serif' font-size='12'%3EVideo%3C/text%3E%3C/svg%3E"
              />
            </div>
            <div className="flex-1">
              <h3 className="font-medium text-gray-900">{video.title}</h3>
              <p className="text-sm text-gray-600">Duration: {video.duration}</p>
              <p className="text-xs text-gray-500 mt-1">Last used: {video.lastUsed ? new Date(video.lastUsed).toLocaleDateString() : 'Never'}</p>
            </div>
          </div>

          {/* Video Title */}
          <div className="space-y-2">
            <Label htmlFor="title">Video Title *</Label>
            <Input
              id="title"
              type="text"
              placeholder="Enter video title"
              value={formData.title}
              onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
            />
          </div>

          {/* Primary Muscles */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Primary Muscles *</Label>
            <SimpleMultiSelect
              options={uniquePrimaryMuscles}
              selectedValues={formData.primaryMuscles}
              onSelectionChange={handlePrimaryMuscleChange}
              onNewItemAdded={handleNewPrimaryMuscle}
              placeholder="Select primary muscles..."
              className="w-full"
            />
          </div>

          {/* Secondary Muscles */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Secondary Muscles</Label>
            <SimpleMultiSelect
              options={uniqueSecondaryMuscles}
              selectedValues={formData.secondaryMuscles}
              onSelectionChange={handleSecondaryMuscleChange}
              onNewItemAdded={handleNewSecondaryMuscle}
              placeholder="Select secondary muscles..."
              className="w-full"
            />
          </div>

          {/* Equipment */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Equipment *</Label>
            <SimpleMultiSelect
              options={uniqueEquipment}
              selectedValues={formData.equipment}
              onSelectionChange={handleEquipmentChange}
              onNewItemAdded={handleNewEquipment}
              placeholder="Select equipment..."
              className="w-full"
            />
          </div>

          {/* AI Metadata */}
          <div className="space-y-4 rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-blue-600" />
                <Label className="text-sm font-semibold">Training Metadata</Label>
                {video.aiConfidence != null && (
                  <Badge variant="secondary" className="text-[10px]">
                    AI confidence {video.aiConfidence}%
                  </Badge>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => regenerateMutation.mutate()}
                disabled={regenerateMutation.isPending}
              >
                {regenerateMutation.isPending ? (
                  <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-3 w-3" />
                )}
                Regenerate
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Intensity */}
              <div className="space-y-1.5">
                <Label className="text-xs">Intensity (heart-rate zone)</Label>
                <Select
                  value={formData.intensity || "unset"}
                  onValueChange={(value) =>
                    setFormData(prev => ({ ...prev, intensity: value === "unset" ? "" : value }))
                  }
                >
                  <SelectTrigger className="h-9 text-xs">
                    <span className="flex items-center gap-1.5">
                      <span className={`h-2.5 w-2.5 rounded-full ${getIntensityStyle(formData.intensity).dot}`} />
                      {formData.intensity || "Unset"}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {INTENSITY_LEVELS.map((level) => (
                      <SelectItem key={level} value={level}>{level}</SelectItem>
                    ))}
                    <SelectItem value="unset">Unset</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Exercise Type */}
              <div className="space-y-1.5">
                <Label className="text-xs">Exercise Type</Label>
                <Select
                  value={formData.exerciseType || "unset"}
                  onValueChange={(value) =>
                    setFormData(prev => ({ ...prev, exerciseType: value === "unset" ? "" : value }))
                  }
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {EXERCISE_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                    <SelectItem value="unset">Unset</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Movement Pattern */}
              <div className="space-y-1.5">
                <Label className="text-xs">Movement Pattern</Label>
                <Input
                  className="h-9 text-xs"
                  placeholder="e.g. Squat, Push, Punch"
                  value={formData.movementPattern}
                  onChange={(e) => setFormData(prev => ({ ...prev, movementPattern: e.target.value }))}
                />
              </div>

              {/* Space Requirement */}
              <div className="space-y-1.5">
                <Label className="text-xs">Space Requirement</Label>
                <Select
                  value={formData.spaceRequirement || "unset"}
                  onValueChange={(value) =>
                    setFormData(prev => ({ ...prev, spaceRequirement: value === "unset" ? "" : value }))
                  }
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Select space" />
                  </SelectTrigger>
                  <SelectContent>
                    {SPACE_REQUIREMENTS.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                    <SelectItem value="unset">Unset</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Boxing Type */}
              <div className="space-y-1.5">
                <Label className="text-xs">Boxing Type (optional)</Label>
                <Input
                  className="h-9 text-xs"
                  placeholder="e.g. Combination, Pad Work"
                  value={formData.boxingType}
                  onChange={(e) => setFormData(prev => ({ ...prev, boxingType: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex items-center gap-6 pt-1">
              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.explosive}
                  onCheckedChange={(checked) => setFormData(prev => ({ ...prev, explosive: checked }))}
                />
                <Label className="text-xs">Explosive / Plyometric</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.weightRequired}
                  onCheckedChange={(checked) => setFormData(prev => ({ ...prev, weightRequired: checked }))}
                />
                <Label className="text-xs">Weight Required</Label>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-between items-center pt-4 border-t">
            <Button 
              onClick={handleDelete}
              disabled={deleteVideoMutation.isPending}
              variant="outline"
              className="text-red-600 border-red-300 hover:bg-red-50 hover:border-red-400"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {deleteVideoMutation.isPending ? "Deleting..." : "Delete Video"}
            </Button>
            
            <div className="flex space-x-4">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button 
                onClick={handleSubmit}
                disabled={updateVideoMutation.isPending}
                className="bg-[hsl(207,90%,54%)] hover:bg-blue-700"
              >
                {updateVideoMutation.isPending ? "Updating..." : "Update Video"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
