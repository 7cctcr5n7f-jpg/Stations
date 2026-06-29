// Enhanced video caching system for smooth playback and offline availability
class VideoCacheManager {
  private dbName = 'TenRoundsVideoCache';
  private dbVersion = 2;
  private storeName = 'videos';
  private db: IDBDatabase | null = null;
  private loadingPromises: Map<number, Promise<string>> = new Map();
  private blobUrlCache: Map<number, string> = new Map();

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
        
        // Clear old version stores
        if (db.objectStoreNames.contains(this.storeName)) {
          db.deleteObjectStore(this.storeName);
        }
        
        // Create new optimized store
        const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
        store.createIndex('url', 'url', { unique: true });
        store.createIndex('cachedDate', 'cachedDate');
        store.createIndex('lastAccessed', 'lastAccessed');
        store.createIndex('priority', 'priority');
      };
    });
  }

  async cacheVideo(videoId: number, videoUrl: string, priority: 'high' | 'normal' | 'low' = 'normal'): Promise<string> {
    if (!this.db) await this.init();

    // Return existing loading promise if video is currently being cached
    if (this.loadingPromises.has(videoId)) {
      return this.loadingPromises.get(videoId)!;
    }

    // Check if video is already cached and blob URL is still valid
    const cached = await this.getCachedVideo(videoId);
    if (cached) {
      // Update last accessed time
      this.updateLastAccessed(videoId);
      return cached.blobUrl;
    }

    // Create loading promise to prevent duplicate downloads
    const loadingPromise = this.downloadAndCacheVideo(videoId, videoUrl, priority);
    this.loadingPromises.set(videoId, loadingPromise);

    try {
      const result = await loadingPromise;
      return result;
    } finally {
      this.loadingPromises.delete(videoId);
    }
  }

  private async downloadAndCacheVideo(videoId: number, videoUrl: string, priority: 'high' | 'normal' | 'low'): Promise<string> {
    try {
      console.log(`🎥 Caching video ${videoId} (${priority} priority)`);
      
      // Download with progress tracking for better UX
      const response = await fetch(videoUrl);
      if (!response.ok) throw new Error(`Failed to fetch video: ${response.statusText}`);
      
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      
      // Cache the blob URL in memory for quick access
      this.blobUrlCache.set(videoId, blobUrl);

      // Store in IndexedDB with enhanced metadata
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      
      await new Promise((resolve, reject) => {
        const request = store.put({
          id: videoId,
          url: videoUrl,
          blob: blob,
          blobUrl: blobUrl,
          cachedDate: new Date().toISOString(),
          lastAccessed: new Date().toISOString(),
          size: blob.size,
          priority: priority
        });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      console.log(`✅ Video ${videoId} cached successfully (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);
      return blobUrl;
    } catch (error) {
      console.error(`❌ Failed to cache video ${videoId}:`, error);
      return videoUrl; // Fallback to original URL
    }
  }

  private async updateLastAccessed(videoId: number): Promise<void> {
    if (!this.db) return;
    
    try {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const getRequest = store.get(videoId);
      
      getRequest.onsuccess = () => {
        const video = getRequest.result;
        if (video) {
          video.lastAccessed = new Date().toISOString();
          store.put(video);
        }
      };
    } catch (error) {
      console.error('Failed to update last accessed time:', error);
    }
  }

  async getCachedVideo(videoId: number): Promise<{ blobUrl: string; blob: Blob } | null> {
    // Temporarily disable cache to avoid blob URL issues
    return null;
    if (!this.db) await this.init();

    // Check memory cache first for instant access
    if (this.blobUrlCache.has(videoId)) {
      const cachedUrl = this.blobUrlCache.get(videoId)!;
      // Verify the blob URL is still valid
      try {
        const response = await fetch(cachedUrl);
        if (response.ok) {
          const blob = await response.blob();
          return { blobUrl: cachedUrl, blob };
        }
      } catch {
        // Blob URL expired, remove from memory cache
        this.blobUrlCache.delete(videoId);
      }
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(videoId);

      request.onsuccess = () => {
        const result = request.result;
        if (result && result.blob) {
          // Create fresh blob URL from stored blob
          const blobUrl = URL.createObjectURL(result.blob);
          // Cache in memory for quick future access
          this.blobUrlCache.set(videoId, blobUrl);
          resolve({ blobUrl, blob: result.blob });
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  // Preload multiple videos for smooth playback
  async preloadVideos(videoIds: number[], videoUrls: { [key: number]: string }): Promise<void> {
    // Temporarily disable preloading to avoid caching issues
    return;
    
    console.log(`🚀 Preloading ${videoIds.length} videos for smooth playback`);
    
    // Sort by priority: currently scheduled videos get high priority
    const preloadPromises = videoIds.map(async (videoId, index) => {
      const url = videoUrls[videoId];
      if (!url) return;
      
      // High priority for first 4 videos (current room), normal for others
      const priority = index < 4 ? 'high' : 'normal';
      
      try {
        await this.cacheVideo(videoId, url, priority);
      } catch (error) {
        console.warn(`Failed to preload video ${videoId}:`, error);
      }
    });

    // Use Promise.allSettled to prevent one failure from stopping others
    await Promise.allSettled(preloadPromises);
    console.log(`✅ Video preloading completed`);
  }

  // Get video with smart fallback strategy
  async getVideoForPlayback(videoId: number, originalUrl: string): Promise<string> {
    try {
      // Always return original URL for reliability
      // Background caching is handled separately
      return originalUrl;
      
    } catch (error) {
      console.error(`Error getting video ${videoId}:`, error);
      return originalUrl;
    }
  }

  async clearOldCache(olderThanDays: number = 7): Promise<void> {
    // Temporarily disabled to prevent IDBKeyRange errors
    return;
    
    if (!this.db) await this.init();

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const transaction = this.db!.transaction([this.storeName], 'readwrite');
    const store = transaction.objectStore(this.storeName);
    const index = store.index('cachedDate');
    
    // const request = index.openCursor(IDBKeyRange.upperBound(cutoffDate.toISOString()));
    
    // request.onsuccess = (event) => {
    //   const cursor = (event.target as IDBRequest).result;
    //   if (cursor) {
    //     // Revoke blob URL to free memory
    //     if (cursor.value.blobUrl) {
    //       URL.revokeObjectURL(cursor.value.blobUrl);
    //     }
    //     cursor.delete();
    //     cursor.continue();
    //   }
    // };
  }

  async getCacheStats(): Promise<{ count: number; totalSize: number }> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();

      request.onsuccess = () => {
        const videos = request.result;
        const totalSize = videos.reduce((sum, video) => sum + (video.size || 0), 0);
        resolve({ count: videos.length, totalSize });
      };
      request.onerror = () => reject(request.error);
    });
  }

  async clearAllCache(): Promise<void> {
    if (!this.db) await this.init();

    // Revoke all memory-cached blob URLs
    this.blobUrlCache.forEach(blobUrl => {
      URL.revokeObjectURL(blobUrl);
    });
    this.blobUrlCache.clear();

    const transaction = this.db!.transaction([this.storeName], 'readwrite');
    const store = transaction.objectStore(this.storeName);
    
    // Get all videos to revoke blob URLs
    const getRequest = store.getAll();
    getRequest.onsuccess = () => {
      const videos = getRequest.result;
      videos.forEach(video => {
        if (video.blobUrl) {
          URL.revokeObjectURL(video.blobUrl);
        }
      });
    };

    // Clear the store
    await new Promise((resolve, reject) => {
      const clearRequest = store.clear();
      clearRequest.onsuccess = () => resolve(clearRequest.result);
      clearRequest.onerror = () => reject(clearRequest.error);
    });
  }

  // Clean up expired blob URLs and old cache entries
  async cleanupCache(): Promise<void> {
    // Temporarily disabled to prevent IDBKeyRange errors
    return;
    
    if (!this.db) await this.init();

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 14); // Keep cache for 2 weeks

    const transaction = this.db!.transaction([this.storeName], 'readwrite');
    const store = transaction.objectStore(this.storeName);
    const index = store.index('lastAccessed');
    
    // const request = index.openCursor(IDBKeyRange.upperBound(cutoffDate.toISOString()));
    
    // request.onsuccess = (event) => {
    //   const cursor = (event.target as IDBRequest).result;
    //   if (cursor) {
    //     const video = cursor.value;
    //     // Revoke blob URL and remove from memory cache
    //     if (video.blobUrl) {
    //       URL.revokeObjectURL(video.blobUrl);
    //     }
    //     this.blobUrlCache.delete(video.id);
    //     cursor.delete();
    //     cursor.continue();
    //   }
    // };
  }
}

export const videoCacheManager = new VideoCacheManager();