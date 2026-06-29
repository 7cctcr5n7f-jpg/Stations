import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Play, RotateCcw, Eye } from "lucide-react";

interface MigrationError {
  id: number;
  title: string;
  type: string;
  message: string;
}

interface MigrationState {
  status: "idle" | "running" | "complete" | "error";
  dryRun: boolean;
  total: number;
  processed: number;
  succeeded: number;
  skipped: number;
  missing: number;
  failed: number;
  dbUpdated: number;
  logs: string[];
  errors: MigrationError[];
  startedAt: string | null;
  completedAt: string | null;
}

export default function MigrationPage() {
  const [, setLocation] = useLocation();
  const [migrationState, setMigrationState] = useState<MigrationState | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const logBoxRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch status
  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/migration/status");
      if (res.ok) {
        const data: MigrationState = await res.json();
        setMigrationState(data);
        return data;
      }
    } catch (_) {}
    return null;
  };

  // Start polling when running
  useEffect(() => {
    fetchStatus();

    pollingRef.current = setInterval(async () => {
      const data = await fetchStatus();
      if (data && data.status !== "running") {
        if (pollingRef.current) clearInterval(pollingRef.current);
      }
    }, 1000);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  // Auto-scroll log to bottom
  useEffect(() => {
    if (logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }
  }, [migrationState?.logs]);

  const startMigration = async (dryRun: boolean) => {
    setIsStarting(true);
    try {
      const res = await fetch("/api/migration/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error ?? "Failed to start migration.");
        return;
      }
      // Restart polling
      if (pollingRef.current) clearInterval(pollingRef.current);
      pollingRef.current = setInterval(async () => {
        const data = await fetchStatus();
        if (data && data.status !== "running") {
          if (pollingRef.current) clearInterval(pollingRef.current);
        }
      }, 1000);
    } finally {
      setIsStarting(false);
    }
  };

  const resetMigration = async () => {
    await fetch("/api/migration/reset", { method: "POST" });
    await fetchStatus();
  };

  const isRunning = migrationState?.status === "running";
  const isComplete = migrationState?.status === "complete";
  const isIdle = !migrationState || migrationState.status === "idle";
  const hasError = migrationState?.status === "error";

  const pct =
    migrationState && migrationState.total > 0
      ? Math.round((migrationState.processed / migrationState.total) * 100)
      : 0;

  const statusColor = () => {
    if (isRunning) return "bg-blue-500";
    if (isComplete) return "bg-green-500";
    if (hasError) return "bg-red-500";
    return "bg-gray-400";
  };

  const statusLabel = () => {
    if (isRunning) return migrationState?.dryRun ? "Dry run in progress..." : "Migrating...";
    if (isComplete) return migrationState?.dryRun ? "Dry run complete" : "Migration complete";
    if (hasError) return "Error";
    return "Ready";
  };

  return (
    <div className="min-h-screen bg-black text-white p-4">
      <div className="max-w-4xl mx-auto space-y-4">

        {/* Header */}
        <div className="flex items-center gap-3 pb-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation("/admin")}
            className="text-gray-400 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Admin
          </Button>
          <h1 className="text-xl font-bold">Object Storage → Vercel Blob Migration</h1>
        </div>

        {/* Info banner */}
        <Card className="bg-gray-900 border-gray-700">
          <CardContent className="p-4 text-sm text-gray-300 space-y-1">
            <p>This tool migrates every video from Replit Object Storage to Vercel Blob.</p>
            <p>
              It updates <span className="text-white font-medium">only the new Neon database</span>.
              The Replit database is never modified and remains your rollback point.
            </p>
            <p>
              Safe to re-run — videos already on Vercel Blob are detected and skipped.
              If a video fails, it is logged and the migration continues.
            </p>
          </CardContent>
        </Card>

        {/* Controls */}
        <Card className="bg-gray-900 border-gray-700">
          <CardContent className="p-4 flex flex-wrap gap-3 items-center">
            <Button
              onClick={() => startMigration(true)}
              disabled={isRunning || isStarting}
              variant="outline"
              className="border-gray-600 text-gray-200 hover:bg-gray-700"
            >
              <Eye className="h-4 w-4 mr-2" />
              Dry Run (preview only)
            </Button>
            <Button
              onClick={() => startMigration(false)}
              disabled={isRunning || isStarting}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Play className="h-4 w-4 mr-2" />
              {isComplete ? "Re-run Migration" : "Start Migration"}
            </Button>
            {!isIdle && !isRunning && (
              <Button
                onClick={resetMigration}
                variant="ghost"
                size="sm"
                className="text-gray-500 hover:text-gray-300"
              >
                <RotateCcw className="h-4 w-4 mr-1" />
                Reset
              </Button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${statusColor()} ${isRunning ? "animate-pulse" : ""}`} />
              <span className="text-sm text-gray-300">{statusLabel()}</span>
            </div>
          </CardContent>
        </Card>

        {/* Progress bar */}
        {migrationState && migrationState.total > 0 && (
          <Card className="bg-gray-900 border-gray-700">
            <CardContent className="p-4 space-y-3">
              <div className="flex justify-between text-sm text-gray-400 mb-1">
                <span>{migrationState.processed} / {migrationState.total} processed</span>
                <span>{pct}%</span>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-3">
                <div
                  className="bg-blue-500 h-3 rounded-full transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-1">
                {[
                  { label: "Succeeded", value: migrationState.succeeded, color: "text-green-400" },
                  { label: "Skipped", value: migrationState.skipped, color: "text-gray-400" },
                  { label: "Missing", value: migrationState.missing, color: "text-yellow-400" },
                  { label: "Failed", value: migrationState.failed, color: "text-red-400" },
                  { label: "DB Updated", value: migrationState.dbUpdated, color: "text-blue-400" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="bg-gray-800 rounded p-3 text-center">
                    <div className={`text-2xl font-bold ${color}`}>{value}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{label}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Log output */}
        {migrationState && migrationState.logs.length > 0 && (
          <Card className="bg-gray-900 border-gray-700">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm text-gray-400 font-normal">Live Log</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div
                ref={logBoxRef}
                className="bg-black rounded font-mono text-xs text-gray-300 p-3 h-64 overflow-y-auto space-y-0.5"
              >
                {migrationState.logs.map((line, i) => {
                  const isOk = line.includes(" OK ");
                  const isSkip = line.includes(" SKIP ") || line.includes(" DRY ");
                  const isFail = line.includes(" FAIL") || line.includes("ERROR");
                  const isSummary = line.startsWith("[") && (line.includes("COMPLETE") || line.includes("─"));
                  return (
                    <div
                      key={i}
                      className={
                        isFail ? "text-red-400" :
                        isOk ? "text-green-400" :
                        isSkip ? "text-gray-500" :
                        isSummary ? "text-blue-300 font-semibold" :
                        "text-gray-300"
                      }
                    >
                      {line}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Error table */}
        {migrationState && migrationState.errors.length > 0 && (
          <Card className="bg-gray-900 border-gray-700">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm text-gray-400 font-normal">
                Failed Videos ({migrationState.errors.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="space-y-2">
                {migrationState.errors.map((err) => (
                  <div key={`${err.id}-${err.type}`} className="bg-gray-800 rounded p-3 text-sm flex flex-wrap gap-x-4 gap-y-1">
                    <span className="text-gray-400">id={err.id}</span>
                    <span className="text-white truncate max-w-xs">{err.title}</span>
                    <Badge variant="outline" className="border-red-800 text-red-400 text-xs">{err.type}</Badge>
                    <span className="text-red-300 text-xs">{err.message}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

      </div>
    </div>
  );
}
