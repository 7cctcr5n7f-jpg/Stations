/**
 * server/migration.ts
 *
 * Migration endpoint that runs INSIDE the Replit Express server.
 * Uses the existing AppStorageService (which holds an already-authenticated
 * @replit/object-storage Client) to read every video from Object Storage,
 * uploads it to Vercel Blob, then updates ONLY the new Neon database.
 *
 * The old Replit database is never modified — it stays as your rollback point.
 *
 * Endpoints:
 *   GET  /api/migration/status  — returns current migration state (poll this)
 *   POST /api/migration/start   — starts or resumes the migration
 *   POST /api/migration/reset   — clears state so migration can be re-run
 *
 * Required environment variables (add to Replit Secrets):
 *   NEW_DATABASE_URL      — new Neon connection string
 *   BLOB_READ_WRITE_TOKEN — Vercel Blob token
 */

import type { Express } from "express";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { AppStorageService } from "./appStorage";

neonConfig.webSocketConstructor = ws;

// ── MIME helper ──────────────────────────────────────────────────────────────

function mimeType(filename: string): string {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  const map: Record<string, string> = {
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

// ── Migration state (held in memory) ────────────────────────────────────────

export type MigrationStatus =
  | "idle"
  | "running"
  | "complete"
  | "error";

export interface MigrationError {
  id: number;
  title: string;
  type: string;
  message: string;
}

export interface MigrationState {
  status: MigrationStatus;
  dryRun: boolean;
  total: number;
  processed: number;
  succeeded: number;
  skipped: number;
  missing: number;
  failed: number;
  dbUpdated: number;
  logs: string[];   // last 200 log lines
  errors: MigrationError[];
  startedAt: string | null;
  completedAt: string | null;
}

let state: MigrationState = {
  status: "idle",
  dryRun: false,
  total: 0,
  processed: 0,
  succeeded: 0,
  skipped: 0,
  missing: 0,
  failed: 0,
  dbUpdated: 0,
  logs: [],
  errors: [],
  startedAt: null,
  completedAt: null,
};

function resetState(dryRun: boolean) {
  state = {
    status: "running",
    dryRun,
    total: 0,
    processed: 0,
    succeeded: 0,
    skipped: 0,
    missing: 0,
    failed: 0,
    dbUpdated: 0,
    logs: [],
    errors: [],
    startedAt: new Date().toISOString(),
    completedAt: null,
  };
}

function addLog(msg: string) {
  const ts = new Date().toISOString().substring(11, 19); // HH:MM:SS
  const line = `[${ts}] ${msg}`;
  console.log(line);
  state.logs.push(line);
  if (state.logs.length > 200) state.logs.shift();
}

// ── URL → Object Storage key ─────────────────────────────────────────────────
// DB stores paths like  /public-objects/uploads/1234.mp4
// AppStorageService key is                uploads/1234.mp4

function urlToKey(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("/public-objects/")) return url.slice("/public-objects/".length);
  // Also handle keys stored without the /public-objects/ prefix
  if (url.startsWith("uploads/") || url.startsWith("thumbnails/")) return url;
  return null;
}

// ── Core migration logic ─────────────────────────────────────────────────────

async function runMigration(dryRun: boolean) {
  resetState(dryRun);

  const NEW_DB_URL = process.env.NEW_DATABASE_URL;
  const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

  if (!NEW_DB_URL) {
    state.status = "error";
    addLog("ERROR: NEW_DATABASE_URL is not set in Replit Secrets.");
    return;
  }
  if (!BLOB_TOKEN) {
    state.status = "error";
    addLog("ERROR: BLOB_READ_WRITE_TOKEN is not set in Replit Secrets.");
    return;
  }

  if (dryRun) {
    addLog("DRY RUN — no files will be uploaded and no database rows will be changed.");
  }

  // Set up new DB connection
  const newPool = new Pool({ connectionString: NEW_DB_URL });

  // Reuse the application's existing storage service — this is the authenticated client
  const appStorage = new AppStorageService();

  try {
    // ── 1. Fetch all videos from the OLD (Replit) database ──────────────────
    addLog("Fetching video records from Replit database...");
    const oldPool = new Pool({ connectionString: process.env.DATABASE_URL! });
    const { rows: videos } = await oldPool.query<{
      id: number;
      title: string;
      url: string;
      thumbnail_url: string | null;
    }>("SELECT id, title, url, thumbnail_url FROM videos ORDER BY id");
    await oldPool.end();

    state.total = videos.length;
    addLog(`Found ${videos.length} videos to process.`);

    // ── 2. Confirm Object Storage is reachable ──────────────────────────────
    addLog("Checking Object Storage connection...");
    const isAvailable = await appStorage.isAvailable();
    if (!isAvailable) {
      state.status = "error";
      addLog("ERROR: Object Storage is not available from this server process.");
      return;
    }
    addLog("Object Storage connection confirmed.");

    // ── 3. Process each video sequentially ─────────────────────────────────
    addLog(`Starting sequential migration of ${videos.length} videos...`);

    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];
      const prefix = `[${i + 1}/${state.total}] id=${video.id}`;
      state.processed = i + 1;

      try {
        // Step 1 — check if already migrated in the NEW database
        const { rows: newRows } = await newPool.query<{ url: string }>(
          "SELECT url FROM videos WHERE id = $1",
          [video.id]
        );
        const newUrl = newRows[0]?.url ?? "";
        if (newUrl.includes("blob.vercel-storage")) {
          addLog(`${prefix} SKIP  — already on Vercel Blob`);
          state.skipped++;
          continue;
        }

        // Step 2 — resolve the Object Storage key from the DB URL
        const videoKey = urlToKey(video.url);
        if (!videoKey) {
          addLog(`${prefix} SKIP  — not an Object Storage path: ${video.url}`);
          state.skipped++;
          continue;
        }

        const filename = videoKey.split("/").pop()!;

        if (dryRun) {
          addLog(`${prefix} DRY   — would upload: ${videoKey}`);
          state.succeeded++;
          continue;
        }

        // Step 3 — download from Object Storage using the app's existing service
        let videoBuffer: Buffer;
        try {
          videoBuffer = await new Promise<Buffer>((resolve, reject) => {
            const chunks: Buffer[] = [];
            const stream = (appStorage as any).client.downloadAsStream(videoKey);
            stream.on("data", (chunk: Buffer) => chunks.push(chunk));
            stream.on("end", () => resolve(Buffer.concat(chunks)));
            stream.on("error", reject);
          });
        } catch (err: any) {
          // Try alternate key variants (some uploads may have /objects/ prefix)
          addLog(`${prefix} FAIL  — download error: ${err.message}`);
          state.failed++;
          state.errors.push({ id: video.id, title: video.title, type: "download_failed", message: err.message });
          continue;
        }

        // Step 4 — upload to Vercel Blob
        let newVideoUrl: string;
        try {
          const { put } = await import("@vercel/blob");
          const blob = await put(`videos/${filename}`, videoBuffer, {
            access: "public",
            contentType: mimeType(filename),
            token: BLOB_TOKEN,
          });

          // Step 5 — verify the upload returned a valid URL
          if (!blob?.url?.startsWith("https://")) {
            throw new Error(`Upload returned invalid URL: ${blob?.url}`);
          }
          newVideoUrl = blob.url;
          addLog(`${prefix} OK    — ${filename} (${(videoBuffer.length / 1024 / 1024).toFixed(1)} MB)`);
        } catch (err: any) {
          addLog(`${prefix} FAIL  — upload error: ${err.message}`);
          state.failed++;
          state.errors.push({ id: video.id, title: video.title, type: "upload_failed", message: err.message });
          continue;
        }

        // Step 6 — migrate thumbnail (non-fatal)
        let newThumbUrl = video.thumbnail_url;
        const thumbKey = urlToKey(video.thumbnail_url);
        if (thumbKey) {
          try {
            const thumbBuffer = await new Promise<Buffer>((resolve, reject) => {
              const chunks: Buffer[] = [];
              const stream = (appStorage as any).client.downloadAsStream(thumbKey);
              stream.on("data", (chunk: Buffer) => chunks.push(chunk));
              stream.on("end", () => resolve(Buffer.concat(chunks)));
              stream.on("error", reject);
            });
            const thumbFilename = thumbKey.split("/").pop()!;
            const { put } = await import("@vercel/blob");
            const thumbBlob = await put(`thumbnails/${thumbFilename}`, thumbBuffer, {
              access: "public",
              contentType: mimeType(thumbFilename),
              token: BLOB_TOKEN,
            });
            if (thumbBlob?.url?.startsWith("https://")) {
              newThumbUrl = thumbBlob.url;
            }
          } catch (err: any) {
            addLog(`${prefix} THUMB_FAIL — ${err.message} (continuing)`);
            // non-fatal — keep old thumbnail URL
          }
        }

        // Step 7 — update ONLY the new Neon database
        // The old Replit database is NEVER modified.
        try {
          await newPool.query(
            "UPDATE videos SET url = $1, thumbnail_url = $2 WHERE id = $3",
            [newVideoUrl, newThumbUrl, video.id]
          );
          state.succeeded++;
          state.dbUpdated++;
        } catch (err: any) {
          // Successful upload but DB write failed — counts as failed so it will retry
          addLog(`${prefix} DB_FAIL — ${err.message}`);
          state.failed++;
          state.errors.push({ id: video.id, title: video.title, type: "db_update_failed", message: err.message });
        }

      } catch (err: any) {
        // Outer catch — unexpected error on this video; log and continue
        addLog(`${prefix} ERROR — unexpected: ${err.message}`);
        state.failed++;
        state.errors.push({ id: video.id, title: video.title, type: "unexpected", message: err.message });
      }
    }

    // ── 4. Final summary ────────────────────────────────────────────────────
    state.status = "complete";
    state.completedAt = new Date().toISOString();
    addLog("─".repeat(50));
    addLog("MIGRATION COMPLETE");
    if (dryRun) addLog("(DRY RUN — no changes were made)");
    addLog(`  Total:     ${state.total}`);
    addLog(`  Succeeded: ${state.succeeded}`);
    addLog(`  Skipped:   ${state.skipped}`);
    addLog(`  Missing:   ${state.missing}`);
    addLog(`  Failed:    ${state.failed}`);
    addLog(`  DB updated:${state.dbUpdated}`);
    addLog(`  Old DB:    untouched (rollback point)`);
    addLog("─".repeat(50));

  } catch (err: any) {
    state.status = "error";
    addLog(`FATAL ERROR: ${err.message}`);
  } finally {
    await newPool.end();
  }
}

// ── Route registration ───────────────────────────────────────────────────────

export function registerMigrationRoutes(app: Express) {
  // GET /api/migration/status — poll this for live progress
  app.get("/api/migration/status", (_req, res) => {
    res.json(state);
  });

  // POST /api/migration/start — start or resume the migration
  app.post("/api/migration/start", (req, res) => {
    if (state.status === "running") {
      return res.status(409).json({ error: "Migration is already running." });
    }
    const dryRun = req.body?.dryRun === true;
    // Run async, don't await — client polls for status
    runMigration(dryRun).catch((err) => {
      state.status = "error";
      addLog(`UNHANDLED ERROR: ${err.message}`);
    });
    res.json({ started: true, dryRun });
  });

  // POST /api/migration/reset — clear state to allow a fresh run
  app.post("/api/migration/reset", (_req, res) => {
    if (state.status === "running") {
      return res.status(409).json({ error: "Cannot reset while migration is running." });
    }
    state = {
      status: "idle",
      dryRun: false,
      total: 0, processed: 0, succeeded: 0, skipped: 0,
      missing: 0, failed: 0, dbUpdated: 0,
      logs: [],
      errors: [],
      startedAt: null,
      completedAt: null,
    };
    res.json({ reset: true });
  });
}
