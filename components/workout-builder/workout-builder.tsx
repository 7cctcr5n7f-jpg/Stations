"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import ImageThumbnail from "@/components/image-thumbnail";
import { ExercisePicker } from "./exercise-picker";
import {
  Loader2, Sparkles, Lock, Unlock, RefreshCw, Replace, Upload,
  CheckCircle2, AlertTriangle, Save, GitCompare,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Video } from "@/lib/shared/schema";

type HeartRate = "green" | "orange" | "red";

interface GeneratedRound {
  roomId: number;
  roomNumber: number;
  roomName: string;
  videoId: number | null;
  video: Video | null;
  heartRate: HeartRate | null;
  reps: number | null;
  locked: boolean;
  score: number;
  reasons: string[];
  warnings: string[];
}

interface WorkoutDraft {
  date: string;
  weekday: number;
  label: string | null;
  rounds: GeneratedRound[];
  score: number;
  summary: string[];
  warnings: string[];
}

const HR_STYLE: Record<HeartRate, { label: string; dot: string; text: string }> = {
  green: { label: "Low", dot: "bg-green-500", text: "text-green-700" },
  orange: { label: "Medium", dot: "bg-orange-500", text: "text-orange-700" },
  red: { label: "High", dot: "bg-red-500", text: "text-red-700" },
};

function scoreColor(score: number): string {
  if (score >= 90) return "text-green-600";
  if (score >= 75) return "text-blue-600";
  if (score >= 60) return "text-orange-500";
  return "text-red-600";
}

export function WorkoutBuilder() {
  const { toast } = useToast();
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [draft, setDraft] = useState<WorkoutDraft | null>(null);
  const [comparison, setComparison] = useState<WorkoutDraft | null>(null);
  const [pickerRoomId, setPickerRoomId] = useState<number | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [polishing, setPolishing] = useState(false);

  const generate = useMutation({
    mutationFn: async (lockedRounds: GeneratedRound[]) => {
      const res = await apiRequest("POST", "/api/workout-builder/generate", { date, lockedRounds });
      return (await res.json()) as WorkoutDraft;
    },
    onSuccess: (d) => {
      setDraft(d);
      polish(d);
    },
    onError: () => toast({ title: "Failed to generate workout", variant: "destructive" }),
  });

  const publish = useMutation({
    mutationFn: async () => {
      if (!draft) return;
      const res = await apiRequest("POST", "/api/workout-builder/publish", { date, rounds: draft.rounds });
      return res.json();
    },
    onSuccess: (r: any) => {
      toast({ title: "Published to schedule", description: `${r?.count ?? 0} rounds scheduled for ${date}` });
      setConfirmPublish(false);
    },
    onError: () => toast({ title: "Failed to publish", variant: "destructive" }),
  });

  const saveDraft = useMutation({
    mutationFn: async () => {
      if (!draft) return;
      const res = await apiRequest("POST", "/api/workout-builder/drafts", {
        date, label: draft.label, rounds: draft.rounds, score: draft.score,
      });
      return res.json();
    },
    onSuccess: () => toast({ title: "Draft saved" }),
  });

  // Optional AI polish — never blocks the rule-engine result.
  async function polish(d: WorkoutDraft) {
    setPolishing(true);
    try {
      const res = await apiRequest("POST", "/api/workout-builder/explain", { draft: d });
      const polished = (await res.json()) as WorkoutDraft;
      setDraft((cur) => (cur && cur.date === polished.date ? polished : cur));
    } catch {
      // silent — keep rule-engine text
    } finally {
      setPolishing(false);
    }
  }

  function handleGenerate() {
    const locked = draft?.rounds.filter((r) => r.locked) ?? [];
    generate.mutate(locked);
  }

  function toggleLock(roomId: number) {
    setDraft((d) => d ? { ...d, rounds: d.rounds.map((r) => r.roomId === roomId ? { ...r, locked: !r.locked } : r) } : d);
  }

  function replaceExercise(roomId: number, video: Video) {
    setDraft((d) => d ? {
      ...d,
      rounds: d.rounds.map((r) => r.roomId === roomId ? {
        ...r, videoId: video.id, video,
        heartRate: video.intensity === "High" ? "red" : video.intensity === "Medium" ? "orange" : "green",
        reasons: ["Manually selected by trainer"], warnings: [],
      } : r),
    } : d);
  }

  function moveToCompare() {
    setComparison(draft);
    toast({ title: "Saved current workout for comparison", description: "Generate or edit another, then compare." });
  }

  const belowMin = draft && draft.score < 90;

  return (
    <div className="space-y-6">
      {/* Controls */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Workout date</label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
          </div>
          <Button onClick={handleGenerate} disabled={generate.isPending} className="bg-blue-600 hover:bg-blue-700">
            {generate.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            Generate Workout
          </Button>
          {draft && (
            <>
              <Button variant="outline" onClick={moveToCompare}>
                <GitCompare className="mr-2 h-4 w-4" /> Set as comparison
              </Button>
              <Button variant="outline" onClick={() => saveDraft.mutate()} disabled={saveDraft.isPending}>
                <Save className="mr-2 h-4 w-4" /> Save draft
              </Button>
              <Button onClick={() => setConfirmPublish(true)} className="bg-green-600 hover:bg-green-700 ml-auto">
                <Upload className="mr-2 h-4 w-4" /> Publish to Schedule
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {!draft && !generate.isPending && (
        <div className="rounded-lg border-2 border-dashed border-gray-200 py-20 text-center text-gray-500">
          <Sparkles className="mx-auto mb-3 h-8 w-8 text-gray-300" />
          <p>Pick a date and generate a workout to get started.</p>
        </div>
      )}

      {draft && (
        <>
          {/* Score card */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">
                    {draft.label ?? "Workout"} · {new Date(date + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
                  </CardTitle>
                  {polishing && <p className="mt-1 flex items-center text-xs text-gray-400"><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Polishing explanations...</p>}
                </div>
                <div className="text-right">
                  <div className={`text-4xl font-bold ${scoreColor(draft.score)}`}>{draft.score}</div>
                  <p className="text-xs text-gray-500">workout score</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {belowMin && (
                <div className="flex items-center gap-2 rounded-md bg-orange-50 px-3 py-2 text-sm text-orange-800">
                  <AlertTriangle className="h-4 w-4" /> Below your minimum score target. Consider regenerating or replacing low-scoring rounds.
                </div>
              )}
              {draft.summary.length > 0 && (
                <ul className="space-y-1 text-sm text-gray-600">
                  {draft.summary.map((s, i) => <li key={i} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />{s}</li>)}
                </ul>
              )}
              {draft.warnings.length > 0 && (
                <ul className="space-y-1 text-sm text-orange-700">
                  {draft.warnings.map((w, i) => <li key={i} className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{w}</li>)}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Round cards */}
          <div className="grid gap-3">
            {draft.rounds.map((r) => (
              <Card key={r.roomId} className={r.locked ? "ring-2 ring-blue-400" : ""}>
                <CardContent className="flex items-start gap-4 py-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm font-bold text-gray-700">
                    {r.roomNumber}
                  </div>
                  {r.video ? (
                    <ImageThumbnail video={r.video} size="medium" showPlayButton={false} />
                  ) : (
                    <div className="flex h-12 w-16 items-center justify-center rounded bg-gray-100 text-xs text-gray-400">empty</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium text-gray-900">{r.video?.title ?? "No exercise"}</p>
                      {r.heartRate && (
                        <span className={`inline-flex items-center gap-1 text-xs ${HR_STYLE[r.heartRate].text}`}>
                          <span className={`h-2 w-2 rounded-full ${HR_STYLE[r.heartRate].dot}`} />
                          {HR_STYLE[r.heartRate].label}
                        </span>
                      )}
                      <span className={`ml-auto text-sm font-semibold ${scoreColor(r.score)}`}>{r.score}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500">{r.roomName} · {r.video?.bodyPart} · {r.video?.equipment}</p>
                    {r.reasons.length > 0 && (
                      <p className="mt-1 text-xs text-gray-600">{r.reasons[0]}</p>
                    )}
                    {r.warnings.map((w, i) => <p key={i} className="mt-1 text-xs text-orange-600">{w}</p>)}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <Button variant="ghost" size="icon" title={r.locked ? "Unlock" : "Lock"} onClick={() => toggleLock(r.roomId)}>
                      {r.locked ? <Lock className="h-4 w-4 text-blue-600" /> : <Unlock className="h-4 w-4 text-gray-400" />}
                    </Button>
                    <Button variant="ghost" size="icon" title="Replace" onClick={() => setPickerRoomId(r.roomId)}>
                      <Replace className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Comparison panel */}
          {comparison && (
            <Card className="border-dashed">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <GitCompare className="h-4 w-4" /> Comparison
                  <span className="ml-auto flex items-center gap-4 text-sm font-normal">
                    <span>Saved: <b className={scoreColor(comparison.score)}>{comparison.score}</b></span>
                    <span>Current: <b className={scoreColor(draft.score)}>{draft.score}</b></span>
                    <span className={draft.score >= comparison.score ? "text-green-600" : "text-red-600"}>
                      {draft.score >= comparison.score ? "Current is better or equal" : "Saved is better"}
                    </span>
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-1 text-sm text-gray-600 sm:grid-cols-2">
                <div>
                  <p className="mb-1 font-medium text-gray-700">Saved workout</p>
                  {comparison.rounds.filter((r) => r.video).map((r) => (
                    <p key={r.roomId} className="truncate">{r.roomNumber}. {r.video?.title} <span className={scoreColor(r.score)}>({r.score})</span></p>
                  ))}
                </div>
                <div>
                  <p className="mb-1 font-medium text-gray-700">Current workout</p>
                  {draft.rounds.filter((r) => r.video).map((r) => (
                    <p key={r.roomId} className="truncate">{r.roomNumber}. {r.video?.title} <span className={scoreColor(r.score)}>({r.score})</span></p>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <ExercisePicker
        open={pickerRoomId !== null}
        onOpenChange={(o) => !o && setPickerRoomId(null)}
        onSelect={(v) => { if (pickerRoomId !== null) replaceExercise(pickerRoomId, v); }}
      />

      <AlertDialog open={confirmPublish} onOpenChange={setConfirmPublish}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish to schedule?</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace any existing schedule for {date} with these {draft?.rounds.filter((r) => r.videoId).length ?? 0} rounds. Live displays will update immediately.
              {belowMin && " This workout is below your minimum score target."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => publish.mutate()} disabled={publish.isPending}>
              {publish.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Publish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
