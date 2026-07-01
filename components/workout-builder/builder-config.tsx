"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Loader2, Plus, Save, Trash2, ThumbsDown, CheckCircle2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const HR_OPTIONS = [
  { value: "green", label: "Low (green)" },
  { value: "orange", label: "Medium (orange)" },
  { value: "red", label: "High (red)" },
];

// Small comma-separated list editor
function TokenList({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [text, setText] = useState(value.join(", "));
  useEffect(() => { setText(value.join(", ")); }, [value]);
  return (
    <Input
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
  settings: { reuseWeeks: number; minScore: number; autoRegen: boolean; weeklyChallenge: any };
  rooms: { id: number; number: number; name: string; description: string | null }[];
}

export function BuilderConfig() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<ConfigData>({ queryKey: ["/api/workout-builder/config"] });

  const save = useMutation({
    mutationFn: async ({ section, data }: { section: string; data: any }) =>
      apiRequest("PUT", "/api/workout-builder/config", { section, data }),
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
    <div className="space-y-6">
      <SettingsCard settings={data.settings} onSave={(d) => save.mutate({ section: "settings", data: d })} />
      <WeeklyTemplatesCard templates={data.templates} onSave={(d) => save.mutate({ section: "template", data: d })} />
      <RoundConfigCard rooms={data.rooms} roundConfigs={data.roundConfigs} onSave={(d) => save.mutate({ section: "roundConfig", data: d })} />
      <EquipmentLimitsCard limits={data.equipmentLimits} onSave={(d) => save.mutate({ section: "equipmentLimits", data: d })} />
      <RejectionFeedbackCard />
    </div>
  );
}

function SettingsCard({ settings, onSave }: { settings: ConfigData["settings"]; onSave: (d: any) => void }) {
  const [reuseWeeks, setReuseWeeks] = useState(settings.reuseWeeks);
  const [minScore, setMinScore] = useState(settings.minScore);
  const [autoRegen, setAutoRegen] = useState(settings.autoRegen);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Global Settings</CardTitle>
        <CardDescription>Rotation window and generation thresholds used by the rule engine.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>Reuse window (weeks)</Label>
            <Input type="number" min={1} max={52} value={reuseWeeks} onChange={(e) => setReuseWeeks(Number(e.target.value))} />
          </div>
          <div className="space-y-2">
            <Label>Minimum score to publish</Label>
            <Input type="number" min={0} max={100} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} />
          </div>
          <div className="flex items-center gap-2 pt-7">
            <Switch checked={autoRegen} onCheckedChange={setAutoRegen} id="auto-regen" />
            <Label htmlFor="auto-regen">Auto-regenerate below min score</Label>
          </div>
        </div>
        <Button onClick={() => onSave({ reuseWeeks, minScore, autoRegen, weeklyChallenge: settings.weeklyChallenge ?? {} })}>
          <Save className="mr-2 h-4 w-4" /> Save settings
        </Button>
      </CardContent>
    </Card>
  );
}

function WeeklyTemplatesCard({ templates, onSave }: { templates: any[]; onSave: (d: any) => void }) {
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
      <CardHeader>
        <CardTitle className="text-lg">Weekly Templates</CardTitle>
        <CardDescription>Define the muscle focus and style for each day of the week.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((d, i) => (
            <Button key={i} size="sm" variant={weekday === i ? "default" : "outline"} onClick={() => setWeekday(i)}>
              {d.slice(0, 3)}
              {templates.find((t) => t.weekday === i)?.primaryMuscles?.length ? (
                <span className="ml-1 h-1.5 w-1.5 rounded-full bg-green-500 inline-block" />
              ) : null}
            </Button>
          ))}
        </div>
        <Separator />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Label (e.g. Chest &amp; Triceps)</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Day label" />
          </div>
          <div className="space-y-2">
            <Label>Workout style</Label>
            <Input value={style} onChange={(e) => setStyle(e.target.value)} placeholder="e.g. Strength, HIIT, Mixed" />
          </div>
          <div className="space-y-2">
            <Label>Primary muscles</Label>
            <TokenList value={primary} onChange={setPrimary} placeholder="Chest, Triceps" />
          </div>
          <div className="space-y-2">
            <Label>Secondary muscles</Label>
            <TokenList value={secondary} onChange={setSecondary} placeholder="Shoulders, Core" />
          </div>
        </div>
        <Button onClick={() => onSave({ weekday, label, primaryMuscles: primary, secondaryMuscles: secondary, workoutStyle: style, goals: {} })}>
          <Save className="mr-2 h-4 w-4" /> Save {WEEKDAYS[weekday]}
        </Button>
      </CardContent>
    </Card>
  );
}

function RoundConfigCard({ rooms, roundConfigs, onSave }: { rooms: ConfigData["rooms"]; roundConfigs: any[]; onSave: (d: any) => void }) {
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
    setCoreOnly(c?.coreOnly ?? false);
  }, [roomId, roundConfigs]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Round / Station Config</CardTitle>
        <CardDescription>Per-round equipment rules, categories, and heart-rate targets.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {rooms.map((r) => (
            <Button key={r.id} size="sm" variant={roomId === r.id ? "default" : "outline"} onClick={() => setRoomId(r.id)}>
              {r.number}
              {roundConfigs.find((c) => c.roomId === r.id) ? (
                <span className="ml-1 h-1.5 w-1.5 rounded-full bg-green-500 inline-block" />
              ) : null}
            </Button>
          ))}
        </div>
        {room && <p className="text-sm text-gray-500">Room {room.number}: {room.name}</p>}
        <Separator />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Station name</Label>
            <Input value={stationName} onChange={(e) => setStationName(e.target.value)} placeholder={room?.name ?? "Station"} />
          </div>
          <div className="space-y-2">
            <Label>Station role</Label>
            <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Power, Conditioning, Core" />
          </div>
          <div className="space-y-2">
            <Label>Preferred equipment</Label>
            <TokenList value={preferred} onChange={setPreferred} placeholder="DB, KB" />
          </div>
          <div className="space-y-2">
            <Label>Allowed equipment (whitelist)</Label>
            <TokenList value={allowed} onChange={setAllowed} placeholder="leave empty for any" />
          </div>
          <div className="space-y-2">
            <Label>Avoid equipment</Label>
            <TokenList value={avoid} onChange={setAvoid} placeholder="BB, BENCH" />
          </div>
          <div className="space-y-2">
            <Label>Preferred categories</Label>
            <TokenList value={cats} onChange={setCats} placeholder="Strength, Cardio" />
          </div>
          <div className="space-y-2">
            <Label>Target heart-rate zone</Label>
            <Select value={hr} onValueChange={setHr}>
              <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Any</SelectItem>
                {HR_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 pt-7">
            <Switch id="core-only" checked={coreOnly} onCheckedChange={setCoreOnly} />
            <Label htmlFor="core-only">Core-only station</Label>
          </div>
        </div>
        <Button
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
              availableSpace: null,
              coreOnly,
            })
          }
        >
          <Save className="mr-2 h-4 w-4" /> Save round {room?.number}
        </Button>
      </CardContent>
    </Card>
  );
}

function EquipmentLimitsCard({ limits, onSave }: { limits: { equipment: string; maxStations: number }[]; onSave: (d: any) => void }) {
  const [rows, setRows] = useState(limits.length ? limits : [{ equipment: "", maxStations: 1 }]);

  const update = (i: number, patch: Partial<{ equipment: string; maxStations: number }>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Equipment Limits</CardTitle>
        <CardDescription>Maximum number of stations that can use a given piece of equipment in one workout.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input className="flex-1" placeholder="Equipment (e.g. BB)" value={r.equipment} onChange={(e) => update(i, { equipment: e.target.value })} />
            <Input className="w-28" type="number" min={1} max={10} value={r.maxStations} onChange={(e) => update(i, { maxStations: Number(e.target.value) })} />
            <Button variant="ghost" size="icon" onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setRows((prev) => [...prev, { equipment: "", maxStations: 1 }])}>
            <Plus className="mr-2 h-4 w-4" /> Add limit
          </Button>
          <Button size="sm" onClick={() => onSave(rows.filter((r) => r.equipment.trim()))}>
            <Save className="mr-2 h-4 w-4" /> Save limits
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Rejection Feedback — shows the log of trainer rejections and their status
// ---------------------------------------------------------------------------

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

function RejectionFeedbackCard() {
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
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ThumbsDown className="h-4 w-4 text-red-500" />
          Rejection Feedback
        </CardTitle>
        <CardDescription>
          Trainer rejections logged from the Workout Builder. Items marked &quot;Applied&quot; have
          already updated the round&apos;s Avoid Equipment list.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading feedback...
          </div>
        )}
        {!isLoading && feedbackList.length === 0 && (
          <p className="text-sm text-gray-400 py-4 text-center">
            No rejection feedback yet. Use the <strong>Reject</strong> button on a generated round to log feedback.
          </p>
        )}
        {feedbackList.length > 0 && (
          <div className="space-y-2">
            {feedbackList.map((fb) => (
              <div
                key={fb.id}
                className="flex items-start gap-3 rounded-md border border-gray-100 bg-gray-50 p-3"
              >
                {/* Round badge */}
                <div className="shrink-0 flex h-8 w-8 items-center justify-center rounded-full bg-red-100 text-xs font-bold text-red-700">
                  {fb.room_number ?? "?"}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-900">
                      Round {fb.room_number} — {fb.room_name}
                    </span>
                    {fb.applied ? (
                      <Badge className="gap-1 bg-green-100 text-green-700 border-green-200 text-xs">
                        <CheckCircle2 className="h-3 w-3" /> Applied to config
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs text-gray-500">Log only</Badge>
                    )}
                    <span className="text-xs text-gray-400 ml-auto">
                      {new Date(fb.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                  </div>

                  <p className="text-sm text-gray-700">{fb.reason}</p>

                  {fb.equipment.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {fb.equipment.map((e) => (
                        <span key={e} className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 border border-red-200">
                          {e}
                        </span>
                      ))}
                    </div>
                  )}

                  {fb.video_titles.length > 0 && (
                    <p className="text-xs text-gray-400">
                      Exercises: {fb.video_titles.join(", ")}
                    </p>
                  )}
                </div>

                {/* Delete */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-gray-400 hover:text-red-600"
                  title="Remove this feedback"
                  onClick={() => deleteFeedback.mutate({ id: fb.id, revertConfig: fb.applied })}
                  disabled={deleteFeedback.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
