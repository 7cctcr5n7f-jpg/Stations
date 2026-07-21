"use client"

import { useState, useEffect, type ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { getQueryFn } from "@/lib/queryClient"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/toaster"

function useServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return

    let refreshing = false
    // When an UPDATED service worker takes control (not the first install),
    // reload once so the fresh SW controls the page cleanly. This is what lets
    // a stuck kiosk recover from an old/broken SW without a manual clear.
    const hadController = !!navigator.serviceWorker.controller
    const onControllerChange = () => {
      if (refreshing || !hadController) return
      refreshing = true
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange)

    let updateTimer: ReturnType<typeof setInterval> | undefined

    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        // A 24/7 room kiosk never navigates, so the browser rarely re-checks
        // sw.js on its own and can stay stuck on an old SW forever. Proactively
        // poll for updates every 30 min so fixes actually reach the boxes.
        updateTimer = setInterval(() => {
          reg.update().catch(() => {})
        }, 30 * 60 * 1000)
      })
      .catch((err) => {
        console.warn("SW registration failed:", err)
      })

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange)
      if (updateTimer) clearInterval(updateTimer)
    }
  }, [])
}

export function Providers({ children }: { children: ReactNode }) {
  useServiceWorker()

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            queryFn: getQueryFn({ on401: "throw" }),
            refetchInterval: false,
            refetchOnWindowFocus: false,
            staleTime: Number.POSITIVE_INFINITY,
            retry: false,
          },
          mutations: {
            retry: false,
          },
        },
      }),
  )

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        {children}
      </TooltipProvider>
    </QueryClientProvider>
  )
}
