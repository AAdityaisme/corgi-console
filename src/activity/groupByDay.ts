// Group timestamped items into day buckets, newest day first.
// Adapted from Twenty's groupEventsByMonth (month→day for a high-velocity dial log).
// Caller is responsible for sorting items within the input (usually ts DESC).

export interface DayGroup<T> {
  day: string; // YYYY-MM-DD
  label: string; // "Today" | "Yesterday" | "Mon Jul 3" | "Jul 3 2025"
  items: T[];
}

function labelForDay(dayIso: string): string {
  const d = new Date(dayIso + "T12:00:00");
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString("en-US", {
    weekday: sameYear ? "short" : undefined,
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
}

// Local calendar day of a (UTC) timestamp — NOT ts.slice(0,10), which is the UTC day and
// would file a 6pm-PT call (stored next-day 01:00Z) under tomorrow. Operator lives in local time.
function localDayKey(ts: string): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function groupByDay<T extends { ts: string }>(items: T[]): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const item of items) {
    const day = localDayKey(item.ts);
    const match = groups.find((g) => g.day === day);
    if (match) match.items.push(item);
    else groups.push({ day, label: labelForDay(day), items: [item] });
  }
  return groups.sort((a, b) => (a.day < b.day ? 1 : -1)); // newest day first
}
