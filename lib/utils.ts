import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getRoomColorClasses(roomNumber: number) {
  const colorClass = `room-color-${roomNumber}`;
  const borderClass = `room-border-${roomNumber}`;
  const bgClass = `room-bg-${roomNumber}`;
  
  return { colorClass, borderClass, bgClass };
}

export function formatTimeAgo(date: Date | string | null): string {
  if (!date) return "Never used";
  
  const now = new Date();
  const past = new Date(date);
  const diffMs = now.getTime() - past.getTime();
  
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  
  if (diffWeeks > 0) return `Used ${diffWeeks} week${diffWeeks > 1 ? 's' : ''} ago`;
  if (diffDays > 0) return `Used ${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  if (diffHours > 0) return `Used ${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffMinutes > 0) return `Used ${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`;
  return "Used just now";
}

/** Compact single-token version: show weeks for 7+ days, otherwise "35d", "2h", "5m", "now", "–" */
export function formatTimeAgoShort(date: Date | string | null): string {
  if (!date) return "–"
  const diffMs = Date.now() - new Date(date).getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)
  const diffWeeks = Math.floor(diffDays / 7)
  if (diffWeeks > 0) return `${diffWeeks}w`
  if (diffDays > 0) return `${diffDays}d`
  if (diffHours > 0) return `${diffHours}h`
  if (diffMinutes > 0) return `${diffMinutes}m`
  return "now"
}

export function getDayOfWeek(): string {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return days[new Date().getDay()];
}

export function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
