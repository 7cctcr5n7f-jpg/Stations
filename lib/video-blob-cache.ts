"use client"

// ---------------------------------------------------------------------------
// Client-side video blob cache.
//
// Downloads each video ONCE (through the same-origin /api/video-proxy, since
// the public R2 bucket has no CORS headers) and stores the raw bytes in
// IndexedDB keyed by the original R2 URL. Subsequent plays — including the next
// day, after a full page reload — return an object URL built from the stored
// blob with zero network access. A day's NEW video has a new URL, so it is a
// cache miss and gets downloaded once; unchanged videos replay from cache.
//
// The DB name / version / stores are kept identical to the room page so both
// share one schema without triggering an IndexedDB version conflict.
// ---------------------------------------------------------------------------

const DB_NAME = "stations-room-cache"
const DB_VERSION = 1
const VIDEO_STORE = "videos"

// Prune cached blobs untouched for this long so device storage stays bounded
// even though the room accumulates new clips over time.
const MAX_VIDEO_AGE_MS = 7 * 24 * 60 * 60 * 1000

type CachedVideo = {
  blob: Blob
  cachedAt: number
  lastUsedAt: number
  url: string
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains("schedules")) db.createObjectStore("schedules")
      if (!db.objectStoreNames.contains(VIDEO_STORE)) db.createObjectStore(VIDEO_STORE)
    }
  })
}

function idbGet(key: string): Promise<CachedVideo | undefined> {
  return openDB().then(
    (db) =>
      new Promise<CachedVideo | undefined>((resolve, reject) => {
        const tx = db.transaction(VIDEO_STORE, "readonly")
        const req = tx.objectStore(VIDEO_STORE).get(key)
        req.onsuccess = () => resolve(req.result as CachedVideo | undefined)
        req.onerror = () => reject(req.error)
      }),
  )
}

function idbPut(key: string, value: CachedVideo): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(VIDEO_STORE, "readwrite")
        const req = tx.objectStore(VIDEO_STORE).put(value, key)
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error)
      }),
  )
}

function idbDelete(key: string): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(VIDEO_STORE, "readwrite")
        const req = tx.objectStore(VIDEO_STORE).delete(key)
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error)
      }),
  )
}

function proxyUrl(originalUrl: string): string {
  return `/api/video-proxy?url=${encodeURIComponent(originalUrl)}`
}

/**
 * Return a playable object URL for a video, downloading + caching it once if
 * needed. Throws if the download fails so the caller can fall back to direct
 * streaming (this function never silently returns a broken URL).
 *
 * The caller owns the returned object URL and must revoke it with
 * `URL.revokeObjectURL` when it is no longer needed.
 */
export async function getCachedVideoObjectURL(
  originalUrl: string,
  opts: { signal?: AbortSignal } = {},
): Promise<{ objectUrl: string; fromCache: boolean }> {
  // 1. Try the local cache first.
  try {
    const existing = await idbGet(originalUrl)
    if (existing?.blob && existing.blob.size > 0) {
      // Touch lastUsedAt (best effort) so pruning keeps active clips.
      idbPut(originalUrl, { ...existing, lastUsedAt: Date.now() }).catch(() => {})
      return { objectUrl: URL.createObjectURL(existing.blob), fromCache: true }
    }
  } catch {
    // IndexedDB unavailable (private mode / quota) — fall through to network.
  }

  // 2. Download once through the same-origin proxy.
  const res = await fetch(proxyUrl(originalUrl), { signal: opts.signal })
  if (!res.ok) {
    throw new Error(`Proxy download failed (${res.status})`)
  }
  const blob = await res.blob()
  if (blob.size === 0) {
    throw new Error("Downloaded empty video blob")
  }

  // 3. Store for next time (best effort — playback proceeds even if this fails).
  const now = Date.now()
  idbPut(originalUrl, { blob, cachedAt: now, lastUsedAt: now, url: originalUrl }).catch(() => {})

  return { objectUrl: URL.createObjectURL(blob), fromCache: false }
}

/**
 * Delete cached videos not used within MAX_VIDEO_AGE_MS. Best effort; safe to
 * call on every room load. Never throws.
 */
export async function pruneStaleVideos(): Promise<void> {
  try {
    const db = await openDB()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(VIDEO_STORE, "readwrite")
      const store = tx.objectStore(VIDEO_STORE)
      const cutoff = Date.now() - MAX_VIDEO_AGE_MS
      const cursorReq = store.openCursor()
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result
        if (!cursor) return
        const value = cursor.value as CachedVideo | undefined
        const stamp = value?.lastUsedAt ?? value?.cachedAt ?? 0
        if (stamp && stamp < cutoff) cursor.delete()
        cursor.continue()
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } catch {
    // ignore
  }
}

/** Remove a single cached video (e.g. if it is found to be corrupt). */
export async function evictCachedVideo(originalUrl: string): Promise<void> {
  try {
    await idbDelete(originalUrl)
  } catch {
    // ignore
  }
}
