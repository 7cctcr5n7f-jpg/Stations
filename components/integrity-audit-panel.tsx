"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { AlertCircle, CheckCircle2, Loader2, ShieldCheck } from "lucide-react"

type IntegrityAuditResult = {
  generatedAt: string
  summary: Record<string, number>
  orphanedSchedules: Array<Record<string, unknown>>
  danglingRoomAssignments: Array<Record<string, unknown>>
  invalidVideoUrls: Array<Record<string, unknown>>
  invalidThumbnailUrls: Array<Record<string, unknown>>
  missingThumbnails: Array<Record<string, unknown>>
  missingR2VideoObjects: Array<Record<string, unknown>>
  missingR2ThumbnailObjects: Array<Record<string, unknown>>
  duplicateExerciseTitles: Array<Record<string, unknown>>
}

const ISSUE_KEYS: Array<{ key: keyof IntegrityAuditResult["summary"]; label: string }> = [
  { key: "orphanedSchedules", label: "Orphaned schedules" },
  { key: "danglingRoomAssignments", label: "Dangling room assignments" },
  { key: "invalidVideoUrls", label: "Invalid video URLs" },
  { key: "invalidThumbnailUrls", label: "Invalid thumbnail URLs" },
  { key: "missingThumbnails", label: "Missing thumbnails" },
  { key: "missingR2VideoObjects", label: "Missing R2 video objects" },
  { key: "missingR2ThumbnailObjects", label: "Missing R2 thumbnail objects" },
  { key: "duplicateExerciseTitles", label: "Duplicate exercise titles" },
]

export function IntegrityAuditPanel() {
  const [result, setResult] = useState<IntegrityAuditResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)

  const runAudit = async () => {
    try {
      setIsRunning(true)
      setError(null)
      const response = await fetch("/api/integrity-audit", { credentials: "include" })
      const body = await response.json()
      if (!response.ok) {
        throw new Error(body?.error || "Failed to run audit")
      }
      setResult(body)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run audit")
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Integrity Audit
          </CardTitle>
          <p className="text-sm text-gray-500">
            Reports production data and asset issues without modifying any records.
          </p>
        </div>
        <Button onClick={runAudit} disabled={isRunning}>
          {isRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Run audit
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {result ? (
          <>
            <p className="text-sm text-gray-500">
              Last run: {new Date(result.generatedAt).toLocaleString()}
            </p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {ISSUE_KEYS.map(({ key, label }) => {
                const count = result.summary[key] ?? 0
                const passed = count === 0
                return (
                  <div
                    key={key}
                    className={`rounded-lg border px-4 py-3 ${
                      passed ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"
                    }`}
                  >
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {passed ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-amber-600" />
                      )}
                      <span>{label}</span>
                    </div>
                    <div className="mt-2 text-2xl font-bold">{count}</div>
                  </div>
                )
              })}
            </div>
            <div className="space-y-3">
              {ISSUE_KEYS.map(({ key, label }) => {
                const count = result.summary[key] ?? 0
                if (count === 0) return null
                const issues = result[key as keyof IntegrityAuditResult] as Array<Record<string, unknown>>
                return (
                  <div key={key} className="rounded-lg border border-gray-200 bg-white p-4">
                    <h4 className="font-medium">{label}</h4>
                    <pre className="mt-2 max-h-48 overflow-auto rounded bg-gray-50 p-3 text-xs">
                      {JSON.stringify(issues, null, 2)}
                    </pre>
                  </div>
                )
              })}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
