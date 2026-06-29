/**
 * server/migration-route.ts
 *
 * Registers two HTTP endpoints inside the running Express server:
 *
 *   POST /api/migrate/start   { secret, dryRun? }  — start / resume migration
 *   GET  /api/migrate/status  ?secret=…            — poll live progress
 *
 * Authentication uses objectStorageClient from ./objectStorage, which
 * authenticates via Replit's internal sidecar at http://127.0.0.1:1106.
 * That sidecar is only reachable from within the running server process —
 * which is why a standalone `node` script cannot connect to Object Storage.
 *
 * ── Replit Secrets required ───────────────────────────────────────────────────
 *   NEW_DATABASE_URL      – new app Neon connection string
 *   R2_ACCOUNT_ID         – Cloudflare account ID
 *   R2_ACCESS_KEY_ID      – R2 API token Access Key ID
 *   R2_SECRET_ACCESS_KEY  – R2 API token Secret Access Key
 *   R2_BUCKET_NAME        – R2 bucket name
 *   R2_PUBLIC_URL         – R2 public bucket URL (e.g. https://pub-xxx.r2.dev)
 *   MIGRATION_SECRET      – any random string, e.g. "migrate-abc123"
 *                           (protects the endpoint from unauthorised calls)
 *
 * ── Usage (from Replit Shell) ─────────────────────────────────────────────────
 *   # Dry run — lists what would be uploaded, no writes at all:
 *   curl -X POST http://localhost:5000/api/migrate/start \
 *     -H "Content-Type: application/json" \
 *     -d '{"secret":"YOUR_MIGRATION_SECRET","dryRun":true}'
 *
 *   # Poll progress (run in a second terminal while migration is running):
 *   curl "http://localhost:5000/api/migrate/status?secret=YOUR_MIGRATION_SECRET"
 *
 *   # Live run:
 *   curl -X POST http://localhost:5000/api/migrate/start \
 *     -H "Content-Type: application/json" \
 *     -d '{"secret":"YOUR_MIGRATION_SECRET","dryRun":false}'
 *
 * ── Safety ────────────────────────────────────────────────────────────────────
 *   - The old Replit database (DATABASE_URL) is NEVER modified.
 *   - Only NEW_DATABASE_URL is updated with new Blob URLs.
 *   - Already-migrated videos are detected and skipped — safe to re-run.
 *   - Each video is fully processed (download → upload → verify → DB write)
 *     before the next begins. Failures are logged and skipped; the loop
 *     never aborts early.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { Express, Request, Response } from "express";
import { neon } from "@neondatabase/serverless";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { objectStorageClient } from "./objectStorage";

// ── R2 upload helper ─────────────────────────────────────────────────────────

let _r2Client: S3Client | null = null;

function getR2Client(): S3Client {
  if (!_r2Client) {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    if (!accountId || !accessKeyId || !secretAccessKey) {
      throw new Error("R2 credentials are not set (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY).");
    }
    _r2Client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return _r2Client;
}

async function uploadToR2(key: string, body: Buffer, contentType: string): Promise<string> {
  const bucket = process.env.R2_BUCKET_NAME;
  const publicUrl = process.env.R2_PUBLIC_URL?.replace(/\/$/, "");
  if (!bucket) throw new Error("R2_BUCKET_NAME is not set.");
  if (!publicUrl) throw new Error("R2_PUBLIC_URL is not set.");
  await getR2Client().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
  return `${publicUrl}/${key}`;
}

// ── Progress state (in-memory; resets on server restart) ─────────────────────

interface VideoRow {
  id: number;
  title: string;
  url: string;
  thumbnail_url: string | null;
}

interface MigrationError {
  id: number;
  type: string;
  message: string;
}

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
  errors: MigrationError[];
  log: string[]; // rolling last-100 lines
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

function addLog(line: string): void {
  console.log(`[migration] ${line}`);
  state.log.push(line);
  if (state.log.length > 100) state.log.shift();
}

// ── Path helpers ──────────────────────────────────────────────────────────────

/**
 * Convert a DB path like /public-objects/uploads/123.mp4
 * to the GCS object name inside the bucket: public/uploads/123.mp4
 *
 * routes.ts stores videos at  public/uploads/…
 * and thumbnails at           public/thumbnails/…
 * The DB records the serving path as /public-objects/uploads/…
 */
function dbPathToGcsName(dbPath: string): string | null {
  if (!dbPath || !dbPath.startsWith("/public-objects/")) return null;
  // /public-objects/uploads/123.mp4  →  public/uploads/123.mp4
  return "public/" + dbPath.slice("/public-objects/".length);
}

function mimeType(filename: string): string {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  const map: Record<string, string> = {
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
    avi: "video/x-msvideo", mkv: "video/x-matroska",
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    gif: "image/gif", webp: "image/webp",
  };
  return map[ext] ?? "application/octet-stream";
}

// ── Core migration logic ──────────────────────────────────────────────────────

async function runMigration(dryRun: boolean): Promise<void> {
  const NEW_DB_URL = process.env.NEW_DATABASE_URL;
  const OLD_DB_URL = process.env.DATABASE_URL;
  const BUCKET_ID  = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;

  if (!NEW_DB_URL)  throw new Error("NEW_DATABASE_URL secret is not set");
  if (!OLD_DB_URL)  throw new Error("DATABASE_URL is not set");
  if (!BUCKET_ID)   throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID is not set");

  // Validate R2 env vars up front so we fail fast before touching any files
  const r2Vars = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME", "R2_PUBLIC_URL"];
  for (const v of r2Vars) {
    if (!process.env[v]) throw new Error(`${v} is not set in Replit Secrets.`);
  }

  // Use the same objectStorageClient the rest of the server uses — it is already
  // authenticated via the Replit sidecar at http://127.0.0.1:1106.
  const bucket = objectStorageClient.bucket(BUCKET_ID);

  const oldSql = neon(OLD_DB_URL);
  const newSql = neon(NEW_DB_URL);

  // ── Step A: Load all video records from the old DB (read-only) ─────────────
  addLog("Fetching video records from old database...");
  const videos = await oldSql`
    SELECT id, title, url, thumbnail_url FROM videos ORDER BY id
  ` as VideoRow[];
  state.total = videos.length;
  addLog(`Found ${state.total} videos to process.`);

  // ── Step B: List all objects in the bucket for fast existence checks ────────
  addLog("Listing Replit Object Storage contents...");
  const knownKeys = new Set<string>();
  try {
    const [files] = await bucket.getFiles({ prefix: "public/" });
    files.forEach((f) => knownKeys.add(f.name));
    addLog(`Object Storage contains ${knownKeys.size} objects under 'public/'.`);
  } catch (err: any) {
    addLog(`WARNING: Could not list bucket — will attempt downloads anyway: ${err.message}`);
  }

  // ── Step C: Process each video one at a time ───────────────────────────────
  //
  // For each video the steps are:
  //   1. Check new DB  — skip if URL already points to blob.vercel-storage
  //   2. Resolve path  — derive the GCS object name from the stored DB path
  //   3. Check exists  — confirm the key is present in the bucket listing
  //   4. Download      — fetch bytes from Object Storage
  //   5. Upload        — PUT to Vercel Blob
  //   6. Verify        — confirm the returned URL is a valid https:// address
  //   7. Thumbnail     — attempt thumbnail migration (non-fatal)
  //   8. Update new DB — write the Blob URL to NEW_DATABASE_URL only
  //
  // A failure at any step logs the error, increments state.failed, and
  // continues to the next video. The loop never aborts early.

  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    const prefix = `[${i + 1}/${state.total}]`;
    state.processed = i + 1;

    try {

      // 1. Check new DB ────────────────────────────────────────────────────────
      const [newRow] = await newSql`SELECT url FROM videos WHERE id = ${video.id}` as any[];
      const currentUrl = newRow?.url ?? "";
      const r2Domain = (process.env.R2_PUBLIC_URL ?? "").replace(/\/$/, "");
      const alreadyMigrated = r2Domain
        ? currentUrl.startsWith(r2Domain)
        : currentUrl.includes(".r2.dev/") || currentUrl.includes("r2.cloudflarestorage.com");
      if (alreadyMigrated) {
        addLog(`${prefix} SKIP  id=${video.id} — already on R2`);
        state.skipped++;
        continue;
      }

      // 2. Resolve GCS object name ─────────────────────────────────────────────
      const videoGcsName = dbPathToGcsName(video.url);
      if (!videoGcsName) {
        addLog(`${prefix} SKIP  id=${video.id} — not an Object Storage path: ${video.url}`);
        state.skipped++;
        continue;
      }

      // 3. Confirm the file exists ─────────────────────────────────────────────
      if (knownKeys.size > 0 && !knownKeys.has(videoGcsName)) {
        addLog(`${prefix} MISS  id=${video.id} — not found in bucket: ${videoGcsName}`);
        state.missing++;
        state.errors.push({ id: video.id, type: "missing", message: videoGcsName });
        continue;
      }

      const filename = videoGcsName.split("/").pop()!;

      // Dry run stops here — nothing is written ────────────────────────────────
      if (dryRun) {
        addLog(`${prefix} DRY   id=${video.id} — would upload: ${videoGcsName}`);
        state.succeeded++;
        continue;
      }

      // 4. Download from Replit Object Storage ─────────────────────────────────
      let videoBuffer: Buffer;
      try {
        const [contents] = await bucket.file(videoGcsName).download();
        videoBuffer = contents as Buffer;
      } catch (err: any) {
        addLog(`${prefix} FAIL  id=${video.id} — download error: ${err.message}`);
        state.failed++;
        state.errors.push({ id: video.id, type: "download_failed", message: err.message });
        continue;
      }

      // 5. Upload to Cloudflare R2 ─────────────────────────────────────────────
      let newVideoUrl: string;
      try {
        const url = await uploadToR2(`videos/${filename}`, videoBuffer, mimeType(filename));

        // 6. Verify upload returned a valid URL ──────────────────────────────────
        if (!url.startsWith("https://")) {
          throw new Error(`R2 upload returned invalid URL: "${url}"`);
        }
        newVideoUrl = url;
        addLog(
          `${prefix} OK    id=${video.id} ${filename}` +
          ` (${(videoBuffer.length / 1024 / 1024).toFixed(1)} MB)`
        );
      } catch (err: any) {
        addLog(`${prefix} FAIL  id=${video.id} — upload/verify error: ${err.message}`);
        state.failed++;
        state.errors.push({ id: video.id, type: "upload_failed", message: err.message });
        continue;
      }

      // 7. Migrate thumbnail (non-fatal — never blocks the video) ──────────────
      let newThumbUrl = video.thumbnail_url ?? null;
      const thumbGcsName = video.thumbnail_url ? dbPathToGcsName(video.thumbnail_url) : null;
      if (thumbGcsName) {
        try {
          const [thumbContents] = await bucket.file(thumbGcsName).download();
          const thumbFilename = thumbGcsName.split("/").pop()!;
          const thumbUrl = await uploadToR2(`thumbnails/${thumbFilename}`, thumbContents as Buffer, mimeType(thumbFilename));
          if (thumbUrl.startsWith("https://")) newThumbUrl = thumbUrl;
        } catch (err: any) {
          addLog(`${prefix} THUMB_FAIL id=${video.id} — ${err.message} (video will still be updated)`);
          // non-fatal: keep old thumbnail URL, continue to DB update
        }
      }

      // 8. Update ONLY the new database ────────────────────────────────────────
      // The old Replit database (DATABASE_URL) is NEVER modified.
      // It remains your rollback point throughout the migration.
      try {
        await newSql`
          UPDATE videos
          SET url = ${newVideoUrl}, thumbnail_url = ${newThumbUrl}
          WHERE id = ${video.id}
        `;
        state.succeeded++;
        state.dbUpdated++;
      } catch (err: any) {
        // Blob upload succeeded but DB write failed — count as failed so the
        // video will be retried on the next run (old URL still in new DB).
        addLog(`${prefix} DB_FAIL id=${video.id} — ${err.message}`);
        state.failed++;
        state.errors.push({ id: video.id, type: "db_update_failed", message: err.message });
      }

    } catch (err: any) {
      // Catch-all for unexpected errors — always continue to the next video
      addLog(`${prefix} ERROR id=${video.id} — unexpected: ${err.message}`);
      state.failed++;
      state.errors.push({ id: video.id, type: "unexpected", message: err.message });
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  addLog("────────────────────────────────────────────────────────────");
  addLog(`Migration ${dryRun ? "DRY RUN " : ""}complete`);
  addLog(`Total    : ${state.total}`);
  addLog(`Skipped  : ${state.skipped}  (already on Blob or not an Object Storage path)`);
  addLog(`Succeeded: ${state.succeeded}`);
  addLog(`Missing  : ${state.missing}  (key not found in bucket)`);
  addLog(`Failed   : ${state.failed}`);
  addLog(`DB updated: ${state.dbUpdated}`);
  addLog(`Old DB (DATABASE_URL): untouched — rollback point preserved`);
  if (state.errors.length > 0) {
    addLog(`Errors (${state.errors.length}):`);
    state.errors.forEach((e) => addLog(`  id=${e.id} [${e.type}] ${e.message}`));
  }
  addLog("────────────────────────────────────────────────────────────");
}

// ── Route registration ────────────────────────────────────────────────────────

export function registerMigrationRoutes(app: Express): void {
  const MIGRATION_SECRET = process.env.MIGRATION_SECRET;

  function checkSecret(req: Request, res: Response): boolean {
    const provided = (req.body as any)?.secret ?? req.query?.secret;
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

  // GET /api/migrate/status — poll current progress
  app.get("/api/migrate/status", (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    res.json(state);
  });

  // POST /api/migrate/start — start or resume the migration
  app.post("/api/migrate/start", (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;

    if (state.status === "running") {
      res.json({ message: "Migration already running", state });
      return;
    }

    const dryRun = (req.body as any)?.dryRun === true;

    // Reset all counters
    Object.assign(state, {
      status: "running",
      dryRun,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      total: 0, processed: 0, skipped: 0, succeeded: 0,
      failed: 0, missing: 0, dbUpdated: 0,
      errors: [], log: [],
    });

    addLog(`Starting migration${dryRun ? " (DRY RUN — no files will be uploaded)" : ""}...`);
    res.json({ message: `Migration started${dryRun ? " (dry run)" : ""}`, state });

    // Run asynchronously so the HTTP response is returned immediately.
    // Poll GET /api/migrate/status to follow progress.
    runMigration(dryRun)
      .then(() => {
        state.status = "done";
        state.finishedAt = new Date().toISOString();
      })
      .catch((err: Error) => {
        state.status = "failed";
        state.finishedAt = new Date().toISOString();
        addLog(`Fatal error: ${err.message}`);
      });
  });

  console.log("[migration] Registered: POST /api/migrate/start  GET /api/migrate/status");
}
