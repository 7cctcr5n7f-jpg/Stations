/**
 * migration-route.ts
 *
 * Drop this file into your Replit project's server/ directory, then register
 * the route in server/routes.ts. It adds two endpoints:
 *
 *   GET  /api/migrate/status   — see progress without starting anything
 *   POST /api/migrate/start    — start (or resume) the migration
 *
 * The route reuses objectStorageClient from server/objectStorage.ts, which
 * authenticates via Replit's sidecar at http://127.0.0.1:1106 — the same
 * auth path the rest of the application uses. This is why a standalone node
 * script cannot connect: the sidecar is only reachable from within the
 * running server process.
 *
 * ── Setup ────────────────────────────────────────────────────────────────────
 * 1. Copy this file to server/migration-route.ts in your Replit project.
 *
 * 2. Add two Replit Secrets:
 *      NEW_DATABASE_URL      – your new Neon connection string
 *      BLOB_READ_WRITE_TOKEN – Vercel Blob token (Vercel → Settings → Env Vars)
 *      MIGRATION_SECRET      – any random string, e.g. "migrate-abc123"
 *                              (protects the endpoint from unauthorised calls)
 *
 * 3. In server/routes.ts, add near the top of registerRoutes():
 *      import { registerMigrationRoutes } from './migration-route';
 *      registerMigrationRoutes(app);
 *
 * 4. Start / restart the Replit server, then from the Replit Shell run:
 *
 *      # Dry run — no uploads, no DB writes:
 *      curl -X POST http://localhost:5000/api/migrate/start \
 *        -H "Content-Type: application/json" \
 *        -d '{"secret":"YOUR_MIGRATION_SECRET","dryRun":true}'
 *
 *      # Live run:
 *      curl -X POST http://localhost:5000/api/migrate/start \
 *        -H "Content-Type: application/json" \
 *        -d '{"secret":"YOUR_MIGRATION_SECRET","dryRun":false}'
 *
 *      # Check progress while running:
 *      curl http://localhost:5000/api/migrate/status?secret=YOUR_MIGRATION_SECRET
 *
 * ── Safety ────────────────────────────────────────────────────────────────────
 * - The old Replit database is NEVER modified — it remains your rollback point.
 * - Only the new Neon database (NEW_DATABASE_URL) is updated.
 * - Already-migrated files are detected and skipped — safe to re-run.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { Express } from "express";
import { neon } from "@neondatabase/serverless";
import { put } from "@vercel/blob";

// ── Live progress state (in-memory, reset on server restart) ─────────────────

interface MigrationState {
  status: "idle" | "running" | "done" | "failed";
  dryRun: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  total: number;
  processed: number;
  skipped: number;
  succeeded: number;
  failed: number;
  missing: number;
  dbUpdated: number;
  errors: Array<{ id: number; type: string; message: string }>;
  log: string[]; // last 100 lines
}

const state: MigrationState = {
  status: "idle",
  dryRun: false,
  startedAt: null,
  finishedAt: null,
  total: 0,
  processed: 0,
  skipped: 0,
  succeeded: 0,
  failed: 0,
  missing: 0,
  dbUpdated: 0,
  errors: [],
  log: [],
};

function addLog(line: string) {
  console.log(`[migration] ${line}`);
  state.log.push(line);
  if (state.log.length > 100) state.log.shift();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert a /public-objects/... DB path to a GCS object name within the bucket. */
function urlToGcsName(url: string, publicPrefix: string): string | null {
  // DB stores paths like /public-objects/uploads/123.mp4
  // GCS stores them at:  public/uploads/123.mp4  (under the public/ prefix)
  if (!url || !url.startsWith("/public-objects/")) return null;
  const filePath = url.slice("/public-objects/".length); // e.g. uploads/123.mp4
  return `${publicPrefix}/${filePath}`; // e.g. public/uploads/123.mp4
}

function mimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
    avi: "video/x-msvideo", mkv: "video/x-matroska",
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    gif: "image/gif", webp: "image/webp",
  };
  return map[ext] ?? "application/octet-stream";
}

/** Parse the bucket name out of PRIVATE_OBJECT_DIR (format: /bucket-name/path). */
function parseBucketFromPrivateDir(privateDir: string): string {
  // e.g. /replit-objstore-abc123/private  →  replit-objstore-abc123
  return privateDir.replace(/^\//, "").split("/")[0];
}

/** The public prefix inside the bucket where videos are stored. */
function publicPrefix(privateDir: string): string {
  // Replit stores public objects at <bucket>/public/...
  // privateDir is the private path, but public objects go under <bucket>/public
  const bucket = parseBucketFromPrivateDir(privateDir);
  return "public"; // objects are stored as public/uploads/... and public/thumbnails/...
}

// ── Core migration logic ──────────────────────────────────────────────────────

async function runMigration(dryRun: boolean) {
  const NEW_DB_URL = process.env.NEW_DATABASE_URL;
  const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
  const OLD_DB_URL = process.env.DATABASE_URL;
  const PRIVATE_DIR = process.env.PRIVATE_OBJECT_DIR;
  const BUCKET_ID = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;

  if (!NEW_DB_URL) throw new Error("NEW_DATABASE_URL secret is not set");
  if (!BLOB_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN secret is not set");
  if (!OLD_DB_URL) throw new Error("DATABASE_URL is not set");
  if (!PRIVATE_DIR) throw new Error("PRIVATE_OBJECT_DIR is not set");
  if (!BUCKET_ID) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID is not set");

  // Import objectStorageClient from the existing module — this is the key:
  // it authenticates via the sidecar at http://127.0.0.1:1106, which only
  // works inside the running server process.
  const { objectStorageClient } = await import("./objectStorage");
  const bucket = objectStorageClient.bucket(BUCKET_ID);
  const pubPrefix = publicPrefix(PRIVATE_DIR);

  const oldSql = neon(OLD_DB_URL);
  const newSql = neon(NEW_DB_URL);

  // 1. Fetch all videos from the old DB (read-only)
  addLog(`Fetching video records from old database...`);
  const videos = await oldSql`SELECT id, title, url, thumbnail_url FROM videos ORDER BY id`;
  state.total = videos.length;
  addLog(`Found ${state.total} videos to process.`);

  // 2. List all GCS objects for fast existence checks
  addLog(`Listing Object Storage contents...`);
  const knownKeys = new Set<string>();
  try {
    const [files] = await bucket.getFiles({ prefix: pubPrefix });
    files.forEach((f) => knownKeys.add(f.name));
    addLog(`Object Storage contains ${knownKeys.size} objects under '${pubPrefix}/'.`);
  } catch (err: any) {
    addLog(`WARNING: Could not list bucket (will attempt downloads anyway): ${err.message}`);
  }

  // 3. Process each video with concurrency = 3
  const CONCURRENCY = 3;
  let idx = 0;

  async function worker() {
    while (idx < videos.length) {
      const video = videos[idx++];
      const prefix = `[${state.processed + 1}/${state.total}]`;
      state.processed++;

      try {
        // Check if already migrated in new DB
        const [newRow] = await newSql`SELECT url FROM videos WHERE id = ${video.id}`;
        if (newRow?.url?.includes("blob.vercel-storage")) {
          addLog(`${prefix} SKIP  id=${video.id} — already on Blob`);
          state.skipped++;
          continue;
        }

        // Resolve GCS object name
        const videoGcsName = urlToGcsName(video.url, pubPrefix);
        if (!videoGcsName) {
          addLog(`${prefix} SKIP  id=${video.id} — not an Object Storage path: ${video.url}`);
          state.skipped++;
          continue;
        }

        // Check existence
        if (knownKeys.size > 0 && !knownKeys.has(videoGcsName)) {
          addLog(`${prefix} MISS  id=${video.id} — not in bucket: ${videoGcsName}`);
          state.missing++;
          state.errors.push({ id: video.id, type: "missing", message: videoGcsName });
          continue;
        }

        const filename = videoGcsName.split("/").pop()!;

        if (dryRun) {
          addLog(`${prefix} DRY   id=${video.id} would upload: ${videoGcsName}`);
          state.succeeded++;
          continue;
        }

        // Download from GCS via objectStorageClient
        let videoBuffer: Buffer;
        try {
          const [contents] = await bucket.file(videoGcsName).download();
          videoBuffer = contents;
        } catch (err: any) {
          addLog(`${prefix} FAIL  id=${video.id} download error: ${err.message}`);
          state.failed++;
          state.errors.push({ id: video.id, type: "download_failed", message: err.message });
          continue;
        }

        // Upload to Vercel Blob
        let newVideoUrl: string;
        try {
          const blob = await put(`videos/${filename}`, videoBuffer, {
            access: "public",
            contentType: mimeType(filename),
            token: BLOB_TOKEN,
          });
          newVideoUrl = blob.url;
          state.succeeded++;
          addLog(`${prefix} OK    id=${video.id} ${filename} (${(videoBuffer.length / 1024 / 1024).toFixed(1)} MB)`);
        } catch (err: any) {
          addLog(`${prefix} FAIL  id=${video.id} blob upload error: ${err.message}`);
          state.failed++;
          state.errors.push({ id: video.id, type: "upload_failed", message: err.message });
          continue;
        }

        // Migrate thumbnail (non-fatal)
        let newThumbUrl = video.thumbnail_url;
        const thumbGcsName = urlToGcsName(video.thumbnail_url, pubPrefix);
        if (thumbGcsName) {
          try {
            const [thumbContents] = await bucket.file(thumbGcsName).download();
            const thumbFilename = thumbGcsName.split("/").pop()!;
            const thumbBlob = await put(`thumbnails/${thumbFilename}`, thumbContents, {
              access: "public",
              contentType: mimeType(thumbFilename),
              token: BLOB_TOKEN,
            });
            newThumbUrl = thumbBlob.url;
          } catch (err: any) {
            addLog(`${prefix} THUMB_FAIL id=${video.id}: ${err.message}`);
            // non-fatal — keep old thumbnail URL
          }
        }

        // Update ONLY the new database — old DB is never touched
        try {
          await newSql`
            UPDATE videos
            SET url = ${newVideoUrl}, thumbnail_url = ${newThumbUrl}
            WHERE id = ${video.id}
          `;
          state.dbUpdated++;
        } catch (err: any) {
          addLog(`${prefix} DB_FAIL id=${video.id}: ${err.message}`);
          state.errors.push({ id: video.id, type: "db_update_failed", message: err.message });
        }
      } catch (err: any) {
        addLog(`${prefix} ERROR id=${video.id}: ${err.message}`);
        state.failed++;
        state.errors.push({ id: video.id, type: "unexpected", message: err.message });
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  addLog(`--- Migration ${dryRun ? "DRY RUN " : ""}complete ---`);
  addLog(`Total: ${state.total} | Skipped: ${state.skipped} | OK: ${state.succeeded} | Missing: ${state.missing} | Failed: ${state.failed} | DB updated: ${state.dbUpdated}`);
}

// ── Route registration ────────────────────────────────────────────────────────

export function registerMigrationRoutes(app: Express) {
  const MIGRATION_SECRET = process.env.MIGRATION_SECRET;

  function checkSecret(req: any, res: any): boolean {
    const provided = req.body?.secret ?? req.query?.secret;
    if (!MIGRATION_SECRET) {
      res.status(500).json({ error: "MIGRATION_SECRET is not set on the server" });
      return false;
    }
    if (provided !== MIGRATION_SECRET) {
      res.status(403).json({ error: "Invalid migration secret" });
      return false;
    }
    return true;
  }

  // GET /api/migrate/status — check progress
  app.get("/api/migrate/status", (req, res) => {
    if (!checkSecret(req, res)) return;
    res.json(state);
  });

  // POST /api/migrate/start — kick off (or resume) migration
  app.post("/api/migrate/start", async (req, res) => {
    if (!checkSecret(req, res)) return;

    if (state.status === "running") {
      return res.json({ message: "Migration already running", state });
    }

    const dryRun = req.body?.dryRun === true;

    // Reset counters
    Object.assign(state, {
      status: "running",
      dryRun,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      total: 0, processed: 0, skipped: 0, succeeded: 0,
      failed: 0, missing: 0, dbUpdated: 0,
      errors: [], log: [],
    });

    addLog(`Starting migration${dryRun ? " (DRY RUN)" : ""}...`);
    res.json({ message: `Migration started${dryRun ? " (dry run)" : ""}`, state });

    // Run async — don't block the HTTP response
    runMigration(dryRun)
      .then(() => {
        state.status = "done";
        state.finishedAt = new Date().toISOString();
        addLog("Migration finished successfully.");
      })
      .catch((err) => {
        state.status = "failed";
        state.finishedAt = new Date().toISOString();
        addLog(`Migration failed: ${err.message}`);
      });
  });

  console.log("[migration] Routes registered: GET/POST /api/migrate/status|start");
}
