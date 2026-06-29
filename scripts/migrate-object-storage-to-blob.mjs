/**
 * migrate-object-storage-to-blob.mjs
 *
 * Run this script INSIDE your Replit project where Object Storage is already
 * authenticated. It will:
 *   1. List every file in Replit Object Storage (videos + thumbnails)
 *   2. Upload each one to Vercel Blob
 *   3. Update ONLY the new app Neon database to point at the new Blob URLs
 *      — the old Replit database is never touched so it remains a clean rollback
 *   4. Skip files that already have a Blob URL in the new database (safe to re-run)
 *   5. Print a full migration report
 *
 * ── Prerequisites (install in Replit) ────────────────────────────────────────
 *   npm install @replit/object-storage @vercel/blob @neondatabase/serverless
 *
 * ── Environment variables required in Replit Secrets ─────────────────────────
 *   NEW_DATABASE_URL      → the new app Neon connection string
 *   BLOB_READ_WRITE_TOKEN → Vercel Blob token (copy from your Vercel project env vars)
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *   node scripts/migrate-object-storage-to-blob.mjs            # live run
 *   node scripts/migrate-object-storage-to-blob.mjs --dry-run  # preview only, no writes
 *
 *   Re-run safely at any time — already-migrated files are detected and skipped.
 *
 * ── Rollback ─────────────────────────────────────────────────────────────────
 *   The old Replit database is never modified. If something goes wrong, simply
 *   re-run the data migration script (migrate-data.mjs) from the new database
 *   to restore it from the old one.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Client } from "@replit/object-storage";
import { put } from "@vercel/blob";
import { neon } from "@neondatabase/serverless";

// ── Config ───────────────────────────────────────────────────────────────────

const OLD_DB_URL  = process.env.DATABASE_URL;        // Replit's existing Neon DB — READ ONLY
const NEW_DB_URL  = process.env.NEW_DATABASE_URL;    // New app Neon DB — the only one we write to
const BLOB_TOKEN  = process.env.BLOB_READ_WRITE_TOKEN;
const DRY_RUN     = process.argv.includes("--dry-run");

if (DRY_RUN) {
  console.log("DRY RUN mode — no files will be uploaded and no database rows will be updated.\n");
}

if (!OLD_DB_URL) {
  console.error("ERROR: DATABASE_URL is not set (the existing Replit Neon connection).");
  process.exit(1);
}
if (!NEW_DB_URL) {
  console.error("ERROR: NEW_DATABASE_URL is not set. Add it to Replit Secrets.");
  process.exit(1);
}
if (!BLOB_TOKEN) {
  console.error("ERROR: BLOB_READ_WRITE_TOKEN is not set. Add it to Replit Secrets.");
  process.exit(1);
}

// Concurrency limit — Replit Object Storage can be slow; keep this low to
// avoid hammering it and hitting rate limits.
const CONCURRENCY = 3;

// ── Helpers ───────────────────────────────────────────────────────────────────

const oldSql = neon(OLD_DB_URL);
const newSql = neon(NEW_DB_URL);
const storage = new Client();

/** Download a file from Replit Object Storage and return it as a Buffer. */
async function downloadFromObjectStorage(key) {
  const result = await storage.downloadAsBytes(key);
  if (!result.ok) {
    throw new Error(`Object Storage download failed for '${key}': ${result.error?.message ?? "unknown error"}`);
  }
  return Buffer.from(result.value);
}

/** Derive the Object Storage key from a URL stored in the DB.
 *  e.g. "/public-objects/uploads/123.mp4" → "uploads/123.mp4"
 *       "/public-objects/thumbnails/thumb.jpg" → "thumbnails/thumb.jpg"
 */
function urlToKey(url) {
  if (!url) return null;
  if (url.startsWith("/public-objects/")) return url.slice("/public-objects/".length);
  return null; // not an Object Storage URL
}

/** Guess the MIME type from a filename extension. */
function mimeType(filename) {
  const ext = filename.split(".").pop()?.toLowerCase();
  const map = {
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    avi: "video/x-msvideo",
    mkv: "video/x-matroska",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
  };
  return map[ext] ?? "application/octet-stream";
}

/** Upload a Buffer to Vercel Blob and return the public URL. */
async function uploadToBlob(buffer, blobPath, contentType) {
  const blob = await put(blobPath, buffer, {
    access: "public",
    contentType,
    token: BLOB_TOKEN,
  });
  return blob.url;
}

/** Run an array of async tasks with a concurrency cap. */
async function mapConcurrent(items, fn, limit) {
  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

// ── Report counters ───────────────────────────────────────────────────────────

const report = {
  totalVideos: 0,
  alreadyMigrated: 0,
  videoSuccess: 0,
  videoFailed: 0,
  videoMissing: 0,
  thumbnailSuccess: 0,
  thumbnailFailed: 0,
  thumbnailSkipped: 0,
  dbNewUpdated: 0,
  errors: [],
};

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log("  Replit Object Storage → Vercel Blob Migration");
  console.log("=".repeat(60));

  // 1. Fetch all video records from the old DB
  console.log("\nFetching video records from old database...");
  const videos = await oldSql`SELECT id, title, url, thumbnail_url FROM videos ORDER BY id`;
  report.totalVideos = videos.length;
  console.log(`  Found ${report.totalVideos} videos.`);

  // 2. List all keys in Replit Object Storage for reference
  console.log("\nListing Replit Object Storage contents...");
  let storageKeys = new Set();
  try {
    const listing = await storage.list();
    if (listing.ok) {
      storageKeys = new Set(listing.value.map((o) => o.key));
      console.log(`  Object Storage contains ${storageKeys.size} objects.`);
    } else {
      console.warn("  WARNING: Could not list Object Storage:", listing.error?.message);
      console.warn("  Will attempt downloads anyway.");
    }
  } catch (err) {
    console.warn("  WARNING: list() failed:", err.message);
    console.warn("  Will attempt downloads anyway.");
  }

  // 3. Process each video
  console.log(`\nMigrating ${report.totalVideos} videos (concurrency: ${CONCURRENCY})...`);

  const results = await mapConcurrent(videos, async (video, i) => {
    const prefix = `[${i + 1}/${report.totalVideos}]`;

    // ── Check if already migrated (Blob URL in either DB) ──────────────────
    const alreadyNew = await newSql`SELECT url, thumbnail_url FROM videos WHERE id = ${video.id}`;
    const newRow = alreadyNew[0];
    const videoAlreadyDone = newRow?.url?.startsWith("https://") && newRow.url.includes("blob.vercel-storage");

    if (videoAlreadyDone) {
      console.log(`${prefix} SKIP  id=${video.id} — already on Blob`);
      report.alreadyMigrated++;
      return { id: video.id, status: "skipped" };
    }

    // ── Migrate the video file ──────────────────────────────────────────────
    let newVideoUrl = video.url; // fallback: keep old value if migration fails
    const videoKey = urlToKey(video.url);

    if (!videoKey) {
      // URL is already an http(s) link or null — skip
      console.log(`${prefix} SKIP  id=${video.id} — URL is not an Object Storage path (${video.url})`);
      report.alreadyMigrated++;
      return { id: video.id, status: "skipped_external" };
    }

    if (storageKeys.size > 0 && !storageKeys.has(videoKey)) {
      console.warn(`${prefix} MISS  id=${video.id} — key not found in Object Storage: ${videoKey}`);
      report.videoMissing++;
      report.errors.push({ id: video.id, type: "missing", key: videoKey });
      return { id: video.id, status: "missing" };
    }

    const filename = videoKey.split("/").pop();

    if (DRY_RUN) {
      console.log(`${prefix} DRY   id=${video.id} would upload: ${videoKey}`);
      report.videoSuccess++;
      return { id: video.id, status: "dry_run" };
    }

    try {
      const buffer = await downloadFromObjectStorage(videoKey);
      newVideoUrl = await uploadToBlob(buffer, `videos/${filename}`, mimeType(filename));
      report.videoSuccess++;
      console.log(`${prefix} OK    id=${video.id} ${filename} (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);
    } catch (err) {
      console.error(`${prefix} FAIL  id=${video.id} — ${err.message}`);
      report.videoFailed++;
      report.errors.push({ id: video.id, type: "video_upload_failed", error: err.message });
      return { id: video.id, status: "failed" };
    }

    // ── Migrate the thumbnail ───────────────────────────────────────────────
    let newThumbUrl = video.thumbnail_url;
    const thumbKey = urlToKey(video.thumbnail_url);

    if (thumbKey) {
      try {
        const thumbFilename = thumbKey.split("/").pop();
        const thumbBuffer = await downloadFromObjectStorage(thumbKey);
        newThumbUrl = await uploadToBlob(thumbBuffer, `thumbnails/${thumbFilename}`, mimeType(thumbFilename));
        report.thumbnailSuccess++;
      } catch (err) {
        console.warn(`${prefix} THUMB_FAIL id=${video.id} — ${err.message}`);
        report.thumbnailFailed++;
        // Non-fatal — keep old thumbnail URL and continue
      }
    } else {
      report.thumbnailSkipped++;
    }

    // ── Update ONLY the new app database ───────────────────────────────────
    // The old Replit database is never modified — it is your rollback point.
    // If you need to re-run the data migration from scratch, the old DB is
    // untouched and still holds the original /public-objects/ URLs.
    try {
      await newSql`
        UPDATE videos
        SET url = ${newVideoUrl}, thumbnail_url = ${newThumbUrl}
        WHERE id = ${video.id}
      `;
      report.dbNewUpdated++;
    } catch (err) {
      console.warn(`${prefix} DB_FAIL id=${video.id} — ${err.message}`);
      report.errors.push({ id: video.id, type: "db_update_failed", error: err.message });
    }

    return { id: video.id, status: "ok", newVideoUrl };
  }, CONCURRENCY);

  // 4. Print final report
  console.log("\n" + "=".repeat(60));
  console.log("  MIGRATION REPORT");
  console.log("=".repeat(60));
  if (DRY_RUN) console.log("  *** DRY RUN — no files uploaded, no database rows changed ***");
  console.log(`  Total videos found:        ${report.totalVideos}`);
  console.log(`  Already migrated (skipped):${report.alreadyMigrated}`);
  console.log(`  Videos ${DRY_RUN ? "would migrate" : "migrated"} OK:        ${report.videoSuccess}`);
  console.log(`  Videos missing in storage: ${report.videoMissing}`);
  console.log(`  Videos failed:             ${report.videoFailed}`);
  console.log(`  Thumbnails ${DRY_RUN ? "would migrate" : "migrated"} OK:    ${report.thumbnailSuccess}`);
  console.log(`  Thumbnails failed:         ${report.thumbnailFailed}`);
  console.log(`  Thumbnails skipped:        ${report.thumbnailSkipped}`);
  console.log(`  New DB records updated:    ${DRY_RUN ? 0 : report.dbNewUpdated}`);
  console.log(`  Old DB (Replit):           untouched — use as rollback if needed`);

  if (report.errors.length > 0) {
    console.log(`\n  Errors (${report.errors.length}):`);
    report.errors.forEach((e) =>
      console.log(`    id=${e.id} [${e.type}]`, e.error ?? e.key ?? "")
    );
  }

  const totalDone = report.videoSuccess + report.alreadyMigrated;
  const totalFailed = report.videoFailed + report.videoMissing;
  console.log("\n" + "=".repeat(60));
  if (totalFailed === 0) {
    console.log("  SUCCESS — all videos are now on Vercel Blob.");
  } else {
    console.log(`  PARTIAL — ${totalDone} done, ${totalFailed} need attention.`);
    console.log("  Re-run this script to retry any failures.");
  }
  console.log("=".repeat(60) + "\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
