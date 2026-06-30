"use client"

import { useState, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/searchable-select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Upload, X, FileVideo, Plus, Sparkles, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { getIntensityStyle } from "@/lib/intensity";

interface VideoUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface AiMeta {
  movementPattern: string;
  intensity: string;
  exerciseType: string;
  explosive: boolean;
  weightRequired: boolean;
  spaceRequirement: string;
  boxingType: string;
  confidence: number | null;
}

const EMPTY_AI_META: AiMeta = {
  movementPattern: "",
  intensity: "",
  exerciseType: "",
  explosive: false,
  weightRequired: false,
  spaceRequirement: "",
  boxingType: "",
  confidence: null,
};

interface VideoFormData {
  title: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipment: string[];
  file: File | null;
}

interface BatchVideoData {
  file: File;
  title: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipment: string[];
}

export default function VideoUploadModal({ isOpen, onClose }: VideoUploadModalProps) {
  const [formData, setFormData] = useState<VideoFormData>({
    title: "",
    primaryMuscles: [],
    secondaryMuscles: [],
    equipment: [],
    file: null,
  });
  const [batchVideos, setBatchVideos] = useState<BatchVideoData[]>([]);
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [aiMeta, setAiMeta] = useState<AiMeta>(EMPTY_AI_META);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const analyzeWithAi = async () => {
    if (!formData.title.trim()) {
      toast({ title: "Enter a title first", description: "AI uses the exercise name to infer metadata.", variant: "destructive" });
      return;
    }
    setIsAnalyzing(true);
    try {
      const res = await apiRequest("POST", "/api/videos/ai-suggest", {
        title: formData.title,
        bodyPart: formData.primaryMuscles.join(", "),
        equipment: formData.equipment.join(", "),
      });
      const m = await res.json();
      setAiMeta({
        movementPattern: m.movementPattern ?? "",
        intensity: m.intensity ?? "",
        exerciseType: m.exerciseType ?? "",
        explosive: m.explosive ?? false,
        weightRequired: m.weightRequired ?? false,
        spaceRequirement: m.spaceRequirement ?? "",
        boxingType: m.boxingType ?? "",
        confidence: m.confidence ?? null,
      });
      toast({ title: "AI analysis complete", description: "Review the suggested metadata before uploading." });
    } catch (error) {
      console.error("[v0] AI analyze failed:", error);
      toast({ title: "AI analysis failed", description: "Please try again.", variant: "destructive" });
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Fetch dynamic options for body parts and equipment
  const { data: videoOptions } = useQuery({
    queryKey: ["/api/video-options"],
    enabled: isOpen, // Only fetch when modal is open
  });

  const createVideoMutation = useMutation({
    mutationFn: async (data: any) => {
      if (!data.file) {
        throw new Error("No video file selected");
      }

      const formData = new FormData();
      formData.append('video', data.file);
      formData.append('title', data.title);
      formData.append('bodyPart', data.primaryMuscles.join(', '));
      formData.append('secondaryMuscle', data.secondaryMuscles.join(', '));
      formData.append('equipment', data.equipment.join(', '));
      // Include AI-reviewed metadata if the trainer ran analysis
      if (aiMeta.confidence != null) {
        formData.append('movementPattern', aiMeta.movementPattern);
        formData.append('intensity', aiMeta.intensity);
        formData.append('exerciseType', aiMeta.exerciseType);
        formData.append('explosive', String(aiMeta.explosive));
        formData.append('weightRequired', String(aiMeta.weightRequired));
        formData.append('spaceRequirement', aiMeta.spaceRequirement);
        formData.append('boxingType', aiMeta.boxingType);
        formData.append('aiConfidence', String(aiMeta.confidence));
      }

      const response = await fetch('/api/videos/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to upload video');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/video-options"] });
      toast({ title: "Video uploaded successfully" });
      handleClose();
    },
    onError: () => {
      toast({
        title: "Failed to upload video",
        description: "Please try again",
        variant: "destructive"
      });
    },
  });

  const batchUploadMutation = useMutation({
    mutationFn: async (videos: BatchVideoData[]) => {
      const uploadPromises = videos.map(async (videoData) => {
        const formData = new FormData();
        formData.append('video', videoData.file);
        formData.append('title', videoData.title);
        formData.append('bodyPart', videoData.primaryMuscles.join(', '));
        formData.append('secondaryMuscle', videoData.secondaryMuscles.join(', '));
        formData.append('equipment', videoData.equipment.join(', '));

        const response = await fetch('/api/videos/upload', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(`Failed to upload ${videoData.title}: ${errorData.message}`);
        }

        return response.json();
      });

      return Promise.all(uploadPromises);
    },
    onSuccess: (results) => {
      queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/video-options"] });
      toast({ 
        title: "Videos uploaded successfully",
        description: `Successfully uploaded ${results.length} videos`
      });
      handleClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to upload videos",
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const handleClose = () => {
    setFormData({
      title: "",
      primaryMuscles: [],
      secondaryMuscles: [],
      equipment: [],
      file: null,
    });
    setBatchVideos([]);
    setIsBatchMode(false);
    setIsDragOver(false);
    setAiMeta(EMPTY_AI_META);
    onClose();
  };

  const addPrimaryMuscle = (muscle: string) => {
    if (muscle && !formData.primaryMuscles.includes(muscle)) {
      setFormData(prev => ({
        ...prev,
        primaryMuscles: [...prev.primaryMuscles, muscle]
      }));
    }
  };

  const removePrimaryMuscle = (muscle: string) => {
    setFormData(prev => ({
      ...prev,
      primaryMuscles: prev.primaryMuscles.filter(bp => bp !== muscle)
    }));
  };

  const addSecondaryMuscle = (muscle: string) => {
    if (muscle && !formData.secondaryMuscles.includes(muscle)) {
      setFormData(prev => ({
        ...prev,
        secondaryMuscles: [...prev.secondaryMuscles, muscle]
      }));
    }
  };

  const removeSecondaryMuscle = (muscle: string) => {
    setFormData(prev => ({
      ...prev,
      secondaryMuscles: prev.secondaryMuscles.filter(bp => bp !== muscle)
    }));
  };

  const addEquipment = (equipment: string) => {
    if (equipment && !formData.equipment.includes(equipment)) {
      setFormData(prev => ({
        ...prev,
        equipment: [...prev.equipment, equipment]
      }));
    }
  };

  const removeEquipment = (equipment: string) => {
    setFormData(prev => ({
      ...prev,
      equipment: prev.equipment.filter(eq => eq !== equipment)
    }));
  };

  const handleFileSelect = (file: File) => {
    if (file.type.startsWith('video/')) {
      setFormData(prev => ({ ...prev, file }));
      
      // Auto-populate title from filename if empty
      if (!formData.title) {
        const fileName = file.name.replace(/\.[^/.]+$/, "");
        setFormData(prev => ({ ...prev, title: fileName }));
      }
    } else {
      toast({
        title: "Invalid file type",
        description: "Please select a video file",
        variant: "destructive"
      });
    }
  };

  const handleMultipleFiles = (files: File[]) => {
    const newBatchVideos = files.map(file => ({
      file,
      title: file.name.replace(/\.[^/.]+$/, ""),
      primaryMuscles: [],
      secondaryMuscles: [],
      equipment: []
    }));
    
    setBatchVideos(newBatchVideos);
    setIsBatchMode(true);
  };

  const updateBatchVideo = (index: number, field: keyof BatchVideoData, value: any) => {
    setBatchVideos(prev => prev.map((video, i) => 
      i === index ? { ...video, [field]: value } : video
    ));
  };

  const addPrimaryMuscleToBatch = (index: number, muscle: string) => {
    setBatchVideos(prev => prev.map((video, i) => 
      i === index && muscle && !video.primaryMuscles.includes(muscle)
        ? { ...video, primaryMuscles: [...video.primaryMuscles, muscle] }
        : video
    ));
  };

  const removePrimaryMuscleFromBatch = (index: number, muscle: string) => {
    setBatchVideos(prev => prev.map((video, i) => 
      i === index 
        ? { ...video, primaryMuscles: video.primaryMuscles.filter(bp => bp !== muscle) }
        : video
    ));
  };

  const addSecondaryMuscleToBatch = (index: number, muscle: string) => {
    setBatchVideos(prev => prev.map((video, i) => 
      i === index && muscle && !video.secondaryMuscles.includes(muscle)
        ? { ...video, secondaryMuscles: [...video.secondaryMuscles, muscle] }
        : video
    ));
  };

  const removeSecondaryMuscleFromBatch = (index: number, muscle: string) => {
    setBatchVideos(prev => prev.map((video, i) => 
      i === index 
        ? { ...video, secondaryMuscles: video.secondaryMuscles.filter(bp => bp !== muscle) }
        : video
    ));
  };

  const addEquipmentToBatch = (index: number, equipment: string) => {
    setBatchVideos(prev => prev.map((video, i) => 
      i === index && equipment && !video.equipment.includes(equipment)
        ? { ...video, equipment: [...video.equipment, equipment] }
        : video
    ));
  };

  const removeEquipmentFromBatch = (index: number, equipment: string) => {
    setBatchVideos(prev => prev.map((video, i) => 
      i === index 
        ? { ...video, equipment: video.equipment.filter(eq => eq !== equipment) }
        : video
    ));
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = Array.from(e.dataTransfer.files).filter(file => file.type.startsWith('video/'));
    
    if (files.length === 1) {
      handleFileSelect(files[0]);
    } else if (files.length > 1) {
      handleMultipleFiles(files);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleSubmit = () => {
    if (isBatchMode) {
      handleBatchSubmit();
      return;
    }

    const hasPrimaryMuscles = formData.primaryMuscles.length > 0;
    const hasEquipment = formData.equipment.length > 0;
    
    if (!formData.file || !formData.title || !hasPrimaryMuscles || !hasEquipment) {
      toast({
        title: "Missing required fields",
        description: "Please provide a title, video file, and at least one primary muscle and equipment selection",
        variant: "destructive"
      });
      return;
    }

    createVideoMutation.mutate(formData);
  };

  const handleBatchSubmit = () => {
    const incompleteVideos = batchVideos.filter(video => {
      return !video.title || video.primaryMuscles.length === 0 || video.equipment.length === 0;
    });

    if (incompleteVideos.length > 0) {
      toast({
        title: "Incomplete video data",
        description: `Please complete the required fields for all ${incompleteVideos.length} incomplete videos`,
        variant: "destructive"
      });
      return;
    }

    batchUploadMutation.mutate(batchVideos);
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upload New Video</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* File Upload Area */}
          <div className="space-y-4">
            <Label>Video File</Label>
            <Card
              className={`border-2 border-dashed transition-colors cursor-pointer ${
                isDragOver 
                  ? "border-blue-500 bg-blue-50" 
                  : formData.file 
                  ? "border-green-500 bg-green-50" 
                  : "border-gray-300"
              }`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
            >
              <CardContent className="p-8 text-center">
                {formData.file ? (
                  <div className="space-y-4">
                    <FileVideo className="h-12 w-12 mx-auto text-green-600" />
                    <div>
                      <p className="font-medium">{formData.file.name}</p>
                      <p className="text-sm text-gray-500">
                        {(formData.file.size / (1024 * 1024)).toFixed(2)} MB
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFormData(prev => ({ ...prev, file: null }));
                      }}
                    >
                      <X className="h-4 w-4 mr-2" />
                      Remove
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <Upload className="h-12 w-12 mx-auto text-gray-400" />
                    <div>
                      <p className="text-lg font-medium">Drop your video here</p>
                      <p className="text-sm text-gray-500">or click to browse</p>
                    </div>
                    <p className="text-xs text-gray-400">
                      Supports MP4, MOV, AVI and other video formats
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files || []).filter(file => file.type.startsWith('video/'));
                if (files.length === 1) {
                  handleFileSelect(files[0]);
                } else if (files.length > 1) {
                  handleMultipleFiles(files);
                }
              }}
            />
          </div>

          {/* Batch Upload Interface */}
          {isBatchMode && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-lg font-semibold">
                  Batch Upload ({batchVideos.length} videos)
                </Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setIsBatchMode(false);
                    setBatchVideos([]);
                  }}
                >
                  Switch to Single Upload
                </Button>
              </div>
              
              <div className="max-h-96 overflow-y-auto border rounded-lg">
                <div className="space-y-2 p-4">
                  {batchVideos.map((video, index) => (
                    <div key={index} className="border rounded-lg p-3 space-y-2">
                      <div className="flex items-center gap-2 text-sm">
                        <FileVideo className="h-4 w-4 text-blue-600" />
                        <span className="font-medium">{video.file.name}</span>
                        <span className="text-gray-500">({(video.file.size / (1024 * 1024)).toFixed(2)} MB)</span>
                      </div>
                      
                      <div className="grid grid-cols-1 gap-2">
                        <Input
                          value={video.title}
                          onChange={(e) => updateBatchVideo(index, 'title', e.target.value)}
                          placeholder="Video title *"
                          className="text-sm"
                        />
                        
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                          <div className="space-y-1">
                            <Input
                              placeholder="Primary muscles *"
                              className="h-8 text-sm"
                              onKeyPress={(e) => {
                                if (e.key === 'Enter') {
                                  const value = e.currentTarget.value.trim();
                                  if (value && !video.primaryMuscles.includes(value)) {
                                    addPrimaryMuscleToBatch(index, value);
                                    e.currentTarget.value = '';
                                  }
                                }
                              }}
                              list={`primary-muscle-options-${index}`}
                            />
                            <datalist id={`primary-muscle-options-${index}`}>
                              {videoOptions?.bodyParts?.map((bodyPart) => (
                                <option key={bodyPart} value={bodyPart} />
                              ))}
                            </datalist>
                            {video.primaryMuscles.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {video.primaryMuscles.map((muscle) => (
                                  <Badge key={muscle} variant="secondary" className="text-xs h-5">
                                    {muscle}
                                    <X 
                                      className="h-2 w-2 ml-1 cursor-pointer" 
                                      onClick={() => removePrimaryMuscleFromBatch(index, muscle)}
                                    />
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="space-y-1">
                            <Input
                              placeholder="Secondary muscles"
                              className="h-8 text-sm"
                              onKeyPress={(e) => {
                                if (e.key === 'Enter') {
                                  const value = e.currentTarget.value.trim();
                                  if (value && !video.secondaryMuscles.includes(value)) {
                                    addSecondaryMuscleToBatch(index, value);
                                    e.currentTarget.value = '';
                                  }
                                }
                              }}
                              list={`secondary-muscle-options-${index}`}
                            />
                            <datalist id={`secondary-muscle-options-${index}`}>
                              {videoOptions?.secondaryMuscles?.map((muscle) => (
                                <option key={muscle} value={muscle} />
                              ))}
                            </datalist>
                            {video.secondaryMuscles.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {video.secondaryMuscles.map((muscle) => (
                                  <Badge key={muscle} variant="outline" className="text-xs h-5">
                                    {muscle}
                                    <X 
                                      className="h-2 w-2 ml-1 cursor-pointer" 
                                      onClick={() => removeSecondaryMuscleFromBatch(index, muscle)}
                                    />
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
                        
                        <div className="space-y-1">
                          <Input
                            placeholder="Equipment (Enter to add) *"
                            className="h-8 text-sm"
                            onKeyPress={(e) => {
                              if (e.key === 'Enter') {
                                const value = e.currentTarget.value.trim();
                                if (value && !video.equipment.includes(value)) {
                                  addEquipmentToBatch(index, value);
                                  e.currentTarget.value = '';
                                }
                              }
                            }}
                            list={`equipment-options-${index}`}
                          />
                          <datalist id={`equipment-options-${index}`}>
                            {videoOptions?.equipment?.map((equipment) => (
                              <option key={equipment} value={equipment} />
                            ))}
                          </datalist>
                          {video.equipment.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {video.equipment.map((equipment) => (
                                <Badge key={equipment} variant="outline" className="text-xs h-5">
                                  {equipment}
                                  <X 
                                    className="h-2 w-2 ml-1 cursor-pointer" 
                                    onClick={() => removeEquipmentFromBatch(index, equipment)}
                                  />
                                </Badge>
                              ))}
                            </div>
                          )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Single Video Details Form */}
          {!isBatchMode && (
          <div className="grid grid-cols-1 gap-4">
            <div className="space-y-2">
              <Label htmlFor="title">Video Title *</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                placeholder="Enter video title"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="primaryMuscle">Primary Muscles *</Label>
                <div className="flex flex-wrap gap-2 mb-2 min-h-[40px] p-2 border rounded-lg bg-green-50 border-green-200">
                  {formData.primaryMuscles.map((muscle, index) => (
                    <Badge key={index} variant="default" className="bg-green-100 text-green-800 hover:bg-green-200">
                      {muscle}
                      <X
                        className="ml-1 h-3 w-3 cursor-pointer"
                        onClick={() => removePrimaryMuscle(muscle)}
                      />
                    </Badge>
                  ))}
                  {formData.primaryMuscles.length === 0 && (
                    <span className="text-gray-500 text-sm">Select from dropdown or type custom</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <SearchableSelect
                    options={videoOptions?.bodyParts?.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())) || []}
                    placeholder="Select primary muscle"
                    onValueChange={addPrimaryMuscle}
                    className="flex-1"
                    allowAll={false}
                  />
                  <Input
                    placeholder="or type custom..."
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        const value = e.currentTarget.value.trim();
                        if (value && !formData.primaryMuscles.includes(value)) {
                          addPrimaryMuscle(value);
                          e.currentTarget.value = '';
                        }
                      }
                    }}
                    className="flex-1"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="secondaryMuscle">Secondary Muscles</Label>
                <div className="flex flex-wrap gap-2 mb-2 min-h-[40px] p-2 border rounded-lg bg-blue-50 border-blue-200">
                  {formData.secondaryMuscles.map((muscle, index) => (
                    <Badge key={index} variant="secondary" className="bg-blue-100 text-blue-800 hover:bg-blue-200">
                      {muscle}
                      <X
                        className="ml-1 h-3 w-3 cursor-pointer"
                        onClick={() => removeSecondaryMuscle(muscle)}
                      />
                    </Badge>
                  ))}
                  {formData.secondaryMuscles.length === 0 && (
                    <span className="text-gray-500 text-sm">Select from dropdown or type custom</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <SearchableSelect
                    options={videoOptions?.secondaryMuscles?.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())) || []}
                    placeholder="Select secondary muscle"
                    onValueChange={addSecondaryMuscle}
                    className="flex-1"
                    allowAll={false}
                  />
                  <Input
                    placeholder="or type custom..."
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        const value = e.currentTarget.value.trim();
                        if (value && !formData.secondaryMuscles.includes(value)) {
                          addSecondaryMuscle(value);
                          e.currentTarget.value = '';
                        }
                      }
                    }}
                    className="flex-1"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="equipment">Equipment *</Label>
              <div className="flex flex-wrap gap-2 mb-2 min-h-[40px] p-2 border rounded-lg bg-gray-50">
                {formData.equipment.map((equipment, index) => (
                  <Badge key={index} variant="outline" className="bg-gray-100 text-gray-800 hover:bg-gray-200">
                    {equipment}
                    <X
                      className="ml-1 h-3 w-3 cursor-pointer"
                      onClick={() => removeEquipment(equipment)}
                    />
                  </Badge>
                ))}
                {formData.equipment.length === 0 && (
                  <span className="text-gray-500 text-sm">Select equipment from dropdown or type custom</span>
                )}
              </div>
              <div className="flex gap-2">
                <SearchableSelect
                  options={videoOptions?.equipment?.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())) || []}
                  placeholder="Select equipment"
                  onValueChange={addEquipment}
                  className="flex-1"
                  allowAll={false}
                />
                <Input
                  placeholder="or type custom..."
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      const value = e.currentTarget.value.trim();
                      if (value && !formData.equipment.includes(value)) {
                        addEquipment(value);
                        e.currentTarget.value = '';
                      }
                    }
                  }}
                  className="flex-1"
                />
              </div>
            </div>

            {/* AI Metadata Analysis */}
            <div className="space-y-3 rounded-lg border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-blue-600" />
                  <Label className="text-sm font-semibold">Training Metadata</Label>
                  {aiMeta.confidence != null && (
                    <Badge variant="secondary" className="text-[10px]">AI confidence {aiMeta.confidence}%</Badge>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={analyzeWithAi}
                  disabled={isAnalyzing}
                >
                  {isAnalyzing ? (
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="mr-2 h-3 w-3" />
                  )}
                  Analyze with AI
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Intensity</Label>
                  <Select
                    value={aiMeta.intensity || "unset"}
                    onValueChange={(value) => setAiMeta(prev => ({ ...prev, intensity: value === "unset" ? "" : value }))}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <span className="flex items-center gap-1.5">
                        <span className={`h-2.5 w-2.5 rounded-full ${getIntensityStyle(aiMeta.intensity).dot}`} />
                        {aiMeta.intensity || "Unset"}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Low">Low</SelectItem>
                      <SelectItem value="Medium">Medium</SelectItem>
                      <SelectItem value="High">High</SelectItem>
                      <SelectItem value="unset">Unset</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Exercise Type</Label>
                  <Select
                    value={aiMeta.exerciseType || "unset"}
                    onValueChange={(value) => setAiMeta(prev => ({ ...prev, exerciseType: value === "unset" ? "" : value }))}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Strength">Strength</SelectItem>
                      <SelectItem value="Cardio">Cardio</SelectItem>
                      <SelectItem value="Conditioning">Conditioning</SelectItem>
                      <SelectItem value="Skill">Skill</SelectItem>
                      <SelectItem value="Mobility">Mobility</SelectItem>
                      <SelectItem value="unset">Unset</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Movement Pattern</Label>
                  <Input
                    className="h-8 text-xs"
                    placeholder="e.g. Squat, Punch"
                    value={aiMeta.movementPattern}
                    onChange={(e) => setAiMeta(prev => ({ ...prev, movementPattern: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Space Requirement</Label>
                  <Select
                    value={aiMeta.spaceRequirement || "unset"}
                    onValueChange={(value) => setAiMeta(prev => ({ ...prev, spaceRequirement: value === "unset" ? "" : value }))}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Select space" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Stationary">Stationary</SelectItem>
                      <SelectItem value="Small">Small</SelectItem>
                      <SelectItem value="Large">Large</SelectItem>
                      <SelectItem value="unset">Unset</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center gap-6 pt-1">
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={aiMeta.explosive}
                    onChange={(e) => setAiMeta(prev => ({ ...prev, explosive: e.target.checked }))}
                    className="h-4 w-4"
                  />
                  Explosive / Plyometric
                </label>
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={aiMeta.weightRequired}
                    onChange={(e) => setAiMeta(prev => ({ ...prev, weightRequired: e.target.checked }))}
                    className="h-4 w-4"
                  />
                  Weight Required
                </label>
              </div>
            </div>
          </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end space-x-4">
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button 
              onClick={handleSubmit}
              disabled={createVideoMutation.isPending || batchUploadMutation.isPending}
              className="bg-[hsl(207,90%,54%)] hover:bg-blue-700"
            >
              {createVideoMutation.isPending || batchUploadMutation.isPending 
                ? "Uploading..." 
                : isBatchMode 
                ? `Upload ${batchVideos.length} Videos`
                : "Upload Video"
              }
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
