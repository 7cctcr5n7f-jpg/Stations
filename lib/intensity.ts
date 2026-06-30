// Shared heart-rate / intensity mapping used by the Library and Schedule views.
// Intensity drives the Green / Amber / Red heart-rate zone colour.

export type IntensityLevel = "Low" | "Medium" | "High"

export const INTENSITY_LEVELS: IntensityLevel[] = ["Low", "Medium", "High"]

export interface IntensityStyle {
  label: string
  zone: string // Green / Amber / Red / Unset
  // Tailwind classes for chips/badges
  badge: string
  // Solid dot/indicator colour
  dot: string
}

const STYLES: Record<string, IntensityStyle> = {
  Low: {
    label: "Low",
    zone: "Green",
    badge: "bg-green-100 text-green-800 border border-green-200",
    dot: "bg-green-500",
  },
  Medium: {
    label: "Medium",
    zone: "Amber",
    badge: "bg-amber-100 text-amber-800 border border-amber-200",
    dot: "bg-amber-500",
  },
  High: {
    label: "High",
    zone: "Red",
    badge: "bg-red-100 text-red-800 border border-red-200",
    dot: "bg-red-500",
  },
}

const UNSET_STYLE: IntensityStyle = {
  label: "Unset",
  zone: "Unset",
  badge: "bg-gray-100 text-gray-500 border border-gray-200",
  dot: "bg-gray-400",
}

export function getIntensityStyle(intensity?: string | null): IntensityStyle {
  if (!intensity) return UNSET_STYLE
  return STYLES[intensity] ?? UNSET_STYLE
}
