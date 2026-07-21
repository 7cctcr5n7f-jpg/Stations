// Service Worker: cache-first strategy for R2 thumbnail images only.
//
// IMPORTANT: Videos are intentionally NOT intercepted. The `<video>` element
// issues 206 range requests that a Cache Storage entry can't satisfy, and any
// synthesized error response turns a transient blip into a hard "failed to
// load". Videos are served from R2 with `Cache-Control: immutable`, so the
// browser's native HTTP cache already handles caching AND range requests far
// better than a Service Worker can. We only cache-first the tiny (~3KB)
// thumbnail JPEGs used by the admin Live View planning grid.

const CACHE_NAME = "stations-media-v3";
const R2_ORIGIN = "https://pub-f7e9428d9fb14d72b5dcc8e91a0fd742.r2.dev";

// Only cache-first small immutable thumbnail images. Everything else
// (videos especially) is left to the browser's native HTTP cache.
function isCacheableThumbnail(url) {
  if (!url.startsWith(R2_ORIGIN + "/")) return false;
  const path = url.split("?")[0].toLowerCase();
  return (
    path.includes("/thumbnails/") ||
    path.endsWith(".jpg") ||
    path.endsWith(".jpeg") ||
    path.endsWith(".png") ||
    path.endsWith(".webp")
  );
}

self.addEventListener("install", (event) => {
  // Activate immediately without waiting for existing clients to close
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Delete any stale caches (e.g. the old v1 that wrongly cached videos)
  // and claim all open tabs so the new SW takes over immediately.
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle GET requests for thumbnail images. Videos and everything
  // else fall through to the network / browser HTTP cache untouched.
  if (request.method !== "GET") return;
  if (!isCacheableThumbnail(request.url)) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;

      // No synthesized error responses here: if the network fetch fails we let
      // it reject so the <img> shows its natural error state (and the Live View
      // falls back to a titled placeholder). Thumbnails are tiny, so a fresh
      // fetch is cheap.
      const response = await fetch(request);
      if (response.ok && response.status === 200) {
        cache.put(request, response.clone());
      }
      return response;
    })
  );
});

// Listen for messages to manage the cache
self.addEventListener("message", (event) => {
  if (event.data?.type === "CLEAR_MEDIA_CACHE") {
    caches.delete(CACHE_NAME).then(() => {
      event.source?.postMessage({ type: "CACHE_CLEARED" });
    });
  }

  if (event.data?.type === "CACHE_STATS") {
    caches.open(CACHE_NAME).then(async (cache) => {
      const keys = await cache.keys();
      let totalSize = 0;
      for (const req of keys) {
        const resp = await cache.match(req);
        if (resp) {
          const len = resp.headers.get("content-length");
          if (len) totalSize += parseInt(len, 10);
        }
      }
      event.source?.postMessage({
        type: "CACHE_STATS_RESULT",
        count: keys.length,
        totalSizeMB: Math.round(totalSize / 1024 / 1024),
      });
    });
  }
});
