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
  
  if (diffDays > 0) return `Used ${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  if (diffHours > 0) return `Used ${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffMinutes > 0) return `Used ${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`;
  return "Used just now";
}

export function getDayOfWeek(): string {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return days[new Date().getDay()];
}

export function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
