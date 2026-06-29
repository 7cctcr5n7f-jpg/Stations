import { useState } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Upload, FileVideo, CheckCircle, AlertCircle, X } from "lucide-react";

interface BulkUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface UploadFile {
  file: File;
  status: 'pending' | 'uploading' | 'success' | 'error';
  progress: number;
  error?: string;
  videoId?: number;
  title: string;
  bodyPart: string;
  secondaryMuscle: string;
  equipment: string;
  matchType: 'found' | 'default';
  matchedTitle?: string;
}

export function BulkUploadModal({ isOpen, onClose }: BulkUploadModalProps) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadComplete, setUploadComplete] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const resetModal = () => {
    setFiles([]);
    setUploadComplete(false);
    setIsUploading(false);
    setIsDragging(false);
  };

  const handleClose = () => {
    resetModal();
    onClose();
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
    
    const droppedFiles = Array.from(e.dataTransfer.files);
    const videoFiles = droppedFiles.filter(file => 
      file.type.startsWith('video/') || file.name.toLowerCase().endsWith('.mov')
    );
    
    addFiles(videoFiles);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files);
      addFiles(selectedFiles);
    }
  };

  const addFiles = async (newFiles: File[]) => {
    const uploadFiles: UploadFile[] = newFiles.map(file => ({
      file,
      status: 'pending',
      progress: 0,
      title: file.name.replace(/\.[^/.]+$/, ''), // Remove extension
      bodyPart: 'General',
      secondaryMuscle: '',
      equipment: 'To be assigned',
      matchType: 'default'
    }));
    
    setFiles(prev => [...prev, ...uploadFiles]);

    // Get metadata suggestions for the new files
    try {
      const titles = uploadFiles.map(f => f.title);
      const response = await apiRequest('POST', '/api/videos/suggest-metadata', { titles });
      
      // Update files with suggested metadata
      setFiles(prev => prev.map(file => {
        const suggestion = (response as any)[file.title];
        if (suggestion) {
          return {
            ...file,
            bodyPart: suggestion.bodyPart,
            secondaryMuscle: suggestion.secondaryMuscle,
            equipment: suggestion.equipment,
            matchType: suggestion.matchType,
            matchedTitle: suggestion.matchedTitle
          };
        }
        return file;
      }));
    } catch (error) {
      console.error('Failed to get metadata suggestions:', error);
      // Files will keep default metadata
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

  const uploadAllFiles = async () => {
    setIsUploading(true);
    
    for (let i = 0; i < files.length; i++) {
      const fileData = files[i];
      
      if (fileData.status !== 'pending') continue;
      
      // Update status to uploading
      setFiles(prev => prev.map((f, idx) => 
        idx === i ? { ...f, status: 'uploading', progress: 0 } : f
      ));

      try {
        const formData = new FormData();
        formData.append('video', fileData.file);
        formData.append('title', fileData.title);
        formData.append('bodyPart', fileData.bodyPart);
        formData.append('secondaryMuscle', fileData.secondaryMuscle);
        formData.append('equipment', fileData.equipment);

        const response = await fetch('/api/videos/upload', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          throw new Error(`Upload failed: ${response.statusText}`);
        }

        const result = await response.json();
        
        // Update status to success
        setFiles(prev => prev.map((f, idx) => 
          idx === i ? { ...f, status: 'success', progress: 100, videoId: result.id } : f
        ));

      } catch (error) {
        console.error('Upload error:', error);
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
    setUploadComplete(true);
    queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
    queryClient.invalidateQueries({ queryKey: ["/api/video-options"] });
    
    const successCount = files.filter(f => f.status === 'success').length;
    const errorCount = files.filter(f => f.status === 'error').length;
    
    toast({
      title: "Upload Complete!",
      description: `Successfully uploaded ${successCount} videos${errorCount > 0 ? `. ${errorCount} failed` : ''}`,
    });
  };

  const getStatusIcon = (status: UploadFile['status']) => {
    switch (status) {
      case 'pending':
        return <FileVideo className="h-4 w-4 text-gray-400" />;
      case 'uploading':
        return <Upload className="h-4 w-4 text-blue-500 animate-pulse" />;
      case 'success':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
    }
  };

  const pendingCount = files.filter(f => f.status === 'pending').length;
  const successCount = files.filter(f => f.status === 'success').length;
  const errorCount = files.filter(f => f.status === 'error').length;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {uploadComplete ? "Upload Complete!" : "Bulk Video Upload"}
          </DialogTitle>
        </DialogHeader>

        {uploadComplete ? (
          // Success State
          <div className="flex-1 flex flex-col items-center justify-center space-y-6 py-8">
            <div className="flex items-center justify-center w-24 h-24 bg-green-100 rounded-full">
              <CheckCircle className="h-12 w-12 text-green-600" />
            </div>
            
            <div className="text-center space-y-2">
              <h3 className="text-2xl font-semibold text-green-800">
                Videos Uploaded Successfully!
              </h3>
              <p className="text-gray-600">
                {successCount} video{successCount !== 1 ? 's' : ''} uploaded successfully
                {errorCount > 0 && (
                  <span className="text-red-600">, {errorCount} failed</span>
                )}
              </p>
            </div>

            <div className="flex gap-3">
              <Button onClick={() => setUploadComplete(false)} variant="outline">
                Upload More Videos
              </Button>
              <Button onClick={handleClose}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          // Upload Interface
          <div className="flex-1 overflow-y-auto space-y-4">
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
              <p className="text-lg font-medium">
                Drop .MOV files here or click to browse
              </p>
              <p className="text-sm text-gray-500">
                Files will be automatically converted to .MP4 format
              </p>
              <Input
                type="file"
                multiple
                accept="video/*,.mov"
                onChange={handleFileSelect}
                className="max-w-xs mx-auto"
              />
            </div>
          </div>

          {/* File List */}
          {files.length > 0 && (
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <h3 className="font-medium">
                  Files to Upload ({files.length})
                </h3>
                <div className="text-sm text-gray-500">
                  Pending: {pendingCount} | Success: {successCount} | Errors: {errorCount}
                </div>
              </div>
              
              <div className="max-h-96 overflow-y-auto space-y-2 border rounded-lg p-2">
                {files.map((fileData, index) => (
                  <div key={index} className="flex items-start gap-3 p-3 bg-gray-50 rounded border">
                    <div className="flex flex-col items-center pt-1">
                      {getStatusIcon(fileData.status)}
                    </div>
                    
                    <div className="flex-1 min-w-0 space-y-2">
                      <Input
                        value={fileData.title}
                        onChange={(e) => updateFileTitle(index, e.target.value)}
                        placeholder="Video title"
                        className="text-sm h-8 font-medium"
                        disabled={fileData.status === 'uploading' || fileData.status === 'success'}
                      />
                      
                      {/* Metadata Preview */}
                      <div className="flex flex-wrap gap-2 text-xs">
                        <div className={`px-2 py-1 rounded-full font-medium ${
                          fileData.matchType === 'found' 
                            ? 'bg-green-100 text-green-800 border border-green-200' 
                            : 'bg-gray-100 text-gray-700 border border-gray-200'
                        }`}>
                          <span className="font-bold">{fileData.bodyPart}</span>
                        </div>
                        <div className={`px-2 py-1 rounded-full font-medium ${
                          fileData.matchType === 'found' 
                            ? 'bg-blue-100 text-blue-800 border border-blue-200' 
                            : 'bg-gray-100 text-gray-700 border border-gray-200'
                        }`}>
                          <span className="font-bold">{fileData.equipment}</span>
                        </div>
                        {fileData.matchType === 'found' && fileData.matchedTitle && (
                          <div className="px-2 py-1 rounded-full bg-green-50 text-green-700 border border-green-200 text-xs">
                            ✓ Matched: "{fileData.matchedTitle}"
                          </div>
                        )}
                      </div>
                      
                      {fileData.status === 'uploading' && (
                        <Progress value={fileData.progress} className="h-1" />
                      )}
                      {fileData.error && (
                        <p className="text-xs text-red-500">{fileData.error}</p>
                      )}
                    </div>
                    
                    <div className="text-xs text-gray-500 text-right pt-1">
                      <div>{(fileData.file.size / (1024 * 1024)).toFixed(1)} MB</div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeFile(index)}
                        disabled={fileData.status === 'uploading'}
                        className="h-6 w-6 p-0 mt-1"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Actions - only show when not in upload complete state */}
        {!uploadComplete && (
          <div className="flex justify-between items-center pt-4 border-t">
            <div className="text-sm text-gray-500">
              {files.length > 0 && (
                <>
                  {files.filter(f => f.matchType === 'found').length > 0 && (
                    <span className="text-green-600 font-medium">
                      {files.filter(f => f.matchType === 'found').length} videos matched with existing metadata
                    </span>
                  )}
                  {files.filter(f => f.matchType === 'found').length > 0 && files.filter(f => f.matchType === 'default').length > 0 && (
                    <span className="mx-2">•</span>
                  )}
                  {files.filter(f => f.matchType === 'default').length > 0 && (
                    <span>
                      {files.filter(f => f.matchType === 'default').length} videos using default metadata
                    </span>
                  )}
                </>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleClose} disabled={isUploading}>
                {isUploading ? 'Uploading...' : 'Close'}
              </Button>
              {files.length > 0 && pendingCount > 0 && (
                <Button onClick={uploadAllFiles} disabled={isUploading}>
                  Upload {pendingCount} Files
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}