"use client"

import { useRef, useEffect, useState } from "react"
import { Play } from "lucide-react"
import { getCachedVideoObjectURL, evictCachedVideo } from "@/lib/video-blob-cache"
import { proxiedThumbnailUrl } from "@/lib/thumbnail-url"

interface VideoPlayerProps {
  assignment: {
    id: number;
    sets: number;
    reps: string | number; // Allow both string and number
    zoomLevel?: string;
    verticalPosition?: string;
    displayEquipment?: string;
    video: {
      id: number;
      title: string;
      url: string;
      duration: string;
      bodyPart: string;
      equipment: string;
      intensity?: "Low" | "Medium" | "High" | null;
      thumbnailUrl?: string | null;
    };
  };
  displayMode?: 'single' | 'split';
  videoCount?: number;
  isFullscreen?: boolean;
  /** Milliseconds to wait before starting the video load (stagger concurrent loads) */
  loadDelay?: number;
  /**
   * Render the exercise thumbnail image instead of streaming the video.
   * Used by the admin Live View planning grid where 20+ tiles render at once —
   * thumbnails (≈3KB each) load instantly and reliably, avoiding the browser's
   * ~6-connection-per-host limit that causes concurrent video loads to fail.
   */
  thumbnailMode?: boolean;
}

// Thumbnails (admin Live View) can transiently fail on constrained networks —
// e.g. a gym tablet hitting Cloudflare r2.dev rate limits when 20+ load at once.
// Retry a few times with a cache-busting query + backoff before falling back to
// a titled placeholder.
const MAX_THUMB_ATTEMPTS = 4;

// Room videos can transiently fail on a flaky gym network. Retry the SAME url
// in place (so the browser reuses its immutable HTTP cache — load once, loop
// from cache) for the first attempts; only the final attempt cache-busts as a
// last resort to recover from a poisoned cache entry.
const MAX_VIDEO_ATTEMPTS = 3;

// --- Room self-healing (non-thumbnail mode only) ---------------------------
// "Reboot fixes it, page refresh doesn't" points at a wedged native video
// decoder in the Android TV WebView: a refresh reuses the same WebView process
// (decoder stays stuck), only a reboot resets the media stack. So after the
// in-place reloads are exhausted we RECREATE the <video> element (fresh decoder
// session) and, as a bounded last resort, reload the page — all event-driven,
// no server polling.
const MAX_MEDIA_GENERATIONS = 2;      // <video> element recreations before page reload
const STALL_RECOVERY_MS = 12000;      // a waiting/stalled that never clears → recover
const LIVENESS_INTERVAL_MS = 5000;    // local (offline) progress watchdog tick
const FREEZE_CHECKS = 3;              // consecutive ticks with no playback progress → recover
const RELOAD_COOLDOWN_MS = 5 * 60 * 1000; // min gap between last-resort page reloads
const RELOAD_STAMP_KEY = "stations:roomReloadTs";

const detectDebugMedia = () => {
  if (typeof window === "undefined") return false;
  return /[?&]debug=(1|media|true)/i.test(window.location.search);
};

const canReloadNow = () => {
  if (typeof window === "undefined") return false;
  try {
    const prev = Number(window.sessionStorage.getItem(RELOAD_STAMP_KEY) || "0");
    return !prev || Date.now() - prev > RELOAD_COOLDOWN_MS;
  } catch {
    return false; // storage blocked → don't risk a reload loop
  }
};

const markReloadNow = () => {
  try {
    window.sessionStorage.setItem(RELOAD_STAMP_KEY, String(Date.now()));
    return true;
  } catch {
    return false; // couldn't persist the cooldown → don't reload (avoid a loop)
  }
};

export default function VideoPlayer({ assignment, displayMode = 'single', videoCount = 1, isFullscreen = false, loadDelay = 0, thumbnailMode = false }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const zoom = Math.max(parseFloat(assignment.zoomLevel || "1"), 1.02); // min 1.02 clips video edge codec artifacts
  const verticalPos = parseFloat(assignment.verticalPosition || "0");
  const [videoSrc, setVideoSrc] = useState("");
  const [isCached, setIsCached] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [thumbError, setThumbError] = useState(false);
  const [thumbAttempt, setThumbAttempt] = useState(0);
  const thumbRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Holds the current blob object URL (when playing from local cache) so it can
  // be revoked on cleanup / source change to avoid leaking memory on the kiosk.
  const objectUrlRef = useRef<string>("");

  // Room self-healing / instrumentation state (non-thumbnail mode only).
  const [mediaGeneration, setMediaGeneration] = useState(0); // bump → recreate <video>
  const [debugMedia] = useState(detectDebugMedia);           // ?debug=1 on-screen media log
  const [mediaLog, setMediaLog] = useState<string[]>([]);    // recent media events (debug UI)
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activityRef = useRef(0);        // monotonic timeupdate counter (loop-safe liveness)
  const lastSeenActivityRef = useRef(0);
  const frozenChecksRef = useRef(0);

  const logMedia = (name: string, extra?: string) => {
    const v = videoRef.current;
    const rs = v?.readyState ?? -1;
    const ns = v?.networkState ?? -1;
    const code = v?.error?.code;
    const line = `${new Date().toLocaleTimeString()} ${name} rs${rs} ns${ns}${code ? ` err${code}` : ""}${extra ? ` ${extra}` : ""}`;
    console.log(`[room-media #${assignment.video.id} ${assignment.video.title}] ${line}`);
    if (debugMedia) setMediaLog((l) => [...l.slice(-13), line]);
  };

  const clearStallTimer = () => {
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
  };

  // Bump loadAttempt to enter the recovery ladder (in-place reload → recreate
  // element → bounded page reload). Shared by error, stall and freeze paths.
  const triggerRecovery = (reason: string) => {
    if (videoError) return;
    logMedia("recover", reason);
    setLoadAttempt((a) => a + 1);
  };

  // A waiting/stalled that doesn't clear within a bounded local window is a
  // real stall → recover. Cleared as soon as playback resumes (playing/timeupdate).
  const armStallTimer = (reason: string) => {
    if (thumbnailMode || videoError || stallTimerRef.current) return;
    stallTimerRef.current = setTimeout(() => {
      stallTimerRef.current = null;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const v = videoRef.current;
      if (v && !v.paused && !videoError) triggerRecovery(`stall:${reason}`);
    }, STALL_RECOVERY_MS);
  };

  const withRetryBuster = (url: string, attempt: number) => {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}retry=${attempt}`;
  };

  // Initialize video: download the clip ONCE into local storage (IndexedDB) and
  // play it from a blob URL, so the room loops entirely offline and re-opening
  // the next day only downloads clips whose URL changed. Any failure falls back
  // to streaming the file directly, so playback never regresses to "not loaded".
  useEffect(() => {
    if (thumbnailMode) return; // thumbnail mode never loads the video stream
    const videoUrl = assignment.video.url?.trim();
    if (!videoUrl) {
      console.warn(`[v0] Video ${assignment.video.id} has no URL - marking as error`);
      setVideoError(true);
      return;
    }

    setLoadAttempt(0);
    setVideoLoaded(false);
    setVideoError(false);
    setIsCached(false);
    // Reset the self-heal recovery budget for the new video identity/source, so
    // a clip that previously exhausted its element-recreation budget doesn't
    // start already-exhausted (e.g. an admin swaps a station's video mid-day).
    setMediaGeneration(0);
    frozenChecksRef.current = 0;
    lastSeenActivityRef.current = activityRef.current;
    clearStallTimer();

    let cancelled = false;
    const controller = new AbortController();
    let localObjectUrl = "";

    const start = async () => {
      // Stagger so many tiles don't open all their downloads at once.
      if (loadDelay > 0) {
        await new Promise((r) => setTimeout(r, loadDelay));
        if (cancelled) return;
      }
      try {
        const { objectUrl, fromCache } = await getCachedVideoObjectURL(videoUrl, {
          signal: controller.signal,
        });
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        localObjectUrl = objectUrl;
        objectUrlRef.current = objectUrl;
        setIsCached(true);
        setVideoSrc(objectUrl);
        console.log(`[v0] Video ${assignment.video.id} ${fromCache ? "from cache" : "downloaded + cached"}`);
      } catch (e) {
        if (cancelled) return;
        // Fallback: stream directly from R2 so a cache/proxy issue never stops playback.
        console.warn(`[v0] Video ${assignment.video.id} cache failed, streaming direct:`, (e as Error)?.message);
        setIsCached(false);
        setVideoSrc(videoUrl);
      }
    };
    void start();

    return () => {
      cancelled = true;
      controller.abort();
      if (localObjectUrl) URL.revokeObjectURL(localObjectUrl);
      objectUrlRef.current = "";
    };
  }, [assignment.video.id, assignment.video.url, loadDelay, thumbnailMode]);

  // (Re)load the video element whenever its source changes. Covers the initial
  // load, same-element video swaps (e.g. an admin edits a station mid-day), and
  // element recreation (mediaGeneration bump → fresh <video> needs an explicit load).
  useEffect(() => {
    if (thumbnailMode || !videoSrc) return;
    videoRef.current?.load();
  }, [videoSrc, thumbnailMode, mediaGeneration]);

  // Recovery ladder. An error/stall/freeze bumps loadAttempt; we escalate:
  //   1. reload the source IN PLACE on the same element (reuses HTTP/blob cache);
  //   2. if a cached blob proved unusable, evict it and stream directly;
  //   3. recreate the <video> element (fresh native decoder — the fix a page
  //      refresh can't achieve because it reuses the wedged WebView decoder);
  //   4. as a bounded last resort, reload the whole page (cooldown-guarded);
  //   5. give up and show the manual-reload error UI.
  useEffect(() => {
    if (thumbnailMode || videoError || loadAttempt === 0) return;
    if (loadAttempt > MAX_VIDEO_ATTEMPTS) {
      // (2) A cached blob turned out unusable → drop it and stream directly.
      if (isCached) {
        const direct = assignment.video.url?.trim() || "";
        void evictCachedVideo(direct);
        if (objectUrlRef.current) {
          URL.revokeObjectURL(objectUrlRef.current);
          objectUrlRef.current = "";
        }
        setIsCached(false);
        setVideoLoaded(false);
        setVideoError(false);
        setLoadAttempt(0);
        if (direct) setVideoSrc(direct);
        return;
      }
      // (3) In-place reloads exhausted → recreate the element to release a
      // possibly-wedged decoder (what a reboot does, without a reboot).
      if (mediaGeneration < MAX_MEDIA_GENERATIONS) {
        logMedia("recreate-element", `gen${mediaGeneration + 1}`);
        clearStallTimer();
        frozenChecksRef.current = 0;
        setMediaGeneration((g) => g + 1);
        setVideoLoaded(false);
        setVideoError(false);
        setLoadAttempt(0);
        return;
      }
      // (4) Last resort: one bounded full-page reload (clears JS/app state).
      // Only reload if we actually persisted the cooldown stamp, so a
      // read-ok/write-fails sessionStorage can't cause a reload loop.
      if (canReloadNow() && markReloadNow()) {
        logMedia("page-reload");
        window.location.reload();
        return;
      }
      // (5) Out of options — surface the manual reload control.
      logMedia("give-up");
      setVideoError(true);
      return;
    }
    videoRef.current?.load();
    // logMedia is a stable per-render logger; intentionally not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAttempt, thumbnailMode, isCached, assignment.video.url, mediaGeneration, videoError]);

  useEffect(() => {
    if (thumbnailMode) return; // no video timeout logic in thumbnail mode
    if (!videoRef.current || videoLoaded || videoError) return;

    // When many videos load simultaneously (Live View: 20+), the browser
    // queues them (≈6 concurrent per hostname). Use a generous timeout
    // that scales with the number of sibling video elements so later ones
    // don't time out while waiting in the queue.
    const peerCount = document.querySelectorAll("video").length;
    const baseTimeout = 25000;
    // Add 3s per concurrent video beyond the first 4 (browser's connection limit)
    const extraMs = Math.max(0, peerCount - 4) * 3000;
    const timeout = baseTimeout + Math.min(extraMs, 60000); // cap at 85s total

    const loadTimeout = setTimeout(() => {
      if (videoLoaded || videoError) return;

      const v = videoRef.current;
      // If the video already has enough data to play, a canplay event was
      // likely missed while buffering — treat it as loaded rather than failing.
      if (v && v.readyState >= 3) {
        setVideoLoaded(true);
        v.play().catch(() => setAutoplayBlocked(true));
        return;
      }

      // Still not ready: retry in place (reuses cache). The retry effect
      // escalates and only hard-fails after the final attempt, so a slow but
      // healthy load is never falsely marked "failed".
      setLoadAttempt((a) => a + 1);
    }, timeout);

    return () => {
      clearTimeout(loadTimeout);
    }
  }, [videoLoaded, videoError, loadAttempt, thumbnailMode]);

  // Post-load freeze watchdog (offline, no server polling). A wedged decoder
  // often stops advancing WITHOUT firing any media event, so we watch the
  // monotonic timeupdate activity counter: if it doesn't change across several
  // ticks while the video should be looping, treat it as frozen and recover.
  // Loop-safe (uses activity count, not currentTime which wraps on loop).
  useEffect(() => {
    if (thumbnailMode || !videoLoaded || videoError) return;
    lastSeenActivityRef.current = activityRef.current;
    frozenChecksRef.current = 0;
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const v = videoRef.current;
      if (!v || v.paused || v.ended) return; // not expected to be progressing
      if (activityRef.current !== lastSeenActivityRef.current) {
        lastSeenActivityRef.current = activityRef.current;
        frozenChecksRef.current = 0;
        return;
      }
      frozenChecksRef.current += 1;
      logMedia("freeze-check", `n${frozenChecksRef.current}`);
      if (frozenChecksRef.current >= FREEZE_CHECKS) {
        frozenChecksRef.current = 0;
        triggerRecovery("freeze");
      }
    }, LIVENESS_INTERVAL_MS);
    return () => clearInterval(id);
    // logMedia/triggerRecovery are stable helpers; the watchdog is intentionally
    // (re)armed only on load/error/mode changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoLoaded, videoError, thumbnailMode]);

  // Always clear a pending stall timer on unmount.
  useEffect(() => () => clearStallTimer(), []);

  // On first user interaction anywhere in the document, attempt to play
  // all paused videos. Required for TV boxes and iOS that block autoplay
  // until a user gesture occurs.
  useEffect(() => {
    if (thumbnailMode) return; // no autoplay handling needed for a static thumbnail
    const handler = () => {
      const video = videoRef.current;
      if (video && video.paused && videoLoaded && !videoError) {
        video.play().then(() => setAutoplayBlocked(false)).catch(() => {});
      }
    };
    document.addEventListener("click", handler, { once: true });
    document.addEventListener("touchstart", handler, { once: true });
    return () => {
      document.removeEventListener("click", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [videoLoaded, videoError, thumbnailMode]);

  // Reset thumbnail retry state when the exercise (and thus its thumbnail) changes,
  // and clear any pending retry timer on unmount.
  useEffect(() => {
    if (!thumbnailMode) return;
    setThumbAttempt(0);
    setThumbError(false);
    return () => {
      if (thumbRetryTimer.current) {
        clearTimeout(thumbRetryTimer.current);
        thumbRetryTimer.current = null;
      }
    };
  }, [assignment.video.id, thumbnailMode]);

  const handlePlayable = () => {
    if (videoError) return;

    logMedia("playable");
    clearStallTimer();
    activityRef.current += 1;
    lastSeenActivityRef.current = activityRef.current;
    frozenChecksRef.current = 0;

    setVideoLoaded(true);
    const video = videoRef.current;
    if (!video) return;

    // Immediate play for cached videos, small delay for multi-video to prevent CPU spikes
    const playDelay = isCached ? 0 : (videoCount >= 3 ? Math.random() * 200 : 0);
    setTimeout(() => {
      video.play().catch(() => {
        // Autoplay blocked (common on some TV box browsers and iOS without interaction)
        setAutoplayBlocked(true);
      });
    }, playDelay);
  };

  const handleTapToPlay = () => {
    const video = videoRef.current;
    if (!video) return;
    video.play().then(() => setAutoplayBlocked(false)).catch(console.error);
  };

  const handleVideoError = () => {
    logMedia("error");
    if (videoError) return; // already failed — don't loop on repeated error events
    const v = videoRef.current;
    // If usable data is already available despite the error event, use it.
    if (v && v.readyState >= 3) {
      setVideoLoaded(true);
      v.play().catch(() => setAutoplayBlocked(true));
      return;
    }
    // Retry in place; the retry effect escalates and only hard-fails after the
    // final attempt (so transient blips don't kill playback).
    setLoadAttempt((a) => a + 1);
  };

  // --- Instrumentation + self-heal media handlers (room / video mode) ------
  const handlePlaying = () => {
    logMedia("playing");
    clearStallTimer();
    setAutoplayBlocked(false);
    activityRef.current += 1;
    lastSeenActivityRef.current = activityRef.current;
    frozenChecksRef.current = 0;
  };

  // timeupdate fires ~4x/s during healthy playback — used purely as a loop-safe
  // liveness heartbeat. Do NOT log or setState here (would be far too noisy).
  const handleTimeUpdate = () => {
    activityRef.current += 1;
    if (stallTimerRef.current) clearStallTimer();
  };

  const handleWaiting = () => {
    logMedia("waiting");
    armStallTimer("waiting");
  };

  const handleStalled = () => {
    logMedia("stalled");
    armStallTimer("stalled");
  };

  const handleSuspend = () => {
    // Normal after a full buffer — log only, never treat as a stall.
    logMedia("suspend");
  };

  const handleEmptied = () => {
    logMedia("emptied");
  };

  // A looping video should never fire `ended`; some TV WebViews mishandle loop.
  // If it does, restart playback in place rather than sitting on a frozen frame.
  const handleEnded = () => {
    logMedia("ended");
    const v = videoRef.current;
    if (!v || thumbnailMode) return;
    try {
      v.currentTime = 0;
      void v.play().catch(() => {});
    } catch {
      triggerRecovery("ended");
    }
  };

  const handleManualReload = () => {
    setVideoLoaded(false);
    setVideoError(false);
    setAutoplayBlocked(false);
    setLoadAttempt(0);
    const v = videoRef.current;
    if (v) {
      v.src = videoSrc;
      v.load();
    }
  };



  // Always use 100% so the video fills its grid/flex parent without overflowing
  // (using vh caused the container to exceed available height when a header was present,
  // creating a dark clipping artifact at the overflow edge)
  const containerHeight = '100%';
  const isCompactMode = videoCount >= 3;

  // Get intensity color and styling
  const getIntensityStyles = (intensity?: string | null) => {
    switch (intensity) {
      case "High":
        return { bg: "bg-red-500/90", text: "text-white", label: "HIGH" };
      case "Medium":
        return { bg: "bg-yellow-500/90", text: "text-black", label: "MED" };
      case "Low":
        return { bg: "bg-green-500/90", text: "text-white", label: "LOW" };
      default:
        return null;
    }
  };

  const intensityStyles = getIntensityStyles(assignment.video.intensity);
  const thumbnailUrl = proxiedThumbnailUrl(assignment.video.thumbnailUrl) || "";

  return (
    <div className="relative bg-white w-full h-full overflow-hidden">
      {thumbnailMode ? (
        thumbnailUrl && !thumbError ? (
          <img
            src={thumbAttempt === 0 ? thumbnailUrl : `${thumbnailUrl}${thumbnailUrl.includes('?') ? '&' : '?'}r=${thumbAttempt}`}
            alt={assignment.video.title}
            className="w-full"
            draggable={false}
            loading="lazy"
            decoding="async"
            style={{
              height: containerHeight,
              objectFit: 'contain',
              objectPosition: 'center',
              transform: `scale(${zoom}) translateY(${verticalPos}px)`,
              transformOrigin: 'center',
              backgroundColor: 'white',
            }}
            onError={() => {
              const next = thumbAttempt + 1;
              if (next >= MAX_THUMB_ATTEMPTS) {
                setThumbError(true);
                return;
              }
              if (thumbRetryTimer.current) clearTimeout(thumbRetryTimer.current);
              // Backoff + jitter so retries don't hammer a rate-limited endpoint.
              const backoff = 400 * next + Math.floor(Math.random() * 400);
              thumbRetryTimer.current = setTimeout(() => setThumbAttempt(next), backoff);
            }}
          />
        ) : (
          // Thumbnail missing/failed — show a titled placeholder so the trainer
          // can still identify the station's exercise.
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
            <span className="text-black font-bold text-center px-3 leading-tight text-2xl">
              {assignment.video.title}
            </span>
          </div>
        )
      ) : (
        videoSrc && (
          <video
            key={`${assignment.id}-g${mediaGeneration}`}
            ref={videoRef}
            src={!isCached && loadAttempt >= MAX_VIDEO_ATTEMPTS ? withRetryBuster(videoSrc, MAX_VIDEO_ATTEMPTS) : videoSrc}
            className="w-full"
            tabIndex={-1}
            style={{
              height: containerHeight,
              objectFit: 'contain',
              objectPosition: 'center',
              transform: `scale(${zoom}) translateY(${verticalPos}px)`,
              transformOrigin: 'center',
              backgroundColor: 'white',
              outline: 'none',
              border: 'none',
              display: videoLoaded ? 'block' : 'none',
            }}
            loop
            muted
            playsInline
            // @ts-expect-error webkit-playsinline needed for older WebKit TV box browsers
            webkit-playsinline=""
            autoPlay
            preload="auto"
            controls={false}
            disablePictureInPicture
            crossOrigin={undefined}
            onLoadStart={() => logMedia("loadstart")}
            onLoadedMetadata={() => logMedia("loadedmetadata")}
            onCanPlay={handlePlayable}
            onLoadedData={handlePlayable}
            onPlaying={handlePlaying}
            onTimeUpdate={handleTimeUpdate}
            onWaiting={handleWaiting}
            onStalled={handleStalled}
            onSuspend={handleSuspend}
            onEmptied={handleEmptied}
            onEnded={handleEnded}
            onError={handleVideoError}
          />
        )
      )}
      
      {/* Intensity Badge - Top Left */}
      {intensityStyles && (
        <div className={`absolute ${isCompactMode ? 'top-3 left-3' : 'top-5 left-5'} z-20 pointer-events-none`}>
          <div className={`${intensityStyles.bg} ${intensityStyles.text} rounded-lg font-bold uppercase tracking-wider ${isCompactMode ? 'px-2.5 py-1 text-xs' : 'px-4 py-2 text-sm'}`}>
            {intensityStyles.label}
          </div>
        </div>
      )}

      {/* Video Title - Top Center, padded to avoid intensity badge (left) and reps card (right) */}
      <div className={`absolute ${isCompactMode ? 'top-3' : 'top-5'} left-0 right-0 z-10 flex justify-center pointer-events-none ${isCompactMode ? 'pl-[84px] pr-[116px]' : 'pl-[110px] pr-[160px]'}`}>
        <div className={`bg-white/90 backdrop-blur-sm rounded-lg ${isCompactMode ? 'px-3 py-1.5' : 'px-6 py-3'} text-center`}>
          <h3 className={`${isCompactMode ? 'text-base' : 'text-2xl'} font-bold text-black leading-tight`}>
            {assignment.video.title}
          </h3>
        </div>
      </div>

      {/* Reps + Equipment — top right */}
      {(() => {
        const repsStr = String(assignment.reps ?? '').trim();
        const equipmentRaw = (assignment.displayEquipment || assignment.video.equipment || '').split(',')[0].trim();
        const equipmentStr = equipmentRaw.toLowerCase() === 'none' ? '' : equipmentRaw;
        const isNumericOnly = /^\d+$/.test(repsStr);
        const hasReps = repsStr && repsStr !== '0';
        if (!hasReps && !equipmentStr) return null;

        return (
          <div className={`absolute ${isCompactMode ? 'top-3 right-3' : 'top-5 right-5'} z-20`}>
            <div className={`
              flex flex-col items-center
              bg-black/75 backdrop-blur-md
              rounded-2xl overflow-hidden
              shadow-[0_4px_24px_rgba(0,0,0,0.35)]
              ${isCompactMode ? 'w-[96px]' : 'w-[130px]'}
            `}>
              {/* Reps block */}
              {hasReps && (
                <div className={`flex flex-col items-center justify-center w-full ${isCompactMode ? 'px-3 pt-2.5 pb-2' : 'px-4 pt-4 pb-3'}`}>
                  {isNumericOnly ? (
                    <>
                      <span className={`font-black text-white leading-none ${isCompactMode ? 'text-2xl' : 'text-4xl'}`}>
                        {repsStr}
                      </span>
                      <span className={`text-white/50 font-semibold uppercase tracking-widest mt-0.5 ${isCompactMode ? 'text-[9px]' : 'text-[10px]'}`}>
                        REPS
                      </span>
                    </>
                  ) : (
                    <span className={`font-bold text-white text-center leading-tight uppercase tracking-wide break-words w-full ${isCompactMode ? 'text-xs' : 'text-sm'}`}>
                      {repsStr}
                    </span>
                  )}
                </div>
              )}

              {/* Divider + Equipment */}
              {hasReps && equipmentStr && (
                <div className="w-full h-px bg-white/10" />
              )}
              {equipmentStr && (
                <div className={`flex items-center justify-center w-full ${isCompactMode ? 'px-2 py-1.5' : 'px-3 py-2'}`}>
                  <span className={`text-white/60 font-medium uppercase tracking-widest text-center break-words w-full ${isCompactMode ? 'text-[9px]' : 'text-[10px]'}`}>
                    {equipmentStr}
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })()}
      
      {/* Loading/Error placeholder */}
      {!thumbnailMode && (!videoLoaded && !videoError) && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900 text-white">
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-white mx-auto mb-4"></div>
            <h3 className="text-2xl font-bold mb-4">{assignment.video.title}</h3>
            <p className="text-gray-400 text-lg">Loading video...</p>
          </div>
        </div>
      )}
      
      {!thumbnailMode && videoError && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900 text-white">
          <div className="text-center">
            <Play className="h-16 w-16 mx-auto mb-4 opacity-50" />
            <h3 className="text-2xl font-bold mb-4">{assignment.video.title}</h3>
            <p className="text-red-400 text-lg">Video failed to load. Other videos will continue.</p>
            <button
              type="button"
              onClick={handleManualReload}
              className="mt-4 px-4 py-2 rounded-md bg-white text-black font-medium hover:bg-gray-200"
            >
              Reload video
            </button>
          </div>
        </div>
      )}

      {/* Tap-to-play fallback when autoplay is blocked (TV boxes, iOS without interaction) */}
      {!thumbnailMode && autoplayBlocked && !videoError && (
        <button
          type="button"
          onClick={handleTapToPlay}
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/40"
        >
          <div className="bg-white/90 rounded-full p-4">
            <Play className="h-12 w-12 text-black" />
          </div>
        </button>
      )}

      {/* On-screen media event log — opt-in via ?debug=1 (Mi Box has no devtools).
          Shows the live event trace + recovery-ladder state right on the TV. */}
      {!thumbnailMode && debugMedia && (
        <div className="absolute bottom-1 left-1 z-40 max-w-[48%] pointer-events-none rounded bg-black/75 p-1 font-mono text-[10px] leading-tight text-green-300">
          <div className="text-white">
            #{assignment.video.id} gen{mediaGeneration} att{loadAttempt}{" "}
            {videoError ? "ERROR" : videoLoaded ? "ok" : "loading"}
          </div>
          {mediaLog.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}
