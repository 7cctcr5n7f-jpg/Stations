"use client"

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Upload, CheckCircle } from "lucide-react";

interface BulkUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BulkUploadModal({ isOpen, onClose }: BulkUploadModalProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [uploadResults, setUploadResults] = useState({ success: 0, failed: 0 });
  const [currentUploadIndex, setCurrentUploadIndex] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const resetModal = () => {
    setFiles([]);
    setUploadComplete(false);
    setIsUploading(false);
    setUploadResults({ success: 0, failed: 0 });
    setCurrentUploadIndex(0);
    setUploadProgress(0);
  };

  const handleClose = () => {
    if (!isUploading) {
      resetModal();
      onClose();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

  const uploadFiles = async () => {
    setIsUploading(true);
    setCurrentUploadIndex(0);
    setUploadProgress(0);
    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setCurrentUploadIndex(i + 1);
      setUploadProgress(((i) / files.length) * 100);

      try {
        const formData = new FormData();
        formData.append('video', file);
        formData.append('title', file.name.replace(/\.[^/.]+$/, ''));
        formData.append('bodyPart', 'General');
        formData.append('secondaryMuscle', '');
        formData.append('equipment', 'To be assigned');

        console.log(`Uploading ${i + 1}/${files.length}: ${file.name}`);
        const response = await fetch('/api/videos/upload', {
          method: 'POST',
          body: formData,
        });

        if (response.ok) {
          successCount++;
          console.log(`Successfully uploaded: ${file.name}`);
        } else {
          failedCount++;
          console.error(`Failed to upload: ${file.name} - Status: ${response.status}`);
        }
      } catch (error) {
        failedCount++;
        console.error(`Error uploading ${file.name}:`, error);
      }
    }

    setUploadProgress(100);
    console.log(`Upload complete: ${successCount} success, ${failedCount} failed`);
    
    const finalResults = { success: successCount, failed: failedCount };
    console.log('Setting upload results:', finalResults);
    setUploadResults(finalResults);
    console.log('Setting isUploading to false');
    setIsUploading(false);
    console.log('Setting uploadComplete to true');
    setUploadComplete(true);
    
    // Force re-render after state updates
    setTimeout(() => {
      console.log('Final state check - uploadComplete should be true, results:', finalResults);
      console.log('Current state after timeout:', { uploadComplete: true, uploadResults: finalResults });
    }, 100);
    
    queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
    queryClient.invalidateQueries({ queryKey: ["/api/video-options"] });

    toast({
      title: "Upload Complete!",
      description: `Successfully uploaded ${successCount} videos${failedCount > 0 ? `. ${failedCount} failed` : ''}`,
    });
  };

  console.log('Render state:', { uploadComplete, isUploading, uploadResults, files: files.length });

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!open && !isUploading) {
        handleClose();
      }
    }}>
      <DialogContent className="max-w-2xl" onInteractOutside={(e) => {
        if (isUploading) {
          e.preventDefault();
        }
      }}>
        <DialogHeader>
          <DialogTitle>
            {uploadComplete ? "Upload Complete!" : "Bulk Video Upload"}
          </DialogTitle>
        </DialogHeader>

        {uploadComplete ? (
          <div className="flex flex-col items-center justify-center space-y-6 py-8">
            <div className="flex items-center justify-center w-24 h-24 bg-green-100 rounded-full">
              <CheckCircle className="h-12 w-12 text-green-600" />
            </div>
            
            <div className="text-center space-y-2">
              <h3 className="text-2xl font-semibold text-green-800">
                Videos Uploaded Successfully!
              </h3>
              <p className="text-gray-600">
                {uploadResults.success} video{uploadResults.success !== 1 ? 's' : ''} uploaded successfully
                {uploadResults.failed > 0 && (
                  <span className="text-red-600">, {uploadResults.failed} failed</span>
                )}
              </p>
            </div>

            <div className="flex gap-3">
              <Button onClick={() => {
                setUploadComplete(false);
                setFiles([]);
                setUploadResults({ success: 0, failed: 0 });
                setCurrentUploadIndex(0);
                setUploadProgress(0);
              }} variant="outline">
                Upload More Videos
              </Button>
              <Button onClick={handleClose}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="border-2 border-dashed rounded-lg p-8 text-center">
              <Upload className="mx-auto h-12 w-12 text-gray-400 mb-4" />
              <div className="space-y-2">
                <p className="text-lg font-medium">
                  Select .MOV files to upload
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

            {files.length > 0 && (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="font-medium">Files to Upload ({files.length})</h3>
                  {isUploading && (
                    <div className="text-sm text-gray-600">
                      Uploading {currentUploadIndex} of {files.length}
                    </div>
                  )}
                </div>

                {isUploading && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Upload Progress</span>
                      <span>{Math.round(uploadProgress)}%</span>
                    </div>
                    <Progress value={uploadProgress} className="h-2" />
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>Pending: {files.length - currentUploadIndex}</span>
                      <span>Completed: {currentUploadIndex}</span>
                    </div>
                  </div>
                )}

                <div className="max-h-32 overflow-y-auto space-y-1 text-sm">
                  {files.map((file, index) => (
                    <div key={index} className="p-2 bg-gray-50 rounded">
                      {file.name} ({(file.size / (1024 * 1024)).toFixed(1)} MB)
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-between items-center pt-4 border-t">
              <div></div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleClose} disabled={isUploading}>
                  Close
                </Button>
                {files.length > 0 && (
                  <Button onClick={uploadFiles} disabled={isUploading}>
                    {isUploading ? 'Uploading...' : `Upload ${files.length} Files`}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}