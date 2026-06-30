"use client"

import { useState, useMemo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Plus, Search, Trash2, Edit, Check, X, BookOpen, Tag } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import type { DictionaryEntry } from "@/lib/shared/schema"

// ─── Constants ────────────────────────────────────────────────────────────────

export const DICT_CATEGORIES = [
  "Punch",
  "Defence",
  "BoxingDrill",
  "Equipment",
  "Exercise",
  "Modifier",
  "Category",
  "Format",
] as const

export type DictCategory = (typeof DICT_CATEGORIES)[number]

const CATEGORY_STYLES: Record<string, string> = {
  Punch:       "bg-red-50   text-red-700   border-red-200",
  Defence:     "bg-orange-50 text-orange-700 border-orange-200",
  BoxingDrill: "bg-rose-50  text-rose-700  border-rose-200",
  Equipment:   "bg-blue-50  text-blue-700  border-blue-200",
  Exercise:    "bg-green-50 text-green-700 border-green-200",
  Modifier:    "bg-purple-50 text-purple-700 border-purple-200",
  Category:    "bg-amber-50 text-amber-700 border-amber-200",
  Format:      "bg-cyan-50  text-cyan-700  border-cyan-200",
}

function categoryBadge(cat: string) {
  const style = CATEGORY_STYLES[cat] ?? "bg-gray-100 text-gray-600 border-gray-200"
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold ${style}`}>
      {cat}
    </span>
  )
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchDictionary(): Promise<DictionaryEntry[]> {
  const res = await fetch("/api/exercise-dictionary")
  if (!res.ok) throw new Error("Failed to load dictionary")
  return res.json()
}

// ─── Inline edit row ──────────────────────────────────────────────────────────

interface InlineEditRowProps {
  entry: DictionaryEntry
  onSave: (id: number, patch: Partial<DictionaryEntry>) => Promise<void>
  onDelete: (id: number) => void
  saving: boolean
}

function InlineEditRow({ entry, onSave, onDelete, saving }: InlineEditRowProps) {
  const [editing, setEditing] = useState(false)
  const [alias, setAlias] = useState(entry.alias)
  const [canonical, setCanonical] = useState(entry.canonical)
  const [category, setCategory] = useState(entry.category)
  const [notes, setNotes] = useState(entry.notes ?? "")

  const handleSave = async () => {
    await onSave(entry.id, { alias, canonical, category, notes })
    setEditing(false)
  }

  const handleCancel = () => {
    setAlias(entry.alias)
    setCanonical(entry.canonical)
    setCategory(entry.category)
    setNotes(entry.notes ?? "")
    setEditing(false)
  }

  if (editing) {
    return (
      <tr className="bg-blue-50/60">
        <td className="p-1.5 pl-3">
          <Input
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            className="h-7 w-28 font-mono text-xs"
            placeholder="HK"
          />
        </td>
        <td className="p-1.5">
          <Input
            value={canonical}
            onChange={(e) => setCanonical(e.target.value)}
            className="h-7 text-xs"
            placeholder="Hook"
          />
        </td>
        <td className="p-1.5">
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-7 text-xs w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DICT_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </td>
        <td className="p-1.5">
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="h-7 text-xs"
            placeholder="Optional notes..."
          />
        </td>
        <td className="p-1.5 pr-3">
          <div className="flex items-center gap-1 justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className="h-6 w-6 flex items-center justify-center rounded bg-blue-600 hover:bg-blue-700 text-white transition-colors"
              title="Save"
            >
              <Check className="h-3 w-3" />
            </button>
            <button
              onClick={handleCancel}
              className="h-6 w-6 flex items-center justify-center rounded hover:bg-gray-200 text-gray-500 transition-colors"
              title="Cancel"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr className="group hover:bg-gray-50/70 transition-colors">
      <td className="p-2 pl-3">
        <span className="font-mono font-semibold text-xs text-gray-900 tracking-wide">{entry.alias}</span>
      </td>
      <td className="p-2">
        <span className="text-xs text-gray-800">{entry.canonical}</span>
      </td>
      <td className="p-2">
        {categoryBadge(entry.category)}
      </td>
      <td className="p-2 max-w-[240px]">
        <span className="text-[11px] text-gray-500 truncate block">{entry.notes || <span className="italic text-gray-300">—</span>}</span>
      </td>
      <td className="p-2 pr-3">
        <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => setEditing(true)}
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-gray-200 text-gray-400 hover:text-gray-700 transition-colors"
            title="Edit"
          >
            <Edit className="h-3 w-3" />
          </button>
          <button
            onClick={() => onDelete(entry.id)}
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-red-100 text-gray-400 hover:text-red-600 transition-colors"
            title="Delete"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </td>
    </tr>
  )
}

// ─── Add new entry row ────────────────────────────────────────────────────────

interface AddRowProps {
  onAdd: (entry: { alias: string; canonical: string; category: string; notes: string }) => Promise<void>
  saving: boolean
}

function AddRow({ onAdd, saving }: AddRowProps) {
  const [open, setOpen] = useState(false)
  const [alias, setAlias] = useState("")
  const [canonical, setCanonical] = useState("")
  const [category, setCategory] = useState<string>("Equipment")
  const [notes, setNotes] = useState("")

  const handleAdd = async () => {
    if (!alias.trim() || !canonical.trim()) return
    await onAdd({ alias: alias.trim(), canonical: canonical.trim(), category, notes: notes.trim() })
    setAlias(""); setCanonical(""); setNotes(""); setOpen(false)
  }

  if (!open) {
    return (
      <tr>
        <td colSpan={5} className="p-2 pl-3">
          <button
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-gray-300 px-3 py-1.5 text-xs text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add term
          </button>
        </td>
      </tr>
    )
  }

  return (
    <tr className="bg-green-50/60">
      <td className="p-1.5 pl-3">
        <Input
          autoFocus
          value={alias}
          onChange={(e) => setAlias(e.target.value.toUpperCase())}
          className="h-7 w-28 font-mono text-xs"
          placeholder="HK"
        />
      </td>
      <td className="p-1.5">
        <Input
          value={canonical}
          onChange={(e) => setCanonical(e.target.value)}
          className="h-7 text-xs"
          placeholder="Hook"
        />
      </td>
      <td className="p-1.5">
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="h-7 text-xs w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DICT_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="p-1.5">
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="h-7 text-xs"
          placeholder="Optional notes..."
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) handleAdd()
            if (e.key === "Escape") setOpen(false)
          }}
        />
      </td>
      <td className="p-1.5 pr-3">
        <div className="flex items-center gap-1 justify-end">
          <button
            onClick={handleAdd}
            disabled={saving || !alias.trim() || !canonical.trim()}
            className="h-6 w-6 flex items-center justify-center rounded bg-green-600 hover:bg-green-700 text-white disabled:opacity-40 transition-colors"
            title="Add"
          >
            <Check className="h-3 w-3" />
          </button>
          <button
            onClick={() => setOpen(false)}
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-gray-200 text-gray-500 transition-colors"
            title="Cancel"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </td>
    </tr>
  )
}

// ─── Main dictionary component ────────────────────────────────────────────────

export function ExerciseDictionary() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [search, setSearch] = useState("")
  const [filterCat, setFilterCat] = useState("all")

  const { data: entries = [], isLoading } = useQuery<DictionaryEntry[]>({
    queryKey: ["/api/exercise-dictionary"],
    queryFn: fetchDictionary,
    staleTime: 30_000,
  })

  const saveMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: number | null; patch: any }) => {
      const url = id ? `/api/exercise-dictionary/${id}` : "/api/exercise-dictionary"
      const method = id ? "PATCH" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? "Save failed")
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/exercise-dictionary"] })
      toast({ title: "Dictionary updated" })
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/exercise-dictionary/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Delete failed")
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/exercise-dictionary"] })
      toast({ title: "Entry deleted" })
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return entries.filter((e) => {
      if (filterCat !== "all" && e.category !== filterCat) return false
      if (!q) return true
      return (
        e.alias.toLowerCase().includes(q) ||
        e.canonical.toLowerCase().includes(q) ||
        (e.notes ?? "").toLowerCase().includes(q)
      )
    })
  }, [entries, search, filterCat])

  const catCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    entries.forEach((e) => { counts[e.category] = (counts[e.category] ?? 0) + 1 })
    return counts
  }, [entries])

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-gray-500" />
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Exercise Dictionary</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {entries.length} terms — AI consults this before analysing any video title
            </p>
          </div>
        </div>
      </div>

      {/* Category summary chips */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setFilterCat("all")}
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
            filterCat === "all"
              ? "bg-gray-900 text-white border-gray-900"
              : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
          }`}
        >
          All
          <span className="rounded-full bg-white/20 px-1 text-[10px] tabular-nums">{entries.length}</span>
        </button>
        {DICT_CATEGORIES.map((cat) => {
          const count = catCounts[cat] ?? 0
          if (!count) return null
          const active = filterCat === cat
          return (
            <button
              key={cat}
              onClick={() => setFilterCat(active ? "all" : cat)}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                active
                  ? "bg-gray-900 text-white border-gray-900"
                  : `${CATEGORY_STYLES[cat] ?? "bg-gray-100 text-gray-600 border-gray-200"} hover:opacity-80`
              }`}
            >
              {cat}
              <span className="tabular-nums">{count}</span>
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search alias, canonical or notes..."
          className="h-8 pl-8 text-xs"
        />
      </div>

      {/* Table */}
      <div className="rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/80">
              <th className="text-left p-2 pl-3 font-medium text-gray-500 uppercase tracking-wide text-[10px] w-32">Alias</th>
              <th className="text-left p-2 font-medium text-gray-500 uppercase tracking-wide text-[10px]">Canonical Term</th>
              <th className="text-left p-2 font-medium text-gray-500 uppercase tracking-wide text-[10px] w-32">Category</th>
              <th className="text-left p-2 font-medium text-gray-500 uppercase tracking-wide text-[10px]">Notes</th>
              <th className="w-16 p-2 pr-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-xs text-gray-400">Loading dictionary...</td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-xs text-gray-400">
                  {search || filterCat !== "all" ? "No entries match your filter" : "No entries yet"}
                </td>
              </tr>
            ) : (
              filtered.map((entry) => (
                <InlineEditRow
                  key={entry.id}
                  entry={entry}
                  onSave={async (id, patch) => { await saveMutation.mutateAsync({ id, patch }) }}
                  onDelete={(id) => deleteMutation.mutate(id)}
                  saving={saveMutation.isPending}
                />
              ))
            )}
            <AddRow
              onAdd={async (entry) => { await saveMutation.mutateAsync({ id: null, patch: entry }) }}
              saving={saveMutation.isPending}
            />
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-gray-400 flex items-center gap-1">
        <Tag className="h-3 w-3" />
        When AI encounters a new abbreviation not in this dictionary, a review prompt will appear in the Video Library.
      </p>
    </div>
  )
}
