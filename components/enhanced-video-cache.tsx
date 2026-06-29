import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

interface CacheEntry {
  videoId: number;
  title: string;
  url: string;
  cachedAt: number;
  size: number;
  status: 'cached' | 'caching' | 'error' | 'pending';
}

class EnhancedVideoCache {
  private dbName = 'tenrounds-video-cache-v2';
  private dbVersion = 2;
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Clear old stores if they exist
        if (db.objectStoreNames.contains('videos')) {
          db.deleteObjectStore('videos');
        }
        if (db.objectStoreNames.contains('metadata')) {
          db.deleteObjectStore('metadata');
        }
        
        // Create new stores
        const videoStore = db.createObjectStore('videos', { keyPath: 'videoId' });
        videoStore.createIndex('url', 'url', { unique: true });
        
        const metadataStore = db.createObjectStore('metadata', { keyPath: 'key' });
      };
    });
  }

  async cacheVideo(videoId: number, title: string, url: string): Promise<void> {
    if (!this.db) await this.init();
    
    try {
      // Check if already cached
      const existing = await this.getVideoFromCache(videoId);
      if (existing) {
        console.log(`Video ${videoId} already cached`);
        return;
      }

      console.log(`Starting cache for video ${videoId}: ${title}`);
      
      // Download video
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch video: ${response.statusText}`);
      
      const blob = await response.blob();
      const cacheEntry: CacheEntry = {
        videoId,
        title,
        url,
        cachedAt: Date.now(),
        size: blob.size,
        status: 'cached'
      };

      // Store in IndexedDB
      const transaction = this.db!.transaction(['videos'], 'readwrite');
      const store = transaction.objectStore('videos');
      
      await new Promise<void>((resolve, reject) => {
        const request = store.put({ ...cacheEntry, blob });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });

      console.log(`Video ${videoId} cached successfully (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);
      
    } catch (error) {
      console.error(`Failed to cache video ${videoId}:`, error);
      
      // Store error status
      const errorEntry: CacheEntry = {
        videoId,
        title,
        url,
        cachedAt: Date.now(),
        size: 0,
        status: 'error'
      };
      
      if (this.db) {
        const transaction = this.db.transaction(['videos'], 'readwrite');
        const store = transaction.objectStore('videos');
        store.put(errorEntry);
      }
      
      throw error;
    }
  }

  async getVideoFromCache(videoId: number): Promise<string | null> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['videos'], 'readonly');
      const store = transaction.objectStore('videos');
      const request = store.get(videoId);
      
      request.onsuccess = () => {
        const result = request.result;
        if (result && result.blob && result.status === 'cached') {
          const url = URL.createObjectURL(result.blob);
          resolve(url);
        } else {
          resolve(null);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  async getCacheStatus(): Promise<CacheEntry[]> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['videos'], 'readonly');
      const store = transaction.objectStore('videos');
      const request = store.getAll();
      
      request.onsuccess = () => {
        const results = request.result.map((item: any) => ({
          videoId: item.videoId,
          title: item.title,
          url: item.url,
          cachedAt: item.cachedAt,
          size: item.size,
          status: item.status
        }));
        resolve(results);
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  async clearCache(): Promise<void> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['videos'], 'readwrite');
      const store = transaction.objectStore('videos');
      const request = store.clear();
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async removeCachedVideo(videoId: number): Promise<void> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['videos'], 'readwrite');
      const store = transaction.objectStore('videos');
      const request = store.delete(videoId);
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async cacheScheduledVideos(scheduledVideos: Array<{ videoId: number; title: string; url: string }>): Promise<void> {
    console.log(`Starting cache process for ${scheduledVideos.length} scheduled videos`);
    
    for (const video of scheduledVideos) {
      try {
        await this.cacheVideo(video.videoId, video.title, video.url);
      } catch (error) {
        console.error(`Failed to cache video ${video.videoId}:`, error);
        // Continue with other videos even if one fails
      }
    }
    
    console.log('Scheduled video caching completed');
  }
}

export const enhancedVideoCache = new EnhancedVideoCache();

export function useVideoCaching() {
  const [cacheStatus, setCacheStatus] = useState<CacheEntry[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    enhancedVideoCache.init().then(() => {
      setIsInitialized(true);
      refreshCacheStatus();
    });
  }, []);

  const refreshCacheStatus = async () => {
    try {
      const status = await enhancedVideoCache.getCacheStatus();
      setCacheStatus(status);
    } catch (error) {
      console.error('Failed to get cache status:', error);
    }
  };

  const cacheAllScheduledVideos = async () => {
    try {
      // Get today's scheduled videos
      const schedules = queryClient.getQueryData(['/api/schedules']) as any[];
      const videos = queryClient.getQueryData(['/api/videos']) as any[];
      
      if (!schedules || !videos) return;

      const today = new Date().toISOString().split('T')[0];
      const todaySchedules = schedules.filter(s => s.scheduleDate === today);
      
      const scheduledVideos = todaySchedules
        .map(schedule => {
          const video = videos.find(v => v.id === schedule.videoId);
          return video ? {
            videoId: video.id,
            title: video.title,
            url: video.url
          } : null;
        })
        .filter((video): video is { videoId: number; title: string; url: string } => video !== null);

      await enhancedVideoCache.cacheScheduledVideos(scheduledVideos);
      await refreshCacheStatus();
      
    } catch (error) {
      console.error('Failed to cache scheduled videos:', error);
    }
  };

  const getCachedVideoUrl = async (videoId: number): Promise<string | null> => {
    return enhancedVideoCache.getVideoFromCache(videoId);
  };

  return {
    cacheStatus,
    isInitialized,
    refreshCacheStatus,
    cacheAllScheduledVideos,
    getCachedVideoUrl,
    clearCache: enhancedVideoCache.clearCache.bind(enhancedVideoCache),
    removeCachedVideo: enhancedVideoCache.removeCachedVideo.bind(enhancedVideoCache)
  };
}