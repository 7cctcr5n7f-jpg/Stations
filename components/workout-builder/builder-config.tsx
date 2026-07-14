"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save, Trash2, Plus, ThumbsDown, CheckCircle2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { AlternativeExercisesConfig, AlternativeFocus } from "@/lib/workout-builder/types";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ACTIVE_DAYS = [1, 2, 3, 4, 5, 6]; // Mon-Sat
const HR_OPTIONS = [
  { value: "green", label: "Low (green)" },
  { value: "orange", label: "Medium (orange)" },
  { value: "red", label: "High (red)" },
];
const SPACE_OPTIONS = [
  { value: "none", label: "Not set" },
  { value: "large", label: "Large" },
  { value: "small", label: "Small" },
  { value: "stationary", label: "Stationary" },
];
const ALTERNATIVE_FOCUS_OPTIONS: AlternativeFocus[] = [
  "Lower Body", "Core", "Functional Conditioning", "Mobility", "Low-Impact Options",
];

function TokenList({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [text, setText] = useState(value.join(", "));
  useEffect(() => { setText(value.join(", ")); }, [value]);
  return (
    <Input
      className="h-8 text-xs"
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onChange(text.split(",").map((t) => t.trim()).filter(Boolean))}
    />
  );
}

interface ConfigData {
  templates: any[];
  roundConfigs: any[];
  equipmentLimits: { equipment: string; maxStations: number }[];
  settings: {
    reuseWeeks: number;
    minScore: number;
    autoRegen: boolean;
    weeklyChallenge: Record<string, unknown>;
    alternativeExercises: AlternativeExercisesConfig;
  };
  rooms: { id: number; number: number; name: string; description: string | null }[];
}

export function BuilderConfig() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<ConfigData>({ queryKey: ["/api/workout-builder/config"] });

  const save = useMutation({
    mutationFn: async ({ section, data: payload }: { section: string; data: any }) =>
      apiRequest("PUT", "/api/workout-builder/config", { section, data: payload }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workout-builder/config"] });
      toast({ title: "Saved" });
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading configuration...
      </div>
    );
  }

  return (
    <Tabs defaultValue="week" className="space-y-4">
      <TabsList className="grid w-full grid-cols-5">
        <TabsTrigger value="week">Weekly Programme</TabsTrigger>
        <TabsTrigger value="stations">Stations</TabsTrigger>
        <TabsTrigger value="equipment">Equipment</TabsTrigger>
        <TabsTrigger value="engine">Engine</TabsTrigger>
        <TabsTrigger value="feedback">Feedback</TabsTrigger>
      </TabsList>

      <TabsContent value="week">
        <WeeklyProgrammeTab
          templates={data.templates}
          onSave={(d) => save.mutate({ section: "template", data: d })}
        />
      </TabsContent>

      <TabsContent value="stations">
        <StationsTab
          rooms={data.rooms}
          roundConfigs={data.roundConfigs}
          onSave={(d) => save.mutate({ section: "roundConfig", data: d })}
        />
      </TabsContent>

      <TabsContent value="equipment">
        <EquipmentTab
          limits={data.equipmentLimits}
          onSave={(d) => save.mutate({ section: "equipmentLimits", data: d })}
        />
      </TabsContent>

      <TabsContent value="engine">
        <EngineTab
          settings={data.settings}
          onSave={(d) => save.mutate({ section: "settings", data: d })}
        />
      </TabsContent>

      <TabsContent value="feedback">
        <FeedbackTab />
      </TabsContent>
    </Tabs>
  );
}

// ============================================================================
// Weekly Programme Tab — defines daily focus and muscle groups
// ============================================================================

function WeeklyProgrammeTab({ templates, onSave }: { templates: any[]; onSave: (d: any) => void }) {
  const [weekday, setWeekday] = useState(1);
  const current = templates.find((t) => t.weekday === weekday);
  const [label, setLabel] = useState(current?.label ?? "");
  const [primary, setPrimary] = useState<string[]>(current?.primaryMuscles ?? []);
  const [secondary, setSecondary] = useState<string[]>(current?.secondaryMuscles ?? []);
  const [style, setStyle] = useState(current?.workoutStyle ?? "");

  useEffect(() => {
    const t = templates.find((x) => x.weekday === weekday);
    setLabel(t?.label ?? "");
    setPrimary(t?.primaryMuscles ?? []);
    setSecondary(t?.secondaryMuscles ?? []);
    setStyle(t?.workoutStyle ?? "");
  }, [weekday, templates]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Weekly Programme</CardTitle>
        <CardDescription className="text-xs">
          Define the focus, muscle groups, and style for each training day. The engine uses these to select exercises.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Day selector */}
        <div className="flex gap-1">
          {ACTIVE_DAYS.map((i) => {
            const t = templates.find((x) => x.weekday === i);
            const hasConfig = t?.label || (t?.primaryMuscles?.length > 0);
            return (
              <button
                key={i}
                type="button"
                onClick={() => setWeekday(i)}
                className={`flex-1 rounded-md py-2 text-center text-xs font-medium transition-colors ${
                  weekday === i
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {WEEKDAYS[i].slice(0, 3)}
                {hasConfig && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-green-500" />}
              </button>
            );
          })}
        </div>

        {/* Config fields */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Focus Label</Label>
            <Input className="h-8 text-sm" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Upper Push" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Workout Style</Label>
            <Select value={style || "none"} onValueChange={(v) => setStyle(v === "none" ? "" : v)}>
              <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select style" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not set</SelectItem>
                <SelectItem value="Strength">Strength</SelectItem>
                <SelectItem value="HIIT">HIIT</SelectItem>
                <SelectItem value="Power">Power</SelectItem>
                <SelectItem value="Endurance">Endurance</SelectItem>
                <SelectItem value="Mixed">Mixed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Primary Muscles</Label>
            <TokenList value={primary} onChange={setPrimary} placeholder="Chest, Shoulders, Triceps" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Secondary Muscles</Label>
            <TokenList value={secondary} onChange={setSecondary} placeholder="Core, Forearms" />
          </div>
        </div>

        {/* Summary row */}
        <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2">
          <div className="text-xs text-muted-foreground">
            {label ? (
              <span><strong>{WEEKDAYS[weekday]}</strong>: {label} — {primary.join(", ") || "No muscles set"}</span>
            ) : (
              <span className="text-orange-600"><strong>{WEEKDAYS[weekday]}</strong>: Not configured — engine will use balanced selection</span>
            )}
          </div>
          <Button size="sm" className="h-7 text-xs" onClick={() => onSave({ weekday, label, primaryMuscles: primary, secondaryMuscles: secondary, workoutStyle: style, goals: {} })}>
            <Save className="mr-1 h-3 w-3" /> Save
          </Button>
        </div>

        {/* Quick overview of all days */}
        <div className="rounded-md border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="px-2 py-1.5 text-left font-medium">Day</th>
                <th className="px-2 py-1.5 text-left font-medium">Focus</th>
                <th className="px-2 py-1.5 text-left font-medium">Muscles</th>
                <th className="px-2 py-1.5 text-left font-medium">Style</th>
              </tr>
            </thead>
            <tbody>
              {ACTIVE_DAYS.map((d) => {
                const t = templates.find((x) => x.weekday === d);
                return (
                  <tr key={d} className={`border-b last:border-0 ${weekday === d ? "bg-blue-50" : ""}`}>
                    <td className="px-2 py-1.5 font-medium">{WEEKDAYS[d].slice(0, 3)}</td>
                    <td className="px-2 py-1.5">{t?.label || <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-2 py-1.5">{t?.primaryMuscles?.join(", ") || <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-2 py-1.5">{t?.workoutStyle || <span className="text-muted-foreground">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Stations Tab — per-station equipment and configuration
// ============================================================================

function StationsTab({ rooms, roundConfigs, onSave }: { rooms: ConfigData["rooms"]; roundConfigs: any[]; onSave: (d: any) => void }) {
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? 0);
  const current = roundConfigs.find((c) => c.roomId === roomId);
  const room = rooms.find((r) => r.id === roomId);

  const [stationName, setStationName] = useState(current?.stationName ?? "");
  const [role, setRole] = useState(current?.stationRole ?? "");
  const [preferred, setPreferred] = useState<string[]>(current?.preferredEquipment ?? []);
  const [allowed, setAllowed] = useState<string[]>(current?.allowedEquipment ?? []);
  const [avoid, setAvoid] = useState<string[]>(current?.avoidEquipment ?? []);
  const [cats, setCats] = useState<string[]>(current?.preferredCategories ?? []);
  const [hr, setHr] = useState<string>(current?.preferredHeartRate ?? "none");
  const [space, setSpace] = useState<string>(current?.availableSpace ?? "none");
  const [coreOnly, setCoreOnly] = useState<boolean>(current?.coreOnly ?? false);

  useEffect(() => {
    const c = roundConfigs.find((x) => x.roomId === roomId);
    setStationName(c?.stationName ?? "");
    setRole(c?.stationRole ?? "");
    setPreferred(c?.preferredEquipment ?? []);
    setAllowed(c?.allowedEquipment ?? []);
    setAvoid(c?.avoidEquipment ?? []);
    setCats(c?.preferredCategories ?? []);
    setHr(c?.preferredHeartRate ?? "none");
    setSpace(c?.availableSpace ?? "none");
    setCoreOnly(c?.coreOnly ?? false);
  }, [roomId, roundConfigs]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Station Configuration</CardTitle>
        <CardDescription className="text-xs">
          Equipment capabilities, categories, and constraints per station. The engine assigns roles dynamically but respects these constraints.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Station selector — numbered circles */}
        <div className="flex gap-1.5">
          {rooms.map((r) => {
            const hasConfig = roundConfigs.find((c) => c.roomId === r.id);
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setRoomId(r.id)}
                className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                  roomId === r.id
                    ? "bg-foreground text-background"
                    : hasConfig
                      ? "bg-green-100 text-green-700 hover:bg-green-200"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {r.number}
              </button>
            );
          })}
        </div>

        {room && (
          <p className="text-xs font-medium text-muted-foreground">
            Room {room.number}: {room.name}{room.description ? ` — ${room.description}` : ""}
          </p>
        )}

        {/* Compact 2-column grid */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Station Name</Label>
            <Input className="h-8 text-sm" value={stationName} onChange={(e) => setStationName(e.target.value)} placeholder={room?.name ?? "Station"} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Default Role Hint</Label>
            <Select value={role || "none"} onValueChange={(v) => setRole(v === "none" ? "" : v)}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Auto (engine decides)</SelectItem>
                <SelectItem value="Warm-up">Warm-up</SelectItem>
                <SelectItem value="Strength">Strength</SelectItem>
                <SelectItem value="Hybrid">Hybrid</SelectItem>
                <SelectItem value="Boxing">Boxing</SelectItem>
                <SelectItem value="HIIT Spike">HIIT Spike</SelectItem>
                <SelectItem value="Core">Core</SelectItem>
                <SelectItem value="Recovery">Recovery</SelectItem>
                <SelectItem value="Conditioning">Conditioning</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Preferred Equipment</Label>
            <TokenList value={preferred} onChange={setPreferred} placeholder="DB, Bench, KB" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Allowed Equipment (whitelist)</Label>
            <TokenList value={allowed} onChange={setAllowed} placeholder="Leave empty for any" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Avoid Equipment</Label>
            <TokenList value={avoid} onChange={setAvoid} placeholder="BB, Cable" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Preferred Categories</Label>
            <TokenList value={cats} onChange={setCats} placeholder="Strength, Boxing, HIIT" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Target HR Zone</Label>
            <Select value={hr} onValueChange={setHr}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Any</SelectItem>
                {HR_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Available Space</Label>
            <Select value={space} onValueChange={setSpace}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SPACE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2">
            <Switch id="core-only" checked={coreOnly} onCheckedChange={setCoreOnly} />
            <Label htmlFor="core-only" className="text-xs cursor-pointer">Core-only station</Label>
          </div>
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={() =>
              onSave({
                roomId,
                stationName,
                stationRole: role,
                preferredEquipment: preferred,
                allowedEquipment: allowed,
                avoidEquipment: avoid,
                preferredCategories: cats,
                preferredHeartRate: hr === "none" ? null : hr,
                preferredIntensity: null,
                availableSpace: space === "none" ? null : space,
                coreOnly,
              })
            }
          >
            <Save className="mr-1 h-3 w-3" /> Save Room {room?.number}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Equipment Tab — global equipment limits
// ============================================================================

function EquipmentTab({ limits, onSave }: { limits: { equipment: string; maxStations: number }[]; onSave: (d: any) => void }) {
  const [rows, setRows] = useState(limits.length ? limits : [{ equipment: "", maxStations: 1 }]);

  const update = (i: number, patch: Partial<{ equipment: string; maxStations: number }>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Equipment Limits</CardTitle>
        <CardDescription className="text-xs">
          Maximum stations that can use a piece of equipment in one workout. Prevents over-reliance on a single piece.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="rounded-md border">
          <div className="grid grid-cols-[1fr_80px_40px] gap-2 border-b bg-muted/30 px-3 py-1.5 text-xs font-medium">
            <span>Equipment</span>
            <span>Max</span>
            <span></span>
          </div>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_80px_40px] items-center gap-2 border-b last:border-0 px-3 py-1.5">
              <Input className="h-7 text-xs" placeholder="e.g. BB, DB, KB" value={r.equipment} onChange={(e) => update(i, { equipment: e.target.value })} />
              <Input className="h-7 text-xs text-center" type="number" min={1} max={10} value={r.maxStations} onChange={(e) => update(i, { maxStations: Number(e.target.value) })} />
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setRows((prev) => [...prev, { equipment: "", maxStations: 1 }])}>
            <Plus className="mr-1 h-3 w-3" /> Add
          </Button>
          <Button size="sm" className="h-7 text-xs" onClick={() => onSave(rows.filter((r) => r.equipment.trim()))}>
            <Save className="mr-1 h-3 w-3" /> Save Limits
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Engine Tab — global settings, rotation, alternatives
// ============================================================================

function EngineTab({ settings, onSave }: { settings: ConfigData["settings"]; onSave: (d: any) => void }) {
  const [reuseWeeks, setReuseWeeks] = useState(settings.reuseWeeks);
  const [minScore, setMinScore] = useState(settings.minScore);
  const [autoRegen, setAutoRegen] = useState(settings.autoRegen);
  const [alternativeEnabled, setAlternativeEnabled] = useState(settings.alternativeExercises?.enabled ?? true);
  const [alternativeMaximum, setAlternativeMaximum] = useState(settings.alternativeExercises?.maximumPerWorkout ?? 2);
  const [alternativeFocus, setAlternativeFocus] = useState<AlternativeFocus[]>(
    settings.alternativeExercises?.preferredFocus?.length
      ? settings.alternativeExercises.preferredFocus
      : ["Lower Body", "Core"],
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Engine Settings</CardTitle>
        <CardDescription className="text-xs">
          Global parameters controlling exercise rotation, quality thresholds, and alternative exercises.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Core settings in a compact row */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-xs">Rotation Window (weeks)</Label>
            <Input className="h-8 text-sm" type="number" min={1} max={52} value={reuseWeeks} onChange={(e) => setReuseWeeks(Number(e.target.value))} />
            <p className="text-[10px] text-muted-foreground">Avoid repeating exercises within this many weeks</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Min Score to Publish</Label>
            <Input className="h-8 text-sm" type="number" min={0} max={100} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} />
            <p className="text-[10px] text-muted-foreground">Workouts below this score show a warning</p>
          </div>
          <div className="space-y-1 pt-4">
            <div className="flex items-center gap-2">
              <Switch checked={autoRegen} onCheckedChange={setAutoRegen} id="auto-regen" />
              <Label htmlFor="auto-regen" className="text-xs cursor-pointer">Auto-regenerate below min</Label>
            </div>
          </div>
        </div>

        {/* Alternative exercises section */}
        <div className="rounded-md border p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium">Optional Alternative Exercises</p>
              <p className="text-[10px] text-muted-foreground">Add alternatives on push-heavy days to balance workout loading</p>
            </div>
            <Switch checked={alternativeEnabled} onCheckedChange={setAlternativeEnabled} id="alt-enabled" />
          </div>
          {alternativeEnabled && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Max per Workout</Label>
                <Input
                  className="h-8 text-sm"
                  type="number"
                  min={0}
                  max={5}
                  value={alternativeMaximum}
                  onChange={(e) => setAlternativeMaximum(Math.max(0, Math.min(5, Number(e.target.value) || 0)))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Preferred Focus</Label>
                <div className="flex flex-wrap gap-1">
                  {ALTERNATIVE_FOCUS_OPTIONS.map((focus) => {
                    const active = alternativeFocus.includes(focus);
                    return (
                      <button
                        key={focus}
                        type="button"
                        onClick={() =>
                          setAlternativeFocus((prev) =>
                            active ? prev.filter((f) => f !== focus) : [...prev, focus],
                          )
                        }
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium border transition-colors ${
                          active
                            ? "bg-blue-100 text-blue-700 border-blue-200"
                            : "bg-muted text-muted-foreground border-transparent hover:bg-muted/80"
                        }`}
                      >
                        {focus}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        <Button
          size="sm"
          className="h-7 text-xs"
          onClick={() =>
            onSave({
              reuseWeeks,
              minScore,
              autoRegen,
              weeklyChallenge: {
                ...(settings.weeklyChallenge ?? {}),
                alternativeExercises: {
                  enabled: alternativeEnabled,
                  mode: "Intelligent",
                  maximumPerWorkout: alternativeMaximum,
                  preferredFocus: alternativeFocus,
                },
              },
            })
          }
        >
          <Save className="mr-1 h-3 w-3" /> Save Engine Settings
        </Button>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Feedback Tab — rejection log
// ============================================================================

interface FeedbackRow {
  id: number;
  created_at: string;
  room_number: number | null;
  room_name: string | null;
  reason: string;
  equipment: string[];
  video_titles: string[];
  applied: boolean;
}

function FeedbackTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: feedbackList = [], isLoading } = useQuery<FeedbackRow[]>({
    queryKey: ["/api/workout-builder/reject"],
  });

  const deleteFeedback = useMutation({
    mutationFn: async ({ id, revertConfig }: { id: number; revertConfig: boolean }) =>
      apiRequest("DELETE", "/api/workout-builder/reject", { id, revertConfig }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workout-builder/reject"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workout-builder/config"] });
      toast({ title: "Feedback removed" });
    },
    onError: () => toast({ title: "Failed to remove feedback", variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ThumbsDown className="h-4 w-4 text-red-500" />
          Rejection Feedback
        </CardTitle>
        <CardDescription className="text-xs">
          Trainer rejections from the Builder. Applied items update station Avoid Equipment lists.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading...
          </div>
        )}
        {!isLoading && feedbackList.length === 0 && (
          <p className="text-xs text-muted-foreground py-6 text-center">
            No rejection feedback yet. Flag exercises in generated workouts to log feedback.
          </p>
        )}
        {feedbackList.length > 0 && (
          <div className="space-y-2">
            {feedbackList.map((fb) => (
              <div key={fb.id} className="flex items-start gap-2 rounded-md border p-2">
                <div className="shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-red-100 text-[10px] font-bold text-red-700">
                  {fb.room_number ?? "?"}
                </div>
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-medium">Room {fb.room_number}</span>
                    {fb.applied ? (
                      <Badge className="h-4 gap-0.5 bg-green-100 text-green-700 border-green-200 text-[10px]">
                        <CheckCircle2 className="h-2.5 w-2.5" /> Applied
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="h-4 text-[10px]">Log</Badge>
                    )}
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {new Date(fb.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{fb.reason}</p>
                  {fb.equipment.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {fb.equipment.map((e) => (
                        <span key={e} className="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] text-red-700 border border-red-200">
                          {e}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 h-6 w-6 text-muted-foreground hover:text-red-600"
                  onClick={() => deleteFeedback.mutate({ id: fb.id, revertConfig: fb.applied })}
                  disabled={deleteFeedback.isPending}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
