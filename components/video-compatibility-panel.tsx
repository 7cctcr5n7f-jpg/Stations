"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { MonitorPlay, RefreshCw, ScanLine, Wand2, AlertTriangle, CheckCircle2 } from "lucide-react"

type Stats = {
  total: number
  scanned: number
  unscanned: number
  compatible: number
  incompatible: number
  codecs: { codec: string; count: number }[]
}

const POST = (body: unknown) =>
  fetch("/api/admin/optimize-videos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (r) => {
    if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `HTTP ${r.status}`)
    return r.json()
  })

export default function VideoCompatibilityPanel() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [busy, setBusy] = useState<null | "scan" | "convert">(null)
  const [progress, setProgress] = useState<string>("")
  const [log, setLog] = useState<string[]>([])
  const cancelRef = useRef(false)

  const loadStats = useCallback(async () => {
    try {
      setStats(await POST({ action: "codec-stats" }))
    } catch (e) {
      console.error("[v0] codec-stats failed:", e)
    }
  }, [])

  useEffect(() => {
    loadStats()
  }, [loadStats])

  const pushLog = (line: string) => setLog((prev) => [line, ...prev].slice(0, 30))

  const runScan = async () => {
    setBusy("scan")
    cancelRef.current = false
    setLog([])
    try {
      let remaining = 1
      let totalScanned = 0
      while (remaining > 0 && !cancelRef.current) {
        const res = await POST({ action: "scan-codecs", limit: 40 })
        totalScanned += res.scanned
        remaining = res.remaining
        setProgress(`Scanned ${totalScanned}… ${remaining} remaining`)
        await loadStats()
      }
      pushLog(cancelRef.current ? "Scan stopped." : "Scan complete.")
    } catch (e: any) {
      pushLog(`Scan error: ${e.message}`)
    } finally {
      setBusy(null)
      setProgress("")
    }
  }

  const runConvert = async () => {
    if (!confirm("Convert all TV-incompatible videos to H.264? Original files are replaced. This can take a while.")) return
    setBusy("convert")
    cancelRef.current = false
    setLog([])
    try {
      let remaining = 1
      let done = 0
      while (remaining > 0 && !cancelRef.current) {
        const res = await POST({ action: "convert-incompatible", limit: 3 })
        remaining = res.remaining
        for (const r of res.results ?? []) {
          done += r.status === "converted" ? 1 : 0
          pushLog(
            r.status === "converted"
              ? `Converted "${r.title}" (${r.from} -> h264, ${r.beforeMB}MB -> ${r.afterMB}MB)`
              : `"${r.title}": ${r.status}`,
          )
        }
        setProgress(`Converted ${done}… ${remaining} remaining`)
        await loadStats()
        if ((res.results ?? []).length === 0) break
      }
      pushLog(cancelRef.current ? "Conversion stopped." : "Conversion complete.")
    } catch (e: any) {
      pushLog(`Conversion error: ${e.message}`)
    } finally {
      setBusy(null)
      setProgress("")
    }
  }

  const incompatible = stats?.incompatible ?? 0
  const compatible = stats?.compatible ?? 0
  const unscanned = stats?.unscanned ?? 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MonitorPlay className="h-5 w-5" />
          <span>Room Display Compatibility</span>
        </CardTitle>
        <CardDescription>
          Android TV boxes can only play H.264 (8-bit) video. HEVC/H.265 and 10-bit clips show
          &quot;video not loaded&quot; on the room displays even though they play on a laptop. Scan the
          library, then convert any incompatible videos to H.264.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="text-center p-4 bg-muted rounded-lg">
            <div className="text-2xl font-bold">{stats?.total ?? "—"}</div>
            <div className="text-sm text-muted-foreground">Total Videos</div>
          </div>
          <div className="text-center p-4 bg-muted rounded-lg">
            <div className="text-2xl font-bold text-emerald-600">{compatible}</div>
            <div className="text-sm text-muted-foreground">TV Compatible</div>
          </div>
          <div className="text-center p-4 bg-muted rounded-lg">
            <div className="text-2xl font-bold text-red-600">{incompatible}</div>
            <div className="text-sm text-muted-foreground">Incompatible</div>
          </div>
          <div className="text-center p-4 bg-muted rounded-lg">
            <div className="text-2xl font-bold text-amber-600">{unscanned}</div>
            <div className="text-sm text-muted-foreground">Not Scanned</div>
          </div>
        </div>

        {/* Status banner */}
        {stats && unscanned === 0 && incompatible === 0 && stats.total > 0 && (
          <div className="flex items-center gap-2 p-3 bg-emerald-50 text-emerald-800 rounded-lg">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
            <span className="text-sm font-medium">All videos are H.264 and ready to play on the room displays.</span>
          </div>
        )}
        {incompatible > 0 && (
          <div className="flex items-center gap-2 p-3 bg-red-50 text-red-800 rounded-lg">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span className="text-sm font-medium">
              {incompatible} video{incompatible === 1 ? "" : "s"} won&apos;t play on the room displays. Convert them to fix it.
            </span>
          </div>
        )}

        {/* Codec breakdown */}
        {stats && stats.codecs?.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {stats.codecs.map((c) => (
              <Badge key={c.codec} variant={c.codec === "h264" ? "default" : "destructive"}>
                {c.codec}: {c.count}
              </Badge>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <Button onClick={loadStats} variant="outline" size="sm" disabled={!!busy}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button onClick={runScan} variant="outline" size="sm" disabled={!!busy}>
            <ScanLine className={`h-4 w-4 mr-2 ${busy === "scan" ? "animate-pulse" : ""}`} />
            {busy === "scan" ? "Scanning…" : "Scan Library"}
          </Button>
          <Button
            onClick={runConvert}
            size="sm"
            disabled={!!busy || incompatible === 0}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Wand2 className={`h-4 w-4 mr-2 ${busy === "convert" ? "animate-spin" : ""}`} />
            {busy === "convert" ? "Converting…" : `Convert ${incompatible || ""} to H.264`}
          </Button>
          {busy && (
            <Button onClick={() => (cancelRef.current = true)} variant="destructive" size="sm">
              Stop
            </Button>
          )}
        </div>

        {progress && <div className="text-sm text-muted-foreground">{progress}</div>}

        {/* Log */}
        {log.length > 0 && (
          <div className="max-h-48 overflow-y-auto rounded-lg bg-muted p-3 text-xs font-mono space-y-1">
            {log.map((l, i) => (
              <div key={i} className="text-muted-foreground">
                {l}
              </div>
            ))}
          </div>
        )}

        <div className="text-xs text-muted-foreground">
          Converted videos are re-encoded to H.264 8-bit, 30fps, up to 1080p with fast-start, and get a new
          storage URL so cached devices always fetch the compatible copy.
        </div>
      </CardContent>
    </Card>
  )
}
