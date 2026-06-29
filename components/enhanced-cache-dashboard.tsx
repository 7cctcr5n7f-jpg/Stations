"use client"

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
// Progress component not available, use custom progress bar
import { 
  Download, 
  CheckCircle, 
  AlertTriangle, 
  Wifi, 
  WifiOff, 
  RefreshCw,
  HardDrive,
  Clock
} from "lucide-react";
import { useVideoCaching } from "./enhanced-video-cache";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function EnhancedCacheDashboard() {
  const { toast } = useToast();
  const { 
    cacheStatus, 
    isInitialized, 
    refreshCacheStatus, 
    cacheAllScheduledVideos,
    clearCache
  } = useVideoCaching();
  
  const [isAutoCache, setIsAutoCache] = useState(true);

  // Get today's schedules and videos for caching
  const { data: schedules = [] } = useQuery({
    queryKey: ["/api/schedules"],
  });

  const { data: videos = [] } = useQuery({
    queryKey: ["/api/videos"],
  });

  useEffect(() => {
    if (isInitialized) {
      refreshCacheStatus();
    }
  }, [isInitialized, refreshCacheStatus]);

  const totalCachedSize = cacheStatus.reduce((sum, entry) => sum + entry.size, 0);
  const totalVideos = videos.length;
  const cachedVideos = cacheStatus.filter(entry => entry.status === 'cached').length;
  const errorVideos = cacheStatus.filter(entry => entry.status === 'error').length;
  const cachingVideos = cacheStatus.filter(entry => entry.status === 'caching').length;

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'cached':
        return <Badge className="bg-green-100 text-green-800"><CheckCircle className="h-3 w-3 mr-1" />Cached</Badge>;
      case 'caching':
        return <Badge className="bg-blue-100 text-blue-800"><Download className="h-3 w-3 mr-1" />Caching</Badge>;
      case 'error':
        return <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />Error</Badge>;
      default:
        return <Badge variant="secondary">Unknown</Badge>;
    }
  };

  const cachePercentage = totalVideos > 0 ? Math.round((cachedVideos / totalVideos) * 100) : 0;

  const handleCacheAll = async () => {
    try {
      await cacheAllScheduledVideos();
      await refreshCacheStatus();
      toast({
        title: "Caching Complete",
        description: "All scheduled videos have been cached for offline use",
      });
    } catch (error) {
      toast({
        title: "Caching Failed",
        description: "Some videos could not be cached",
        variant: "destructive",
      });
    }
  };

  const handleClearAll = async () => {
    if (confirm("Are you sure you want to clear all cached videos? This will require re-downloading videos for offline use.")) {
      try {
        await clearCache();
        await refreshCacheStatus();
        toast({
          title: "Cache Cleared",
          description: "All cached videos have been removed",
        });
      } catch (error) {
        toast({
          title: "Clear Failed",
          description: "Could not clear video cache",
          variant: "destructive",
        });
      }
    }
  };

  if (!isInitialized) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <HardDrive className="h-5 w-5" />
            <span>Enhanced Video Cache</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-6 w-6 animate-spin mr-2" />
            <span>Initializing cache system...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <HardDrive className="h-5 w-5" />
              <span>Enhanced Video Cache System</span>
            </div>
            <div className="flex space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={refreshCacheStatus}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
              <Button
                size="sm"
                onClick={handleCacheAll}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Download className="h-4 w-4 mr-2" />
                Cache All Scheduled
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleClearAll}
              >
                Clear All Cache
              </Button>
            </div>
          </CardTitle>
          <CardDescription>
            Intelligent offline caching for uninterrupted video playback during internet outages
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {/* Cache Overview */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-4 bg-blue-50 rounded-lg">
                <div className="text-2xl font-bold text-blue-600">{cachedVideos}</div>
                <div className="text-sm text-gray-600">Cached Videos</div>
              </div>
              <div className="text-center p-4 bg-green-50 rounded-lg">
                <div className="text-2xl font-bold text-green-600">{formatFileSize(totalCachedSize)}</div>
                <div className="text-sm text-gray-600">Total Cache Size</div>
              </div>
              <div className="text-center p-4 bg-yellow-50 rounded-lg">
                <div className="text-2xl font-bold text-yellow-600">{cachingVideos}</div>
                <div className="text-sm text-gray-600">Currently Caching</div>
              </div>
              <div className="text-center p-4 bg-red-50 rounded-lg">
                <div className="text-2xl font-bold text-red-600">{errorVideos}</div>
                <div className="text-sm text-gray-600">Cache Errors</div>
              </div>
            </div>

            {/* Cache Progress */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Cache Coverage</span>
                <span className="text-sm text-gray-600">{cachePercentage}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="h-2 rounded-full bg-blue-500"
                  style={{ width: `${cachePercentage}%` }}
                ></div>
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {cachedVideos} of {totalVideos} videos cached
              </div>
            </div>

            {/* Cache Status List */}
            {cacheStatus.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-medium">Cache Status Details</h4>
                <div className="max-h-60 overflow-y-auto space-y-2">
                  {cacheStatus.map((entry) => (
                    <div key={entry.videoId} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center space-x-3">
                        <div>
                          <div className="font-medium text-sm">{entry.title}</div>
                          <div className="text-xs text-gray-500 flex items-center space-x-2">
                            <Clock className="h-3 w-3" />
                            <span>Cached {new Date(entry.cachedAt).toLocaleString()}</span>
                            {entry.size > 0 && (
                              <>
                                <span>•</span>
                                <span>{formatFileSize(entry.size)}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      {getStatusBadge(entry.status)}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Offline Mode Notice */}
            <Alert>
              <WifiOff className="h-4 w-4" />
              <AlertDescription>
                Cached videos will automatically play during internet outages. Green "Cached" indicators show offline-ready content.
              </AlertDescription>
            </Alert>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}