import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HardDrive, RefreshCw, Trash2, Download } from "lucide-react";
import { videoCacheManager } from "@/lib/video-cache";

export default function CacheManager() {
  const [cacheStats, setCacheStats] = useState({ count: 0, totalSize: 0 });
  const [isLoading, setIsLoading] = useState(false);

  const loadCacheStats = async () => {
    try {
      const stats = await videoCacheManager.getCacheStats();
      setCacheStats(stats);
    } catch (error) {
      console.error('Failed to load cache stats:', error);
    }
  };

  useEffect(() => {
    loadCacheStats();
  }, []);

  const handleClearCache = async () => {
    if (!confirm('Are you sure you want to clear all cached videos? This will require re-downloading videos for offline playback.')) {
      return;
    }

    setIsLoading(true);
    try {
      await videoCacheManager.clearAllCache();
      await loadCacheStats();
    } catch (error) {
      console.error('Failed to clear cache:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearOldCache = async () => {
    setIsLoading(true);
    try {
      await videoCacheManager.clearOldCache(7); // Clear cache older than 7 days
      await loadCacheStats();
    } catch (error) {
      console.error('Failed to clear old cache:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <HardDrive className="h-5 w-5" />
          <span>Video Cache Management</span>
        </CardTitle>
        <CardDescription>
          Manage local video storage for offline playback and bandwidth reduction
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Cache Statistics */}
        <div className="grid grid-cols-2 gap-4">
          <div className="text-center p-4 bg-gray-50 rounded-lg">
            <div className="text-2xl font-bold text-blue-600">{cacheStats.count}</div>
            <div className="text-sm text-gray-600">Cached Videos</div>
          </div>
          <div className="text-center p-4 bg-gray-50 rounded-lg">
            <div className="text-2xl font-bold text-green-600">{formatFileSize(cacheStats.totalSize)}</div>
            <div className="text-sm text-gray-600">Storage Used</div>
          </div>
        </div>

        {/* Cache Status */}
        <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
          <div className="flex items-center space-x-2">
            <Download className="h-4 w-4 text-blue-600" />
            <span className="text-sm font-medium">Offline Playback Status</span>
          </div>
          <Badge variant={cacheStats.count > 0 ? "default" : "secondary"}>
            {cacheStats.count > 0 ? "Enabled" : "No Cache"}
          </Badge>
        </div>

        {/* Benefits Information */}
        <div className="p-3 bg-green-50 rounded-lg">
          <h4 className="font-medium text-green-800 mb-2">Benefits of Video Caching:</h4>
          <ul className="text-sm text-green-700 space-y-1">
            <li>• Videos play offline when internet is down</li>
            <li>• Reduced bandwidth usage after initial download</li>
            <li>• Faster video loading and smoother playback</li>
            <li>• Automatic background downloading of scheduled videos</li>
          </ul>
        </div>

        {/* Action Buttons */}
        <div className="flex space-x-2">
          <Button 
            onClick={loadCacheStats} 
            variant="outline" 
            size="sm"
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh Stats
          </Button>
          
          <Button 
            onClick={handleClearOldCache} 
            variant="outline" 
            size="sm"
            disabled={isLoading}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Clear Old Cache
          </Button>
          
          <Button 
            onClick={handleClearCache} 
            variant="destructive" 
            size="sm"
            disabled={isLoading}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Clear All Cache
          </Button>
        </div>

        <div className="text-xs text-gray-500 mt-4">
          Videos are automatically cached when first played. Cache is stored locally on each device.
          Old cache (7+ days) can be cleared to free up storage space.
        </div>
      </CardContent>
    </Card>
  );
}