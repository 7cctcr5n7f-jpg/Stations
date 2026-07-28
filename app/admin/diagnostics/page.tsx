"use client"

// TEMPORARY diagnostics panel — /admin/diagnostics
// Purpose: make it immediately obvious why some thumbnails / videos fail to
// load. Two layers:
//   1. SERVER TRUTH (S3 HeadObject via /api/admin/diagnostics/videos): does each
//      file actually exist in the bucket, its size / type / last-modified.
//   2. BROWSER REALITY (this page, run from the actual device): loads every
//      thumbnail via <img> at a chosen concurrency and records pass/fail + time.
//      Running the burst from the gym iPad reproduces the r2.dev rate limiting
//      that a server-side probe cannot see.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

type ServerRow = {
  id: number
  title: string
  videoUrl: string
  thumbnailUrl: string | null
  filename: string
  videoExt: string
  hasThumbPointer: boolean
  video: { exists: boolean; size: number | null; contentType: string | null; lastModified: string | null; cacheControl: string | null; error: string | null }
  thumb: { exists: boolean; size: number | null; contentType: string | null; lastModified: string | null; cacheControl: string | null; error: string | null }
}

type ClientResult = { ok: boolean; ms: number }

function fmtBytes(n: number | null): string {
  if (n == null) return "—"
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

function loadImage(url: string, timeoutMs = 15000): Promise<ClientResult> {
  return new Promise((resolve) => {
    const t0 = performance.now()
    const img = new Image()
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      resolve({ ok, ms: Math.round(performance.now() - t0) })
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    img.onload = () => { clearTimeout(timer); finish(true) }
    img.onerror = () => { clearTimeout(timer); finish(false) }
    // Cache-bust so the burst test measures the network, not the browser cache.
    img.src = url + (url.includes("?") ? "&" : "?") + "diag=" + Date.now() + Math.random().toString(36).slice(2)
  })
}

const CAN_PLAY_TYPES = [
  ['video/mp4; codecs="avc1.42E01E"', "H.264 (baseline)"],
  ['video/mp4; codecs="avc1.640028"', "H.264 (high)"],
  ['video/mp4; codecs="hev1.1.6.L93.B0"', "HEVC / H.265"],
  ['video/mp4', "mp4 (generic)"],
  ['video/quicktime', "MOV / quicktime"],
]

export default function DiagnosticsPage() {
  const [rows, setRows] = useState<ServerRow[]>([])
  const [summary, setSummary] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [probing, setProbing] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const [concurrency, setConcurrency] = useState(50)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [results, setResults] = useState<Record<number, ClientResult>>({})
  const [showThumbs, setShowThumbs] = useState(false)
  const cancelRef = useRef(false)

  const canPlay = useMemo(() => {
    if (typeof document === "undefined") return []
    const v = document.createElement("video")
    return CAN_PLAY_TYPES.map(([mime, label]) => ({ label, mime, result: v.canPlayType(mime) || "\"\" (no)" }))
  }, [])

  const loadServer = useCallback(async (probe: "head" | "none") => {
    setLoading(true); setErr(null); setProbing(probe === "head")
    try {
      const res = await fetch(`/api/admin/diagnostics/videos?probe=${probe}`, { cache: "no-store" })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const data = await res.json()
      setRows(data.rows)
      setSummary(data.summary ?? null)
    } catch (e: any) {
      setErr(e?.message ?? "failed")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadServer("head") }, [loadServer])

  const runBurst = useCallback(async () => {
    cancelRef.current = false
    setRunning(true); setResults({}); setProgress(0); setShowThumbs(true)
    const targets = rows.filter((r) => r.thumbnailUrl)
    let i = 0
    let done = 0
    const next: Record<number, ClientResult> = {}
    const worker = async () => {
      while (i < targets.length && !cancelRef.current) {
        const idx = i++
        const r = targets[idx]
        const out = await loadImage(r.thumbnailUrl as string)
        next[r.id] = out
        done++
        if (done % 10 === 0 || done === targets.length) {
          setProgress(done)
          setResults({ ...next })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker))
    setResults({ ...next })
    setProgress(targets.length)
    setRunning(false)
  }, [rows, concurrency])

  const clientStats = useMemo(() => {
    const vals = Object.values(results)
    const ok = vals.filter((v) => v.ok).length
    const fail = vals.filter((v) => !v.ok).length
    const avg = vals.length ? Math.round(vals.reduce((a, v) => a + v.ms, 0) / vals.length) : 0
    return { total: vals.length, ok, fail, avg }
  }, [results])

  const S = summary
  const card = "rounded-lg border bg-white px-4 py-3 text-sm"
  const big = "text-2xl font-bold"

  return (
    <div className="min-h-screen bg-gray-50 p-6 text-gray-900">
      <div className="mx-auto max-w-[1400px] space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Video &amp; Thumbnail Diagnostics</h1>
            <p className="text-sm text-gray-500">Temporary panel. Server truth (S3 HeadObject) + live browser burst test. Run the burst <b>from the failing device</b> to reproduce r2.dev rate limiting.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => loadServer("head")} disabled={loading} className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
              {loading ? "Probing…" : "Re-run server probe"}
            </button>
          </div>
        </header>

        {err && <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">Error: {err}</div>}

        {/* Server-truth summary */}
        {S && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className={card}><div className="text-gray-500">Total videos</div><div className={big}>{S.total}</div></div>
            <div className={card}><div className="text-gray-500">Thumb pointer missing</div><div className={`${big} ${S.missingThumbPointer ? "text-red-600" : "text-green-600"}`}>{S.missingThumbPointer}</div></div>
            <div className={card}><div className="text-gray-500">Thumb file missing (S3)</div><div className={`${big} ${S.thumbFileMissing ? "text-red-600" : "text-green-600"}`}>{S.thumbFileMissing}</div></div>
            <div className={card}><div className="text-gray-500">Video file missing (S3)</div><div className={`${big} ${S.videoFileMissing ? "text-red-600" : "text-green-600"}`}>{S.videoFileMissing}</div></div>
            <div className={card}><div className="text-gray-500">Thumb not image</div><div className={`${big} ${S.thumbNotJpeg ? "text-red-600" : "text-green-600"}`}>{S.thumbNotJpeg}</div></div>
            <div className={card}><div className="text-gray-500">Video not mp4</div><div className={`${big} ${S.videoNotMp4 ? "text-red-600" : "text-green-600"}`}>{S.videoNotMp4}</div></div>
          </div>
        )}

        {/* canPlayType */}
        <div className="rounded-lg border bg-white p-4">
          <h2 className="mb-2 font-semibold">This browser&apos;s <code>canPlayType()</code></h2>
          <div className="flex flex-wrap gap-2 text-xs">
            {canPlay.map((c) => (
              <span key={c.mime} className={`rounded px-2 py-1 ${c.result?.startsWith("probably") ? "bg-green-100 text-green-800" : c.result?.startsWith("maybe") ? "bg-yellow-100 text-yellow-800" : "bg-red-100 text-red-800"}`} title={c.mime}>
                {c.label}: <b>{c.result || '"" (no)'}</b>
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-500">HEVC shows &quot;probably&quot; only where the OS can decode it (Safari/macOS/iOS). A &quot;&quot; (empty) means this browser cannot play it in an HTML &lt;video&gt;.</p>
        </div>

        {/* Client burst test */}
        <div className="rounded-lg border bg-white p-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-semibold">Live thumbnail burst test (this device)</h2>
            <label className="text-sm">Concurrency:&nbsp;
              <select value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} className="rounded border px-2 py-1 text-sm" disabled={running}>
                {[4, 10, 20, 50, 100, 200, 704].map((n) => <option key={n} value={n}>{n === 704 ? "all at once" : n}</option>)}
              </select>
            </label>
            {!running ? (
              <button onClick={runBurst} disabled={!rows.length} className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Run burst test</button>
            ) : (
              <button onClick={() => { cancelRef.current = true }} className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white">Stop</button>
            )}
            <label className="ml-auto text-sm"><input type="checkbox" checked={showThumbs} onChange={(e) => setShowThumbs(e.target.checked)} /> show live thumbnails</label>
          </div>
          {(running || clientStats.total > 0) && (
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              <span className="rounded bg-gray-100 px-2 py-1">Progress: <b>{progress}</b> / {rows.filter(r => r.thumbnailUrl).length}</span>
              <span className="rounded bg-green-100 px-2 py-1 text-green-800">Loaded: <b>{clientStats.ok}</b></span>
              <span className="rounded bg-red-100 px-2 py-1 text-red-800">Failed: <b>{clientStats.fail}</b></span>
              <span className="rounded bg-gray-100 px-2 py-1">Avg: <b>{clientStats.avg} ms</b></span>
              {clientStats.total > 0 && <span className="rounded bg-yellow-100 px-2 py-1 text-yellow-900">Failure rate: <b>{Math.round((clientStats.fail / clientStats.total) * 100)}%</b></span>}
            </div>
          )}
          <p className="mt-2 text-xs text-gray-500">Each thumbnail is cache-busted so this measures the network. A high failure rate at high concurrency = r2.dev rate limiting (HTTP 429). Try &quot;4&quot; vs &quot;all at once&quot; to see the difference.</p>
        </div>

        {/* Table */}
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-left text-xs">
            <thead className="border-b bg-gray-50 text-gray-600">
              <tr>
                <th className="p-2">#</th>
                {showThumbs && <th className="p-2">Live</th>}
                <th className="p-2">Title</th>
                <th className="p-2">Client load</th>
                <th className="p-2">Thumb (S3)</th>
                <th className="p-2">Thumb type / size</th>
                <th className="p-2">Video (S3)</th>
                <th className="p-2">Video type / size</th>
                <th className="p-2">Ext</th>
                <th className="p-2">Thumb last-modified</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => {
                const cr = results[r.id]
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="p-2 text-gray-400">{r.id}</td>
                    {showThumbs && (
                      <td className="p-2">
                        {r.thumbnailUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.thumbnailUrl} alt="" className="h-8 w-11 rounded object-cover bg-gray-100" loading="lazy" decoding="async" />
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                    )}
                    <td className="p-2 max-w-[220px] truncate font-medium" title={r.title}>{r.title}</td>
                    <td className="p-2">
                      {cr ? (cr.ok ? <span className="text-green-600">✓ {cr.ms}ms</span> : <span className="text-red-600 font-semibold">✗ fail</span>) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="p-2">{!r.hasThumbPointer ? <span className="text-red-600">no pointer</span> : r.thumb.exists ? <span className="text-green-600">✓</span> : <span className="text-red-600 font-semibold" title={r.thumb.error ?? ""}>missing</span>}</td>
                    <td className="p-2 text-gray-500">{r.thumb.contentType ?? "—"} · {fmtBytes(r.thumb.size)}</td>
                    <td className="p-2">{r.video.exists ? <span className="text-green-600">✓</span> : <span className="text-red-600 font-semibold" title={r.video.error ?? ""}>missing</span>}</td>
                    <td className="p-2 text-gray-500">{r.video.contentType ?? "—"} · {fmtBytes(r.video.size)}</td>
                    <td className="p-2 uppercase text-gray-500">{r.videoExt}</td>
                    <td className="p-2 text-gray-400">{r.thumb.lastModified?.slice(0, 10) ?? "—"}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {probing && loading && <p className="text-sm text-gray-500">Probing {rows.length || ""} files via S3 HeadObject…</p>}
      </div>
    </div>
  )
}
