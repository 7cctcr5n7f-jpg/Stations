"use client"

import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, BookOpen, Check, X, ChevronRight, ChevronLeft } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { DICT_CATEGORIES } from "@/components/exercise-dictionary"

export interface UnknownTerm {
  term: string
  videoIds: number[]
  videoTitles: string[]
}

interface UnknownTermsReviewProps {
  terms: UnknownTerm[]
  onDismiss: () => void
}

interface TermDecision {
  canonical: string
  category: string
  notes: string
  save: boolean   // "Remember permanently"
}

async function saveToDictionary(alias: string, canonical: string, category: string, notes: string) {
  const res = await fetch("/api/exercise-dictionary", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ alias, canonical, category, notes }),
  })
  if (!res.ok) throw new Error("Failed to save to dictionary")
  return res.json()
}

export function UnknownTermsBanner({ terms, onReview }: { terms: UnknownTerm[]; onReview: () => void }) {
  if (!terms.length) return null
  return (
    <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-amber-900">
          {terms.length} unknown {terms.length === 1 ? "abbreviation" : "abbreviations"} found
        </p>
        <p className="text-xs text-amber-700 mt-0.5">
          {terms.map((t) => t.term).join(", ")} — AI could not resolve {terms.length === 1 ? "this term" : "these terms"} from the dictionary
        </p>
      </div>
      <button
        onClick={onReview}
        className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 transition-colors"
      >
        <BookOpen className="h-3.5 w-3.5" />
        Review &amp; Remember
      </button>
    </div>
  )
}

export function UnknownTermsReviewDialog({ terms, onDismiss }: UnknownTermsReviewProps) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [index, setIndex] = useState(0)
  const [saving, setSaving] = useState(false)
  const [decisions, setDecisions] = useState<Record<string, TermDecision>>(() =>
    Object.fromEntries(
      terms.map((t) => [t.term, { canonical: t.term, category: "Equipment", notes: "", save: true }])
    )
  )

  const current = terms[index]
  if (!current) return null
  const decision = decisions[current.term]

  const updateDecision = (patch: Partial<TermDecision>) =>
    setDecisions((prev) => ({ ...prev, [current.term]: { ...prev[current.term], ...patch } }))

  const handleSaveAll = async () => {
    setSaving(true)
    let saved = 0
    try {
      for (const term of terms) {
        const d = decisions[term.term]
        if (!d.save || !d.canonical.trim()) continue
        await saveToDictionary(term.term, d.canonical.trim(), d.category, d.notes.trim())
        saved++
      }
      qc.invalidateQueries({ queryKey: ["/api/exercise-dictionary"] })
      toast({
        title: `${saved} ${saved === 1 ? "term" : "terms"} saved to dictionary`,
        description: "AI will use these mappings in all future analyses.",
      })
      onDismiss()
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const allClassified = terms.every((t) => decisions[t.term].canonical.trim() !== "")

  return (
    <Dialog open onOpenChange={() => onDismiss()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Unknown Terms Found
          </DialogTitle>
          <DialogDescription>
            AI found {terms.length} abbreviation{terms.length > 1 ? "s" : ""} not in the Exercise Dictionary.
            Classify each one — the ones you mark &quot;Remember&quot; will be saved permanently.
          </DialogDescription>
        </DialogHeader>

        {/* Progress */}
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <div className="flex gap-1">
            {terms.map((t, i) => (
              <button
                key={t.term}
                onClick={() => setIndex(i)}
                className={`h-2 rounded-full transition-all ${
                  i === index
                    ? "w-4 bg-blue-600"
                    : decisions[t.term].canonical.trim()
                    ? "w-2 bg-green-500"
                    : "w-2 bg-gray-300"
                }`}
                title={t.term}
              />
            ))}
          </div>
          <span>{index + 1} / {terms.length}</span>
        </div>

        {/* Current term card */}
        <div className="rounded-lg border border-gray-200 p-4 space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono font-bold text-lg text-gray-900">{current.term}</span>
              <span className="text-xs text-gray-400">— seen in {current.videoIds.length} video{current.videoIds.length > 1 ? "s" : ""}</span>
            </div>
            <p className="text-xs text-gray-500 line-clamp-2">
              e.g. &quot;{current.videoTitles[0]}&quot;{current.videoTitles.length > 1 ? ` + ${current.videoTitles.length - 1} more` : ""}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700">Canonical term</label>
              <Input
                value={decision.canonical}
                onChange={(e) => updateDecision({ canonical: e.target.value })}
                className="h-8 text-xs"
                placeholder="e.g. Hook"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700">Category</label>
              <Select value={decision.category} onValueChange={(v) => updateDecision({ category: v })}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DICT_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-700">Notes (optional)</label>
            <Input
              value={decision.notes}
              onChange={(e) => updateDecision({ notes: e.target.value })}
              className="h-8 text-xs"
              placeholder="Brief description..."
            />
          </div>

          {/* Remember toggle */}
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <div
              role="checkbox"
              aria-checked={decision.save}
              onClick={() => updateDecision({ save: !decision.save })}
              className={`h-4 w-4 rounded border flex items-center justify-center transition-colors ${
                decision.save ? "bg-blue-600 border-blue-600" : "bg-white border-gray-300"
              }`}
            >
              {decision.save && <Check className="h-3 w-3 text-white" />}
            </div>
            <span className="text-xs text-gray-700">
              Remember permanently — save to Exercise Dictionary
            </span>
          </label>
        </div>

        {/* Navigation + actions */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              disabled={index === 0}
              className="h-8 px-2"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIndex((i) => Math.min(terms.length - 1, i + 1))}
              disabled={index === terms.length - 1}
              className="h-8 px-2"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onDismiss} className="h-8 text-xs">
              Skip all
            </Button>
            <Button
              size="sm"
              onClick={handleSaveAll}
              disabled={saving || !allClassified}
              className="h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white"
            >
              {saving ? "Saving..." : `Save ${terms.filter((t) => decisions[t.term]?.save).length} to Dictionary`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
