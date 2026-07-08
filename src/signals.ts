// Client-side signal helpers. Angle/priority/counts come from the DB (Rust
// computes them — single source of truth). This module only handles what needs
// the browser: DST-correct call windows via Intl, display chips, landmines.
import type { Lead } from "./types";

export const ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
];

export function localHour(tz: string): number {
  try {
    return parseInt(
      new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(new Date()),
      10
    ) % 24;
  } catch {
    return new Date().getHours();
  }
}

export const inWindow = (tz: string, start = 8, end = 18) => {
  const h = localHour(tz);
  return h >= start && h < end;
};

/** zone → priority bonus map, passed to query_leads so SQL sorts in-window first. */
export function zoneBonus(): Record<string, number> {
  const m: Record<string, number> = {};
  for (const z of ZONES) m[z] = inWindow(z) ? 120 : 0;
  return m;
}

export const ANGLE_LABEL: Record<string, string> = {
  RS: "Rescue",
  RW: "Renewal wire",
  NA: "New authority",
  PL: "Per-load",
  GEN: "General",
  PARTNER: "Partner",
};

export interface Landmine {
  level: "red" | "amber";
  text: string;
}

const DECLINE_EQUIP = /(tow|bus|passenger|livestock|garbage|waste|refuse|log|household|hhg|oilfield|moving)/i;

/** Corgi appetite landmines, computed pre-dial from the row. */
export function landmines(l: Lead): Landmine[] {
  const out: Landmine[] = [];
  if (l.kind !== "fleet") return out;
  if (l.units > 100) out.push({ level: "red", text: `${l.units} units — DECLINE (>100), don't book` });
  else if (l.units > 10) out.push({ level: "amber", text: `${l.units} units — manual review; set AE expectations` });
  if ((l.hazmat || "").toUpperCase().startsWith("Y") || (l.hazmat || "").toUpperCase() === "X")
    out.push({ level: "amber", text: "Hazmat — confirm class; 1/7 = hard decline" });
  const sr = (l.safety_rating || "").toLowerCase();
  if (sr.includes("conditional") || sr.includes("unsat"))
    out.push({ level: "amber", text: `Safety rating ${l.safety_rating} — CSA landmine` });
  if (l.authority_months !== null && l.authority_months < 12)
    out.push({ level: "amber", text: "New venture <12mo — no loss runs, bring competing quotes" });
  if (DECLINE_EQUIP.test(l.equipment || "")) out.push({ level: "red", text: `Equipment "${l.equipment}" — likely decline class` });
  const drivers = parseInt(l.drivers || "0", 10);
  if (drivers === 1 && parseInt(l.mileage || "0", 10) > 150000)
    out.push({ level: "amber", text: "1 driver, high miles — one-driver-most-miles flag" });
  return out;
}

export function daysUntil(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr.length === 10 ? dateStr + "T12:00:00" : dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - Date.now()) / 86400000);
}

export const fmtMoney = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export const joinLoc = (...parts: Array<string | undefined>) => parts.filter((p) => p && p.trim()).join(", ");

export function render(tpl: string, l: Lead): string {
  const first = (l.owner || "").split(" ")[0] || "there";
  const month = l.est_renewal
    ? new Date(l.est_renewal + "T12:00:00").toLocaleString("en-US", { month: "long" })
    : "your renewal month";
  return tpl
    .replace(/\{name\}/g, first)
    .replace(/\{company\}/g, l.company || "your company")
    .replace(/\{agency\}/g, l.company || "your agency")
    .replace(/\{month\}/g, month)
    .replace(/\{units\}/g, String(l.units || "your fleet"))
    .replace(/\{me\}/g, "I");
}

export const BENCH = { dials: 90, connectRate: 0.17, meetings: 2.5 };

export function isToday(iso: string): boolean {
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}
