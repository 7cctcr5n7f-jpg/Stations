"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import ImageThumbnail from "@/components/image-thumbnail";
import { ExercisePicker } from "./exercise-picker";
import {
  Loader2,
  Sparkles,
  Lock,
  Unlock,
  Replace,
  Upload,
  CheckCircle2,
  AlertTriangle,
  Save,
  GitCompare,
  Plus,
  Trash2,
  Layers,
  Hand,
  ThumbsDown,
  ChevronDown,
  Dumbbell,
  Zap,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Video } from "@/lib/shared/schema";
import type {
  BuilderParams,
  DifficultyLevel,
  GenerationMode,
  WorkoutFocus,
} from "@/lib/workout-builder/types";

// ---------------------------------------------------------------------------
// Local types (mirrored from engine output shape)
// ---------------------------------------------------------------------------

type HeartRate = "green" | "orange" | "red";

interface RoundExercise {
  videoId: number;
  video: Video;
  heartRate: HeartRate | null;
  reps: number | null;
  score: number;
  reasons: string[];
  warnings: string[];
  isBoxing: boolean;
  gloveCompatible: boolean;
}

interface GeneratedRound {
  roomId: number;
  roomNumber: number;
  roomName: string;
  exercises: RoundExercise[];
  isBoxingRound: boolean;
  glovesOn: boolean;
  dropset: boolean;
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HR_STYLE: Record<HeartRate, { label: string; dot: string; text: string }> = {
  green:  { label: "Low",    dot: "bg-green-500",  text: "text-green-700"  },
  orange: { label: "Medium", dot: "bg-orange-500", text: "text-orange-700" },
  red:    { label: "High",   dot: "bg-red-500",    text: "text-red-700"    },
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEK_DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const WORKOUT_FOCUSES: WorkoutFocus[] = [
  "Balanced",
  "HIIT Focused",
  "Strength Focused",
  "Functional Fitness",
  "Boxing Focused",
  "Conditioning Focused",
  "Endurance Focused",
];

const DIFFICULTY_LEVELS: DifficultyLevel[] = ["Beginner", "Intermediate", "Advanced"];

// Returns the Monday of the week containing `date`
function getMondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function toIso(d: Date): string {
  return d.toISOString().split("T")[0];
}

function scoreColor(score: number): string {
  if (score >= 90) return "text-green-600";
  if (score >= 75) return "text-blue-600";
  if (score >= 60) return "text-orange-500";
  return "text-red-600";
}

// ---------------------------------------------------------------------------
// RejectTarget
// ---------------------------------------------------------------------------

interface RejectTarget {
  roomId: number;
  roomNumber: number;
  roomName: string;
  videoId: number;
  videoTitle: string;
  equipmentList: string[];
}

// ---------------------------------------------------------------------------
// ProgrammeDashboard
// ---------------------------------------------------------------------------

function ProgrammeDashboard({ days }: { days: WorkoutDraft[] }) {
  const allRounds = days.flatMap((d) => d.rounds);
  const allExercises = allRounds.flatMap((r) => r.exercises);

  // Overall score = average of day scores
  const overallScore = days.length
    ? Math.round(days.reduce((s, d) => s + d.score, 0) / days.length)
    : 0;

  // Category distribution
  const catCounts: Record<string, number> = {};
  for (const ex of allExercises) {
    const cat = ex.video.category || ex.video.bodyPart || "Other";
    catCounts[cat] = (catCounts[cat] ?? 0) + 1;
  }
  const topCats = Object.entries(catCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);

  // Equipment usage
  const eqCounts: Record<string, number> = {};
  for (const ex of allExercises) {
    const parts = (ex.video.equipment ?? "").split(",").map((e) => e.trim()).filter(Boolean);
    for (const p of parts) eqCounts[p] = (eqCounts[p] ?? 0) + 1;
  }
  const topEquip = Object.entries(eqCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);

  // HR distribution
  const hrCounts = { green: 0, orange: 0, red: 0 } as Record<HeartRate, number>;
  for (const ex of allExercises) {
    if (ex.heartRate) hrCounts[ex.heartRate]++;
  }
  const total = allExercises.length || 1;

  // Daily scores for bar graph
  const maxScore = Math.max(...days.map((d) => d.score), 1);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Programme Dashboard</CardTitle>
            <CardDescription>{days.length} day{days.length !== 1 ? "s" : ""} · {allExercises.length} exercises total</CardDescription>
          </div>
          <div className="text-right">
            <div className={cn("text-3xl font-bold", scoreColor(overallScore))}>{overallScore}</div>
            <p className="text-xs text-muted-foreground">overall score</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Daily intensity bar graph */}
        {days.length > 1 && (
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Daily Scores</p>
            <div className="flex items-end gap-1.5 h-14">
              {days.map((d, i) => {
                const height = Math.max(4, Math.round((d.score / maxScore) * 100));
                const wd = new Date(d.date + "T12:00:00").getDay();
                return (
                  <div key={d.date} className="flex flex-col items-center gap-1 flex-1">
                    <span className={cn("text-xs font-semibold", scoreColor(d.score))}>{d.score}</span>
                    <div
                      className={cn("w-full rounded-sm", d.score >= 90 ? "bg-green-500" : d.score >= 75 ? "bg-blue-400" : d.score >= 60 ? "bg-orange-400" : "bg-red-400")}
                      style={{ height: `${height}%` }}
                    />
                    <span className="text-xs text-muted-foreground">{WEEKDAY_LABELS[wd]}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {/* Heart rate distribution */}
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Intensity Mix</p>
            <div className="space-y-1.5">
              {(["green", "orange", "red"] as HeartRate[]).map((hr) => {
                const pct = Math.round((hrCounts[hr] / total) * 100);
                return (
                  <div key={hr} className="flex items-center gap-2">
                    <span className={cn("h-2 w-2 rounded-full shrink-0", HR_STYLE[hr].dot)} />
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className={cn("h-full rounded-full", hr === "green" ? "bg-green-500" : hr === "orange" ? "bg-orange-500" : "bg-red-500")} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground w-8 text-right">{hrCounts[hr]}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Category distribution */}
          {topCats.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Categories</p>
              <div className="space-y-1">
                {topCats.map(([cat, count]) => (
                  <div key={cat} className="flex items-center justify-between text-xs">
                    <span className="truncate text-foreground/80">{cat}</span>
                    <Badge variant="secondary" className="ml-1 shrink-0 text-xs h-4 px-1.5">{count}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Equipment usage */}
          {topEquip.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Equipment</p>
              <div className="space-y-1">
                {topEquip.map(([eq, count]) => (
                  <div key={eq} className="flex items-center justify-between text-xs">
                    <span className="truncate text-foreground/80">{eq}</span>
                    <Badge variant="secondary" className="ml-1 shrink-0 text-xs h-4 px-1.5">{count}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main WorkoutBuilder component
// ---------------------------------------------------------------------------

export function WorkoutBuilder() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ---- Builder params state ----
  const monday = toIso(getMondayOf(new Date()));
  const [params, setParams] = useState<BuilderParams>({
    mode: "week",
    startDate: monday,
    focus: "Balanced",
    hiitStrengthRatio: 60,
    boxingVolume: 50,
    functionalTraining: 50,
    difficulty: "Intermediate",
    includeWeeklyChallenge: true,
    minScore: 80,
  });

  function patchParams(patch: Partial<BuilderParams>) {
    setParams((p) => ({ ...p, ...patch }));
  }

  // ---- Draft state: week = array of drafts, single = one draft ----
  const [weekDrafts, setWeekDrafts] = useState<WorkoutDraft[]>([]);
  const [activeDayIdx, setActiveDayIdx] = useState(0);
  const activeDraft = weekDrafts[activeDayIdx] ?? null;

  const [comparison, setComparison] = useState<WorkoutDraft | null>(null);
  const [pickerTarget, setPickerTarget] = useState<{ roomId: number; index: number } | null>(null);
  const [confirmPublish, setConfirmPublish] = useState<"week" | "selected" | "day" | null>(null);
  const [selectedPublishDays, setSelectedPublishDays] = useState<Set<number>>(new Set());
  const [polishingIdx, setPolishingIdx] = useState<number | null>(null);
  const [rejectTarget, setRejectTarget] = useState<RejectTarget | null>(null);

  const isWeekMode = params.mode === "week";
  const hasDrafts = weekDrafts.length > 0;

  // ---- mutations ----

  const generate = useMutation({
    mutationFn: async () => {
      const lockedRounds = isWeekMode ? [] : (weekDrafts[0]?.rounds.filter((r) => r.locked) ?? []);
      const res = await apiRequest("POST", "/api/workout-builder/generate", { params, lockedRounds });
      return await res.json() as { mode: string; day?: WorkoutDraft; days?: WorkoutDraft[] };
    },
    onSuccess: async (result) => {
      if (result.mode === "week" && result.days) {
        setWeekDrafts(result.days);
        setActiveDayIdx(0);
        // Polish each day sequentially in background
        for (let i = 0; i < result.days.length; i++) {
          setPolishingIdx(i);
          try {
            const res = await apiRequest("POST", "/api/workout-builder/explain", { draft: result.days[i] });
            const polished = await res.json() as WorkoutDraft;
            setWeekDrafts((prev) => {
              const next = [...prev];
              if (next[i]?.date === polished.date) next[i] = polished;
              return next;
            });
          } catch { /* silent */ }
        }
        setPolishingIdx(null);
      } else if (result.mode === "single" && result.day) {
        setWeekDrafts([result.day]);
        setActiveDayIdx(0);
        setPolishingIdx(0);
        try {
          const res = await apiRequest("POST", "/api/workout-builder/explain", { draft: result.day });
          const polished = await res.json() as WorkoutDraft;
          setWeekDrafts([polished]);
        } catch { /* silent */ }
        setPolishingIdx(null);
      }
    },
    onError: () => toast({ title: "Failed to generate", variant: "destructive" }),
  });

  const publish = useMutation({
    mutationFn: async (mode: "week" | "selected" | "day") => {
      if (mode === "day" && activeDraft) {
        const res = await apiRequest("POST", "/api/workout-builder/publish", {
          date: activeDraft.date,
          rounds: activeDraft.rounds,
        });
        return res.json();
      }
      if (mode === "week") {
        const res = await apiRequest("POST", "/api/workout-builder/publish", {
          days: weekDrafts.map((d) => ({ date: d.date, rounds: d.rounds })),
        });
        return res.json();
      }
      if (mode === "selected") {
        const days = weekDrafts.filter((_, i) => selectedPublishDays.has(i));
        const res = await apiRequest("POST", "/api/workout-builder/publish", {
          days: days.map((d) => ({ date: d.date, rounds: d.rounds })),
        });
        return res.json();
      }
    },
    onSuccess: (r: any) => {
      toast({
        title: "Published",
        description: r?.days
          ? `${r.days} day${r.days !== 1 ? "s" : ""} published (${r.count} rounds)`
          : `${r?.count ?? 0} rounds published`,
      });
      setConfirmPublish(null);
    },
    onError: () => toast({ title: "Failed to publish", variant: "destructive" }),
  });

  const saveDraft = useMutation({
    mutationFn: async () => {
      if (!activeDraft) return;
      const res = await apiRequest("POST", "/api/workout-builder/drafts", {
        date: activeDraft.date,
        label: activeDraft.label,
        rounds: activeDraft.rounds,
        score: activeDraft.score,
      });
      return res.json();
    },
    onSuccess: () => toast({ title: "Draft saved" }),
  });

  // ---- helpers ----

  function updateActiveDraft(updater: (d: WorkoutDraft) => WorkoutDraft) {
    setWeekDrafts((prev) => {
      const next = [...prev];
      if (next[activeDayIdx]) next[activeDayIdx] = updater(next[activeDayIdx]);
      return next;
    });
  }

  function makeManualExercise(video: Video): RoundExercise {
    return {
      videoId: video.id,
      video,
      heartRate:
        video.intensity === "High" ? "red" :
        video.intensity === "Medium" ? "orange" : "green",
      reps: null,
      score: 100,
      reasons: ["Manually selected by trainer"],
      warnings: [],
      isBoxing: false,
      gloveCompatible: true,
    };
  }

  function toggleLock(roomId: number) {
    updateActiveDraft((d) => ({
      ...d,
      rounds: d.rounds.map((r) => r.roomId === roomId ? { ...r, locked: !r.locked } : r),
    }));
  }

  function replaceExercise(roomId: number, index: number, video: Video) {
    updateActiveDraft((d) => ({
      ...d,
      rounds: d.rounds.map((r) => {
        if (r.roomId !== roomId) return r;
        const exercises = [...r.exercises];
        const ex = makeManualExercise(video);
        if (index < exercises.length) exercises[index] = ex;
        else exercises.push(ex);
        return { ...r, exercises, score: Math.round(exercises.reduce((s, e) => s + e.score, 0) / exercises.length) };
      }),
    }));
    setPickerTarget(null);
  }

  function removeExercise(roomId: number, index: number) {
    updateActiveDraft((d) => ({
      ...d,
      rounds: d.rounds.map((r) => {
        if (r.roomId !== roomId || r.exercises.length <= 1) return r;
        const exercises = r.exercises.filter((_, i) => i !== index);
        return { ...r, exercises, score: Math.round(exercises.reduce((s, e) => s + e.score, 0) / exercises.length) };
      }),
    }));
  }

  function moveToCompare() {
    setComparison(activeDraft);
    toast({ title: "Saved current workout for comparison", description: "Generate or edit another, then compare." });
  }

  function openRejectExercise(round: GeneratedRound, ex: RoundExercise) {
    const equipmentList = (ex.video.equipment ?? "")
      .split(",").map((e) => e.trim()).filter(Boolean);
    setRejectTarget({ roomId: round.roomId, roomNumber: round.roomNumber, roomName: round.roomName, videoId: ex.videoId, videoTitle: ex.video.title, equipmentList });
  }

  // Derived stats for the active draft
  const belowMin = activeDraft !== null && activeDraft.score < params.minScore;
  const filledCount = activeDraft?.rounds.filter((r) => r.exercises.length > 0).length ?? 0;
  const exerciseCount = activeDraft?.rounds.reduce((s, r) => s + r.exercises.length, 0) ?? 0;

  // ---- render ----
  return (
    <div className="space-y-6">

      {/* ================================================================
          BUILDER CONTROLS CARD
      ================================================================ */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Generation Settings</CardTitle>
          <CardDescription>Choose what to generate. Equipment rules and round constraints come from Builder Config.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">

          {/* Row 1: Generation Mode + date */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Generation Mode</Label>
              <div className="flex flex-col gap-1.5">
                {(["week", "single"] as GenerationMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      patchParams({ mode, startDate: mode === "week" ? toIso(getMondayOf(new Date())) : new Date().toISOString().split("T")[0] });
                    }}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md border px-3 py-2 text-sm text-left transition-colors",
                      params.mode === mode
                        ? "border-blue-500 bg-blue-50 text-blue-900"
                        : "border-border bg-background text-foreground hover:bg-muted/50"
                    )}
                  >
                    <span className={cn("h-3 w-3 rounded-full border-2 shrink-0", params.mode === mode ? "border-blue-500 bg-blue-500" : "border-muted-foreground")} />
                    {mode === "week" ? "Training Week (Mon–Sat)" : "Single Day"}
                    {mode === "week" && <Badge variant="secondary" className="ml-auto text-xs">Default</Badge>}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">
                {isWeekMode ? "Week starting (Monday)" : "Workout Date"}
              </Label>
              <Input
                type="date"
                value={params.startDate}
                onChange={(e) => patchParams({ startDate: e.target.value })}
                className="w-full"
              />
              {isWeekMode && params.startDate && (
                <p className="text-xs text-muted-foreground">
                  Mon–Sat: {params.startDate} through{" "}
                  {toIso(new Date(new Date(params.startDate + "T12:00:00").setDate(new Date(params.startDate + "T12:00:00").getDate() + 5)))}
                </p>
              )}
            </div>
          </div>

          {/* Row 2: Workout Focus + Difficulty */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Workout Focus</Label>
              <Select value={params.focus} onValueChange={(v) => patchParams({ focus: v as WorkoutFocus })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WORKOUT_FOCUSES.map((f) => (
                    <SelectItem key={f} value={f}>{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Difficulty</Label>
              <Select value={params.difficulty} onValueChange={(v) => patchParams({ difficulty: v as DifficultyLevel })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DIFFICULTY_LEVELS.map((d) => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Row 3: HIIT vs Strength Slider */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <Dumbbell className="h-4 w-4 text-muted-foreground" />
                Strength vs HIIT
              </Label>
              <span className="text-xs text-muted-foreground">
                {100 - params.hiitStrengthRatio}% Strength · {params.hiitStrengthRatio}% HIIT
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground w-14 text-right">Strength</span>
              <Slider
                value={[params.hiitStrengthRatio]}
                min={0} max={100} step={5}
                onValueChange={([v]) => patchParams({ hiitStrengthRatio: v })}
                className="flex-1"
              />
              <span className="text-xs text-muted-foreground w-8">HIIT</span>
            </div>
          </div>

          {/* Row 4: Boxing Volume + Functional Training sliders */}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium flex items-center gap-1.5">
                  <Zap className="h-4 w-4 text-muted-foreground" />
                  Boxing Volume
                </Label>
                <span className="text-xs text-muted-foreground">
                  {params.boxingVolume < 34 ? "Low" : params.boxingVolume < 67 ? "Medium" : "High"}
                </span>
              </div>
              <Slider
                value={[params.boxingVolume]}
                min={0} max={100} step={10}
                onValueChange={([v]) => patchParams({ boxingVolume: v })}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Low</span><span>High</span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium flex items-center gap-1.5">
                  <BarChart3 className="h-4 w-4 text-muted-foreground" />
                  Functional Training
                </Label>
                <span className="text-xs text-muted-foreground">
                  {params.functionalTraining < 34 ? "Low" : params.functionalTraining < 67 ? "Medium" : "High"}
                </span>
              </div>
              <Slider
                value={[params.functionalTraining]}
                min={0} max={100} step={10}
                onValueChange={([v]) => patchParams({ functionalTraining: v })}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Low</span><span>High</span>
              </div>
            </div>
          </div>

          {/* Row 5: Target Score + Weekly Challenge */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Target Score (minimum)</Label>
                <span className="text-sm font-semibold">{params.minScore}</span>
              </div>
              <Slider
                value={[params.minScore]}
                min={60} max={100} step={5}
                onValueChange={([v]) => patchParams({ minScore: v })}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>60</span><span>100</span>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <Switch
                id="weekly-challenge"
                checked={params.includeWeeklyChallenge}
                onCheckedChange={(v) => patchParams({ includeWeeklyChallenge: v })}
              />
              <Label htmlFor="weekly-challenge" className="text-sm font-medium cursor-pointer">
                Include Weekly Challenge
              </Label>
            </div>
          </div>

          {/* Generate + action buttons */}
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t">
            <Button
              onClick={() => generate.mutate()}
              disabled={generate.isPending}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {generate.isPending ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <Sparkles data-icon="inline-start" />
              )}
              {isWeekMode ? "Generate Training Week" : "Generate Workout"}
            </Button>

            {hasDrafts && (
              <>
                <Button variant="outline" onClick={moveToCompare}>
                  <GitCompare data-icon="inline-start" /> Set as comparison
                </Button>
                <Button variant="outline" onClick={() => saveDraft.mutate()} disabled={saveDraft.isPending}>
                  <Save data-icon="inline-start" /> Save draft
                </Button>

                {/* Publish dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button className="ml-auto bg-green-600 hover:bg-green-700">
                      <Upload data-icon="inline-start" />
                      Publish
                      <ChevronDown data-icon="inline-end" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {isWeekMode && weekDrafts.length > 1 && (
                      <>
                        <DropdownMenuItem onSelect={() => setConfirmPublish("week")}>
                          Publish Entire Week
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => {
                          setSelectedPublishDays(new Set(weekDrafts.map((_, i) => i)));
                          setConfirmPublish("selected");
                        }}>
                          Publish Selected Days...
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    )}
                    <DropdownMenuItem onSelect={() => setConfirmPublish("day")}>
                      Publish Current Day
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => saveDraft.mutate()}>
                      Save Draft
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ================================================================
          EMPTY STATE
      ================================================================ */}
      {!hasDrafts && !generate.isPending && (
        <div className="rounded-lg border-2 border-dashed border-border py-20 text-center text-muted-foreground">
          <Sparkles className="mx-auto mb-3 size-8 text-muted-foreground/50" />
          <p className="text-sm">Configure your settings above and generate a{isWeekMode ? " training week" : " workout"} to get started.</p>
        </div>
      )}

      {generate.isPending && (
        <div className="rounded-lg border border-border py-16 text-center text-muted-foreground">
          <Loader2 className="mx-auto mb-3 size-8 animate-spin text-blue-500" />
          <p className="text-sm">{isWeekMode ? "Generating 6-day training week..." : "Generating workout..."}</p>
        </div>
      )}

      {/* ================================================================
          PROGRAMME DASHBOARD + DAY TABS
      ================================================================ */}
      {hasDrafts && !generate.isPending && (
        <>
          {/* Programme dashboard (always shown) */}
          <ProgrammeDashboard days={weekDrafts} />

          {/* Day tabs */}
          {weekDrafts.length > 1 ? (
            <Tabs value={String(activeDayIdx)} onValueChange={(v) => setActiveDayIdx(Number(v))}>
              <TabsList className="w-full grid" style={{ gridTemplateColumns: `repeat(${weekDrafts.length}, 1fr)` }}>
                {weekDrafts.map((d, i) => {
                  const wd = new Date(d.date + "T12:00:00").getDay();
                  return (
                    <TabsTrigger key={d.date} value={String(i)} className="flex flex-col gap-0.5 py-2 h-auto">
                      <span className="text-xs font-medium">{WEEKDAY_LABELS[wd]}</span>
                      <span className={cn("text-xs font-bold", scoreColor(d.score))}>{d.score}</span>
                    </TabsTrigger>
                  );
                })}
              </TabsList>

              {weekDrafts.map((d, i) => (
                <TabsContent key={d.date} value={String(i)} className="mt-4 space-y-3">
                  <DayWorkout
                    draft={d}
                    isPolishing={polishingIdx === i}
                    minScore={params.minScore}
                    onToggleLock={toggleLock}
                    onReplace={(roomId, idx) => setPickerTarget({ roomId, index: idx })}
                    onRemove={removeExercise}
                    onAddSecond={(roomId, idx) => setPickerTarget({ roomId, index: idx })}
                    onRejectExercise={openRejectExercise}
                    comparison={comparison}
                  />
                </TabsContent>
              ))}
            </Tabs>
          ) : (
            /* Single day — no tabs */
            activeDraft && (
              <DayWorkout
                draft={activeDraft}
                isPolishing={polishingIdx === 0}
                minScore={params.minScore}
                onToggleLock={toggleLock}
                onReplace={(roomId, idx) => setPickerTarget({ roomId, index: idx })}
                onRemove={removeExercise}
                onAddSecond={(roomId, idx) => setPickerTarget({ roomId, index: idx })}
                onRejectExercise={openRejectExercise}
                comparison={comparison}
              />
            )
          )}
        </>
      )}

      {/* ================================================================
          DIALOGS
      ================================================================ */}

      {/* Exercise picker */}
      <ExercisePicker
        open={pickerTarget !== null}
        onOpenChange={(open) => { if (!open) setPickerTarget(null); }}
        onSelect={(video) => {
          if (pickerTarget !== null) replaceExercise(pickerTarget.roomId, pickerTarget.index, video);
        }}
      />

      {/* Publish confirm — single day */}
      <AlertDialog open={confirmPublish === "day"} onOpenChange={(o) => { if (!o) setConfirmPublish(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish current day?</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace any existing schedule for{" "}
              {activeDraft ? new Date(activeDraft.date + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }) : ""}{" "}
              with {filledCount} rounds ({exerciseCount} exercises).
              {belowMin && " This workout is below your minimum score target."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => publish.mutate("day")} disabled={publish.isPending}>
              {publish.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Publish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Publish confirm — entire week */}
      <AlertDialog open={confirmPublish === "week"} onOpenChange={(o) => { if (!o) setConfirmPublish(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish entire week?</AlertDialogTitle>
            <AlertDialogDescription>
              This will publish all {weekDrafts.length} days (Mon–Sat) to the schedule, replacing any existing entries for those dates.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => publish.mutate("week")} disabled={publish.isPending}>
              {publish.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Publish Week
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Publish confirm — selected days */}
      <AlertDialog open={confirmPublish === "selected"} onOpenChange={(o) => { if (!o) setConfirmPublish(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish selected days</AlertDialogTitle>
            <AlertDialogDescription>
              Choose which days to publish. Selected days will replace existing schedule entries.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-wrap gap-2 px-6 pb-2">
            {weekDrafts.map((d, i) => {
              const wd = new Date(d.date + "T12:00:00").getDay();
              const selected = selectedPublishDays.has(i);
              return (
                <button
                  key={d.date}
                  type="button"
                  onClick={() => {
                    const next = new Set(selectedPublishDays);
                    if (selected) next.delete(i); else next.add(i);
                    setSelectedPublishDays(next);
                  }}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                    selected ? "border-green-500 bg-green-50 text-green-800" : "border-border text-muted-foreground"
                  )}
                >
                  {WEEK_DAY_NAMES[i]} <span className={cn("ml-1 text-xs font-bold", scoreColor(d.score))}>{d.score}</span>
                </button>
              );
            })}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => publish.mutate("selected")}
              disabled={publish.isPending || selectedPublishDays.size === 0}
            >
              {publish.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Publish {selectedPublishDays.size} Day{selectedPublishDays.size !== 1 ? "s" : ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rejection feedback dialog */}
      {rejectTarget && (
        <RejectionDialog
          target={rejectTarget}
          onClose={() => setRejectTarget(null)}
          onSubmit={async (payload) => {
            await apiRequest("POST", "/api/workout-builder/reject", payload);
            queryClient.invalidateQueries({ queryKey: ["/api/workout-builder/reject"] });
            toast({
              title: "Feedback saved",
              description: payload.applyToConfig
                ? `Equipment added to avoid list for Round ${rejectTarget.roomNumber}.`
                : "Logged for training — not applied to config.",
            });
            setRejectTarget(null);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DayWorkout — renders the score card + round cards for one day
// ---------------------------------------------------------------------------

interface DayWorkoutProps {
  draft: WorkoutDraft;
  isPolishing: boolean;
  minScore: number;
  onToggleLock: (roomId: number) => void;
  onReplace: (roomId: number, index: number) => void;
  onRemove: (roomId: number, index: number) => void;
  onAddSecond: (roomId: number, index: number) => void;
  onRejectExercise: (round: GeneratedRound, ex: RoundExercise) => void;
  comparison: WorkoutDraft | null;
}

function DayWorkout({
  draft,
  isPolishing,
  minScore,
  onToggleLock,
  onReplace,
  onRemove,
  onAddSecond,
  onRejectExercise,
  comparison,
}: DayWorkoutProps) {
  const belowMin = draft.score < minScore;

  return (
    <div className="space-y-3">
      {/* Score card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">
                {draft.label ?? new Date(draft.date + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
              </CardTitle>
              {isPolishing && (
                <p className="mt-1 flex items-center text-xs text-muted-foreground">
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  Polishing explanations...
                </p>
              )}
            </div>
            <div className="text-right">
              <div className={cn("text-4xl font-bold", scoreColor(draft.score))}>{draft.score}</div>
              <p className="text-xs text-muted-foreground">workout score</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {belowMin && (
            <div className="flex items-center gap-2 rounded-md bg-orange-50 px-3 py-2 text-sm text-orange-800">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Below your minimum score target ({minScore}). Consider regenerating or replacing low-scoring rounds.
            </div>
          )}
          {draft.summary.length > 0 && (
            <ul className="space-y-1 text-sm text-muted-foreground">
              {draft.summary.map((s, i) => (
                <li key={i} className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                  {s}
                </li>
              ))}
            </ul>
          )}
          {draft.warnings.length > 0 && (
            <ul className="space-y-1 text-sm text-orange-700">
              {draft.warnings.map((w, i) => (
                <li key={i} className="flex gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {w}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Round cards */}
      <div className="grid gap-3">
        {draft.rounds.map((r) => (
          <Card key={r.roomId} className={r.locked ? "ring-2 ring-blue-400" : ""}>
            <CardContent className="py-4">
              {/* Round header row */}
              <div className="flex items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold">
                  {r.roomNumber}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.roomName}</span>
                    {r.isBoxingRound && (
                      <Badge variant="secondary" className="gap-1 bg-red-50 text-red-700">
                        <Hand className="h-3 w-3" />
                        Boxing{r.glovesOn ? " · gloves on" : ""}
                      </Badge>
                    )}
                    {r.dropset && (
                      <Badge variant="secondary" className="gap-1 bg-purple-50 text-purple-700">
                        <Layers className="h-3 w-3" /> Dropset
                      </Badge>
                    )}
                    <Badge variant="outline">
                      {r.exercises.length === 1 ? "1 exercise" : "2 exercises"}
                    </Badge>
                  </div>
                  {r.reasons.length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">{r.reasons[0]}</p>
                  )}
                  {r.warnings.map((w, i) => (
                    <p key={i} className="mt-1 text-xs text-orange-600">{w}</p>
                  ))}
                </div>
                <span className={cn("text-sm font-semibold", scoreColor(r.score))}>{r.score}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  title={r.locked ? "Unlock" : "Lock"}
                  onClick={() => onToggleLock(r.roomId)}
                >
                  {r.locked ? (
                    <Lock className="h-4 w-4 text-blue-600" />
                  ) : (
                    <Unlock className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
              </div>

              {/* Exercise rows */}
              <div className="mt-3 space-y-2 pl-12">
                {r.exercises.map((ex, idx) => (
                  <div
                    key={`${ex.videoId}-${idx}`}
                    className="flex items-start gap-3 rounded-lg border bg-muted/30 p-2"
                  >
                    <span className="mt-1 text-xs font-medium text-muted-foreground">{idx + 1}</span>
                    <ImageThumbnail video={ex.video} size="small" showPlayButton={false} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">{ex.video.title}</p>
                        {ex.heartRate && (
                          <span className={cn("inline-flex items-center gap-1 text-xs", HR_STYLE[ex.heartRate].text)}>
                            <span className={cn("h-2 w-2 rounded-full", HR_STYLE[ex.heartRate].dot)} />
                            {HR_STYLE[ex.heartRate].label}
                          </span>
                        )}
                        {r.glovesOn && idx > 0 && (
                          <Badge variant="outline" className="text-xs text-green-700">glove-friendly</Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {ex.video.bodyPart} &middot; {ex.video.equipment}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Report a problem with this exercise"
                        onClick={() => onRejectExercise(r, ex)}
                        className="text-red-400 hover:text-red-600 hover:bg-red-50"
                      >
                        <ThumbsDown className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Replace exercise"
                        onClick={() => onReplace(r.roomId, idx)}
                      >
                        <Replace className="h-4 w-4" />
                      </Button>
                      {r.exercises.length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Remove exercise"
                          onClick={() => onRemove(r.roomId, idx)}
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}

                {!r.dropset && r.exercises.length < 2 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={() => onAddSecond(r.roomId, r.exercises.length)}
                  >
                    <Plus className="mr-1 h-4 w-4" /> Add second exercise
                  </Button>
                )}
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
          <CardContent className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
            <div>
              <p className="mb-1 font-medium">Saved workout</p>
              {comparison.rounds.filter((r) => r.exercises.length > 0).map((r) => (
                <p key={r.roomId} className="truncate">
                  {r.roomNumber}. {r.exercises.map((e) => e.video.title).join(" + ")}{" "}
                  <span className={scoreColor(r.score)}>({r.score})</span>
                </p>
              ))}
            </div>
            <div>
              <p className="mb-1 font-medium">Current workout</p>
              {draft.rounds.filter((r) => r.exercises.length > 0).map((r) => (
                <p key={r.roomId} className="truncate">
                  {r.roomNumber}. {r.exercises.map((e) => e.video.title).join(" + ")}{" "}
                  <span className={scoreColor(r.score)}>({r.score})</span>
                </p>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RejectionDialog — unchanged from previous version
// ---------------------------------------------------------------------------

interface RejectionDialogProps {
  target: RejectTarget;
  onClose: () => void;
  onSubmit: (payload: {
    roomId: number;
    roomNumber: number;
    roomName: string;
    reason: string;
    equipment: string[];
    videoIds: number[];
    videoTitles: string[];
    applyToConfig: boolean;
  }) => Promise<void>;
}

function RejectionDialog({ target, onClose, onSubmit }: RejectionDialogProps) {
  const [reason, setReason] = useState("");
  const [selectedEquipment, setSelectedEquipment] = useState<string[]>(target.equipmentList);
  const [applyToConfig, setApplyToConfig] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  function toggleEquipment(e: string) {
    setSelectedEquipment((prev) =>
      prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]
    );
  }

  async function handleSubmit() {
    if (!reason.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit({
        roomId: target.roomId,
        roomNumber: target.roomNumber,
        roomName: target.roomName,
        reason: reason.trim(),
        equipment: selectedEquipment,
        videoIds: [target.videoId],
        videoTitles: [target.videoTitle],
        applyToConfig,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ThumbsDown className="h-4 w-4 text-red-500" />
            Flag exercise — Round {target.roomNumber}
          </DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{target.videoTitle}</span>
            {" "}won&apos;t work at this station. Your feedback trains the builder to avoid this in future workouts.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {target.equipmentList.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Which equipment is unavailable?</Label>
              <div className="flex flex-wrap gap-2">
                {target.equipmentList.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => toggleEquipment(e)}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium border transition-colors",
                      selectedEquipment.includes(e)
                        ? "bg-red-600 text-white border-red-600"
                        : "bg-background text-muted-foreground border-border line-through"
                    )}
                  >
                    {e}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">All equipment pre-selected. Deselect any that is available.</p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="reject-reason" className="text-sm font-medium">
              Reason <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="reject-reason"
              placeholder={`e.g. No tubes at Round ${target.roomNumber} — avoid R.TUBE here.`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="resize-none"
            />
          </div>

          <div className="flex items-start gap-3 rounded-md border border-orange-200 bg-orange-50 p-3">
            <Switch id="apply-config" checked={applyToConfig} onCheckedChange={setApplyToConfig} className="mt-0.5" />
            <div>
              <Label htmlFor="apply-config" className="text-sm font-medium cursor-pointer">
                Add to avoid list for Round {target.roomNumber}
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                The selected equipment will be added to the &quot;Avoid equipment&quot; list in Builder Config for this round.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={!reason.trim() || submitting}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Submit Feedback
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
