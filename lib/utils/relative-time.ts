import { format } from "date-fns";

export function formatRefreshTime(dateValue?: Date | string | null) {
  if (!dateValue) return "Never";
  const date = typeof dateValue === "string" ? new Date(dateValue) : dateValue;
  if (Number.isNaN(date.getTime())) return "Never";
  const deltaMs = Date.now() - date.getTime();
  if (deltaMs <= 15_000) return "within 15 seconds";
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds <= 90) return "minute ago";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 5) return "couple minutes ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 2) return "hour ago";
  if (hours < 3) return "couple hours ago";
  if (hours < 12) return `${hours} hours ago`;
  return format(date, "MMM d, yyyy h:mm a");
}
