"use client"

import { useState, useRef } from "react";
import { generateVideoThumbnail } from "@/lib/generate-thumbnail";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EditableSelect } from "@/components/editable-select";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileVideo, CheckCircle, AlertCircle, X } from "lucide-react";

interface SimpleBulkUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface UploadFile {
  file: File;
  status: 'pending' | 'uploading' | 'success' | 'error' | 'skipped';
  progress: number;
  error?: string;
  title: string;
  bodyPart: string;
  secondaryMuscle: string;
  equipment: string;
  isDuplicate?: boolean;
  duplicateReason?: string;
}

export function SimpleBulkUploadModal({ isOpen, onClose }: SimpleBulkUploadModalProps) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [showSuccessScreen, setShowSuccessScreen] = useState(false);
  const [uploadStats, setUploadStats] = useState({ success: 0, failed: 0 });
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch available options
  const { data: options = { bodyParts: [], secondaryMuscles: [], equipment: [] } } = useQuery<{bodyParts: string[], secondaryMuscles: string[], equipment: string[]}>({
    queryKey: ["/api/video-options"],
    enabled: isOpen
  });

  const handleClose = () => {
    if (!isUploading) {
      setFiles([]);
      setShowSuccessScreen(false);
      setUploadStats({ success: 0, failed: 0 });
      onClose();
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const droppedFiles = Array.from(e.dataTransfer.files).filter(file =>
      file.type.startsWith('video/')
    );
    
    if (droppedFiles.length > 0) {
      addFiles(droppedFiles);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length > 0) {
      addFiles(selectedFiles);
    }
  };

  const addFiles = async (newFiles: File[]) => {
    // First, add files with pending status
    const uploadFiles: UploadFile[] = newFiles.map(file => ({
      file,
      status: 'pending',
      progress: 0,
      title: file.name.replace(/\.[^/.]+$/, ''), // Remove extension
      bodyPart: "",
      secondaryMuscle: "",
      equipment: "",
      isDuplicate: false,
      duplicateReason: ""
    }));
    
    setFiles(prev => [...prev, ...uploadFiles]);

    // Check for duplicates
    if (newFiles.length > 0) {
      await checkForDuplicates(newFiles.map(f => f.name));
    }
  };

  const checkForDuplicates = async (filenames: string[]) => {
    try {
      console.log('🔍 Checking for duplicate videos...');
      
      const response = await fetch('/api/videos/check-duplicates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ filenames }),
      });

      if (!response.ok) {
        throw new Error('Failed to check duplicates');
      }

      const result = await response.json();
      console.log(`✅ Duplicate check complete: ${result.summary.duplicates} duplicates found`);

      // Update files with duplicate information
      setFiles(prev => prev.map(file => {
        const duplicateInfo = result.results.find((r: any) => r.filename === file.file.name);
        if (duplicateInfo) {
          return {
            ...file,
            isDuplicate: duplicateInfo.isDuplicate,
            duplicateReason: duplicateInfo.reason || ""
          };
        }
        return file;
      }));

      // Show summary to user and automatically skip duplicates
      if (result.summary.duplicates > 0) {
        console.log(`📋 Found ${result.summary.duplicates} duplicate videos and ${result.summary.new} new videos`);
        // Automatically skip duplicates to prevent accidental uploads
        setFiles(prev => prev.map(file => 
          file.isDuplicate ? { ...file, status: 'skipped' as const } : file
        ));
      }

    } catch (error) {
      console.error('❌ Error checking duplicates:', error);
      // Don't fail the whole process, just proceed without duplicate detection
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const updateFileTitle = (index: number, title: string) => {
    setFiles(prev => prev.map((file, i) => 
      i === index ? { ...file, title } : file
    ));
  };

  const updateFileMetadata = (index: number, field: 'bodyPart' | 'secondaryMuscle' | 'equipment', value: string) => {
    setFiles(prev => prev.map((file, i) => 
      i === index ? { ...file, [field]: value } : file
    ));
  };

  const removeDuplicates = () => {
    setFiles(prev => prev.filter(file => !file.isDuplicate));
  };

  const skipDuplicates = () => {
    setFiles(prev => prev.map(file => 
      file.isDuplicate ? { ...file, status: 'skipped' as const } : file
    ));
  };

  const keepDuplicates = () => {
    setFiles(prev => prev.map(file => 
      file.isDuplicate ? { ...file, isDuplicate: false, duplicateReason: "" } : file
    ));
  };

  const startUpload = async () => {
    setIsUploading(true);

    for (let i = 0; i < files.length; i++) {
      const fileData = files[i];
      
      if (fileData.status === 'success' || fileData.status === 'skipped') continue;

      setFiles(prev => prev.map((f, idx) => 
        idx === i ? { ...f, status: 'uploading', progress: 0 } : f
      ));

      try {
        const formData = new FormData();
        formData.append('video', fileData.file);
        formData.append('title', fileData.title);
        formData.append('bodyPart', fileData.bodyPart || 'General');
        formData.append('secondaryMuscle', fileData.secondaryMuscle === 'none' ? '' : fileData.secondaryMuscle);
        formData.append('equipment', fileData.equipment || 'To be assigned');

        console.log(`Starting upload ${i + 1}/${files.length}: ${fileData.title}`);

        const response = await fetch('/api/videos/upload', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Upload failed (${response.status}): ${errorText || response.statusText}`);
        }

        const result = await response.json();
        console.log(`✅ Successfully uploaded ${i + 1}/${files.length}: ${fileData.title}`);

        // Auto-generate thumbnail from the local File still in memory.
        try {
          const localUrl = URL.createObjectURL(fileData.file);
          const thumbBlob = await generateVideoThumbnail(localUrl, 1);
          URL.revokeObjectURL(localUrl);
          await fetch(`/api/videos/${result.id}/thumbnail`, {
            method: "POST",
            headers: { "content-type": "image/jpeg" },
            body: thumbBlob,
          });
        } catch (thumbErr) {
          console.warn("[simple-bulk] thumbnail generation failed:", thumbErr);
        }
        
        setFiles(prev => prev.map((f, idx) => 
          idx === i ? { ...f, status: 'success', progress: 100 } : f
        ));

        // Add delay between uploads to prevent server overload and file conflicts
        if (i < files.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay
        }

      } catch (error) {
        console.error(`❌ Upload error for ${fileData.title}:`, error);
        setFiles(prev => prev.map((f, idx) => 
          idx === i ? { 
            ...f, 
            status: 'error', 
            progress: 0, 
            error: error instanceof Error ? error.message : 'Upload failed'
          } : f
        ));
      }
    }

    setIsUploading(false);
    
    // Refresh the video list
    queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
    queryClient.invalidateQueries({ queryKey: ["/api/video-options"] });
    
    // Use a small delay to ensure all state updates are complete
    setTimeout(() => {
      setFiles(currentFiles => {
        const successCount = currentFiles.filter(f => f.status === 'success').length;
        const errorCount = currentFiles.filter(f => f.status === 'error').length;
        
        console.log(`Upload complete: ${successCount} successful, ${errorCount} failed`);
        console.log('Final file statuses:', currentFiles.map(f => ({ title: f.title, status: f.status })));
        
        setUploadStats({ success: successCount, failed: errorCount });
        setShowSuccessScreen(true);
        
        return currentFiles; // Return unchanged files
      });
    }, 100);
  };

  const getStatusIcon = (status: UploadFile['status'], isDuplicate?: boolean) => {
    if (isDuplicate && status === 'pending') {
      return <AlertCircle className="h-4 w-4 text-yellow-600" />;
    }
    
    switch (status) {
      case 'pending':
        return <FileVideo className="h-4 w-4 text-gray-400" />;
      case 'uploading':
        return <Upload className="h-4 w-4 text-blue-500 animate-pulse" />;
      case 'success':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      case 'skipped':
        return <X className="h-4 w-4 text-gray-500" />;
    }
  };

  const pendingCount = files.filter(f => f.status === 'pending').length;
  const successCount = files.filter(f => f.status === 'success').length;
  const errorCount = files.filter(f => f.status === 'error').length;
  const skippedCount = files.filter(f => f.status === 'skipped').length;
  const duplicateCount = files.filter(f => f.isDuplicate && f.status === 'pending').length;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {showSuccessScreen ? "Upload Complete!" : "Individual Video Upload"}
          </DialogTitle>
        </DialogHeader>

        {showSuccessScreen ? (
          <div className="flex flex-col items-center justify-center space-y-6 py-8">
            <div className="flex items-center justify-center w-24 h-24 bg-green-100 rounded-full">
              <CheckCircle className="h-12 w-12 text-green-600" />
            </div>
            
            <div className="text-center space-y-2">
              <h3 className="text-2xl font-semibold text-green-800">
                Videos Uploaded Successfully!
              </h3>
              <p className="text-gray-600">
                {uploadStats.success} video{uploadStats.success !== 1 ? 's' : ''} uploaded successfully
                {uploadStats.failed > 0 && (
                  <span className="text-red-600">, {uploadStats.failed} failed</span>
                )}
              </p>
            </div>

            <div className="flex gap-3">
              <Button onClick={() => {
                setShowSuccessScreen(false);
                setFiles([]);
                setUploadStats({ success: 0, failed: 0 });
              }} variant="outline">
                Upload More Videos
              </Button>
              <Button onClick={handleClose}>
                Done
              </Button>
            </div>
          </div>
        ) : (

        <div className="flex-1 overflow-y-auto space-y-4">
          {/* Upload Instructions */}
          <div className="p-4 bg-blue-50 rounded-lg border">
            <p className="text-sm text-blue-800">
              <strong>Individual Video Setup:</strong> Each video can have its own Primary Muscle, Secondary Muscle, and Equipment. 
              Set these fields for each video below, or leave blank to set later using inline editing in the video library.
            </p>
          </div>

          {/* Drop Zone */}
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              isDragging 
                ? 'border-blue-400 bg-blue-50' 
                : 'border-gray-300 hover:border-gray-400'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <Upload className="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <div className="space-y-2">
              <p className="text-lg font-medium">Drop video files here</p>
              <p className="text-sm text-gray-500">
                or{" "}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-blue-500 hover:text-blue-600 underline"
                >
                  browse files
                </button>
              </p>
              <p className="text-xs text-gray-400">
                Supports .mov, .mp4, .avi and other video formats
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="video/*"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          {/* Files List */}
          {files.length > 0 && (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <h3 className="font-medium">Videos to Upload ({files.length})</h3>
                <div className="text-sm text-gray-500">
                  {pendingCount > 0 && <span>{pendingCount} pending</span>}
                  {duplicateCount > 0 && <span className="text-yellow-600 ml-2">{duplicateCount} duplicates</span>}
                  {successCount > 0 && <span className="text-green-600 ml-2">{successCount} successful</span>}
                  {skippedCount > 0 && <span className="text-gray-600 ml-2">{skippedCount} skipped</span>}
                  {errorCount > 0 && <span className="text-red-600 ml-2">{errorCount} failed</span>}
                </div>
              </div>

              {/* Duplicate handling controls */}
              {duplicateCount > 0 && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle className="w-4 h-4 text-green-600" />
                    <span className="text-sm font-medium text-green-800">
                      Auto-skipped {duplicateCount} duplicate videos
                    </span>
                  </div>
                  <p className="text-xs text-green-700 mb-3">
                    Duplicates have been automatically skipped to prevent re-uploading existing videos. You can change this:
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={removeDuplicates}
                      className="text-xs"
                    >
                      Remove Duplicates
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={keepDuplicates}
                      className="text-xs bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
                    >
                      Upload Anyway (Not Recommended)
                    </Button>
                  </div>
                </div>
              )}

              {files.map((file, index) => (
                <div key={index} className={`p-4 rounded-lg border ${file.isDuplicate && file.status === 'pending' ? 'bg-yellow-50 border-yellow-200' : 'bg-gray-50'}`}>
                  {/* Duplicate Warning */}
                  {file.isDuplicate && file.status === 'pending' && (
                    <div className="mb-2 p-2 bg-yellow-100 border border-yellow-300 rounded text-xs text-yellow-800">
                      ⚠️ {file.duplicateReason}
                    </div>
                  )}
                  
                  {/* Video Title Row */}
                  <div className="flex items-center gap-3 mb-3">
                    {getStatusIcon(file.status, file.isDuplicate)}
                    
                    <div className="flex-1 min-w-0">
                      <Input
                        value={file.title}
                        onChange={(e) => updateFileTitle(index, e.target.value)}
                        placeholder="Video title"
                        className="text-sm font-medium"
                        disabled={isUploading}
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      {file.status === 'pending' && !isUploading && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeFile(index)}
                          className="h-6 w-6 p-0 text-gray-400 hover:text-red-600"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                      
                      {file.status === 'uploading' && (
                        <div className="flex items-center gap-2">
                          <Progress value={file.progress} className="w-16 h-2" />
                          <span className="text-xs text-gray-500">{file.progress}%</span>
                        </div>
                      )}
                      
                      {file.status === 'error' && file.error && (
                        <div className="flex items-center gap-2">
                          <AlertCircle className="h-4 w-4 text-red-600" />
                          <span className="text-xs text-red-600 max-w-xs truncate" title={file.error}>
                            {file.error}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Individual Metadata Row */}
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Primary Muscle</label>
                      <EditableSelect
                        value={file.bodyPart}
                        options={options.bodyParts}
                        placeholder="Select muscle"
                        onValueChange={(value) => updateFileMetadata(index, 'bodyPart', value)}
                        className="h-8 text-xs"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Secondary Muscle</label>
                      <EditableSelect
                        value={file.secondaryMuscle || ''}
                        options={options.secondaryMuscles}
                        placeholder="Select secondary"
                        allowNone={true}
                        onValueChange={(value) => updateFileMetadata(index, 'secondaryMuscle', value)}
                        className="h-8 text-xs"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Equipment</label>
                      <EditableSelect
                        value={file.equipment}
                        options={options.equipment}
                        placeholder="Select equipment"
                        onValueChange={(value) => updateFileMetadata(index, 'equipment', value)}
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        )}

        {/* Actions - only show when not on success screen */}
        {!showSuccessScreen && (
          <div className="flex justify-between items-center pt-4 border-t">
            <div className="text-sm text-gray-500">
              {files.length > 0 && (
                <>Each video has its own metadata settings. Empty fields will be set as defaults and can be edited later in the video library.</>
              )}
            </div>
            
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleClose} disabled={isUploading}>
                Cancel
              </Button>
              <Button 
                onClick={startUpload} 
                disabled={files.length === 0 || isUploading}
              >
                {isUploading ? 'Uploading...' : `Upload ${files.length} Videos`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
