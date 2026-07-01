"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import ImageThumbnail from "@/components/image-thumbnail";
import { Search } from "lucide-react";
import type { Video } from "@/lib/shared/schema";

interface ExercisePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (video: Video) => void;
}

export function ExercisePicker({ open, onOpenChange, onSelect }: ExercisePickerProps) {
  const [search, setSearch] = useState("");
  const { data: videos } = useQuery<Video[]>({ queryKey: ["/api/videos"], enabled: open });

  const filtered = useMemo(() => {
    const list = videos ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list.slice(0, 100);
    return list
      .filter(
        (v) =>
          v.title.toLowerCase().includes(q) ||
          (v.bodyPart ?? "").toLowerCase().includes(q) ||
          (v.equipment ?? "").toLowerCase().includes(q),
      )
      .slice(0, 100);
  }, [videos, search]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Replace exercise</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input className="pl-9" placeholder="Search exercises..." value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
        </div>
        <div className="max-h-[420px] space-y-1 overflow-y-auto">
          {filtered.map((v) => (
            <button
              key={v.id}
              onClick={() => { onSelect(v); onOpenChange(false); }}
              className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-gray-100"
            >
              <ImageThumbnail video={v} size="small" showPlayButton={false} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900">{v.title}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {v.bodyPart && <Badge variant="secondary" className="text-xs">{v.bodyPart}</Badge>}
                  {v.equipment && <Badge variant="outline" className="text-xs">{v.equipment}</Badge>}
                  {v.intensity && <Badge variant="outline" className="text-xs">{v.intensity}</Badge>}
                </div>
              </div>
            </button>
          ))}
          {filtered.length === 0 && <p className="py-8 text-center text-sm text-gray-500">No exercises found</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
