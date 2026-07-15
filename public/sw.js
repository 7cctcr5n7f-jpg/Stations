// Service Worker: cache-first strategy for R2 video and thumbnail assets.
// Videos use unique timestamp filenames, so they can be cached indefinitely.

const CACHE_NAME = "stations-media-v1";
const R2_ORIGIN = "https://pub-f7e9428d9fb14d72b5dcc8e91a0fd742.r2.dev";

// Only intercept requests to the R2 public bucket
function isR2Media(url) {
  return url.startsWith(R2_ORIGIN + "/");
}

self.addEventListener("install", (event) => {
  // Activate immediately without waiting for existing clients to close
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Claim all open tabs so the SW starts intercepting immediately
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

  if (!isR2Media(request.url)) return;

  // Cache-first: serve from cache if available, otherwise fetch and cache
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;

      try {
        const response = await fetch(request);

        // Only cache successful full responses (not partial/range)
        if (response.ok && response.status === 200) {
          // Clone before caching because the response body can only be consumed once
          cache.put(request, response.clone());
        }

        return response;
      } catch (err) {
        // Network failure — return a minimal error response so the video
        // player's retry logic can kick in rather than an opaque fetch error
        return new Response("Network error", { status: 503, statusText: "Offline" });
      }
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
