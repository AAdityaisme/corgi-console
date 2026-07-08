import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Shell } from "../App";
import { listTable, logRevive, readIntel } from "../api";
import type { Activity, IntelEvent } from "../types";
import { fmtTime } from "../signals";

// FMCSA-verified identities for the abandon queue (looked up 2026-07-06)
const FMCSA: Record<string, { name: string; st: string }> = {
  "4047955": { name: "GTS Express Inc", st: "OK" },
  "4257662": { name: "Provision Services LLC", st: "CA" },
  "342515": { name: "BMC East LLC", st: "NC" },
  "4508637": { name: "OTRTravelHaulCo LLC", st: "CA" },
  "2537016": { name: "VKA Express Inc", st: "IL" },
  "4109069": { name: "Jehro Ventures LLC", st: "NJ" },
  "4308909": { name: "Sargut LLC", st: "IL" },
  "3134118": { name: "RHS Trucking LLC", st: "TX" },
  "3098318": { name: "Rooks Logistics LLC", st: "OH" },
  "4045560": { name: "GTElectric", st: "CA" },
  "2395238": { name: "Dedicated LLC", st: "WA" },
  "3938564": { name: "Faith In Transit LLC", st: "OR" },
};

const SCRIPT: Record<string, { say: string; then: string }> = {
  review: {
    say: "Hi, this is Corgi Insurance — trucking only. You ran a quote with us a couple weeks back and stopped right at the last screen — was it the number, or just not renewal time yet?",
    then: "Price → 'What are you paying now? Let me see what underwriting can do.' Timing → lock the exact renewal date, set 45-day callback. Either way: 'If we wrap by 3:30 Pacific you'll have your number today.'",
  },
  form: {
    say: "Hi, this is Corgi Insurance — trucking only. You started a quote with us and it never got finished — that step asks for stuff most people don't have handy. Grab me your driver list and I'll do the rest on my end.",
    then: "Offer to finish it FOR them on the phone right now. 'Takes five minutes with me driving. If we're done by 3:30 Pacific, the number comes back today.'",
  },
};
const scriptFor = (step: string) =>
  /review|rating/.test(step) ? SCRIPT.review : SCRIPT.form;

const OUTCOMES = [
  ["RESUMED", "Resumed quote", "partner"],
  ["CB", "Callback set", "rw"],
  ["NA", "No answer", "cold"],
  ["NI", "Not interested", "cold"],
  ["DEAD", "Dead number", "hot"],
] as const;

export default function Revive({ s }: { s: Shell }) {
  const [events, setEvents] = useState<IntelEvent[]>([]);
  const [worked, setWorked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [start] = useState(Date.now());
  const [done, setDone] = useState(0);

  useEffect(() => {
    readIntel(365).then((b) => setEvents(b.events)).catch(() => {});
    listTable<Activity>("activities").then((acts) => {
      const w = new Set<string>();
      for (const a of acts) {
        try {
          const m = JSON.parse(a.meta || "{}");
          if (m.src === "revive" && m.dot) w.add(m.dot);
        } catch { /* skip */ }
      }
      setWorked(w);
    }).catch(() => {});
  }, [s.bump]);

  const queue = useMemo(() => {
    const isJunk = (e: IntelEvent) =>
      !e.dot || e.dot.length < 6 || new Set(e.dot).size <= 2 || /^1234567/.test(e.dot) ||
      /example\.com/.test(e.email || "") || /^\+1\d{3}555\d{4}$/.test((e.phone || "").replace(/\s/g, "")) ||
      !/^\+1\d{10}$/.test((e.phone || "").replace(/\s/g, ""));
    const progressed = (e: IntelEvent) =>
      events.some((o) => o.kind !== "abandoned" && o.dot === e.dot && o.ts > e.ts);
    const byDot = new Map<string, IntelEvent>();
    for (const e of events) {
      if (e.kind !== "abandoned" || isJunk(e) || e.called || e.bad || progressed(e) || worked.has(e.dot)) continue;
      const prev = byDot.get(e.dot);
      if (!prev || e.ts > prev.ts) byDot.set(e.dot, e);
    }
    // review-step bails first, then most recent
    return [...byDot.values()].sort((a, b) => {
      const ar = /review/.test(a.last_step) ? 0 : 1;
      const br = /review/.test(b.last_step) ? 0 : 1;
      return ar - br || (b.ts || "").localeCompare(a.ts || "");
    });
  }, [events, worked]);

  const e = queue[0];
  const total = queue.length + done;

  async function commit(outcome: string) {
    if (!e) return;
    try {
      await logRevive(e.dot, e.phone, outcome === "RESUMED" ? "DM" : outcome === "DEAD" ? "NI" : outcome,
        `${outcome}${note ? " — " + note : ""}`, e.last_step || "");
    } catch { return; }
    setWorked((w) => new Set(w).add(e.dot));
    setDone((d) => d + 1);
    setNote("");
    toast.success(`Logged — now 👍 the alert in Telegram`, { duration: 5000 });
  }

  const mins = Math.round((Date.now() - start) / 60000);

  if (!e)
    return (
      <div className="wrap-pad">
        <div className="today-hero">
          <h1 className="display">{done ? `Sprint done. ${done} worked in ${mins}min.` : "Revive queue is empty."}</h1>
          <p className="lead">{done ? "Send Drew the one-liner: worked all of them — X reached, Y resumed." : "New abandons appear here after telegram sync."}</p>
        </div>
      </div>
    );

  const id = FMCSA[e.dot];
  const sc = scriptFor(e.last_step || "");

  return (
    <div className="wrap-pad">
      <div className="sprint" style={{ marginBottom: 18 }}>
        <span className="big">{done}/{total}</span><span className="lbl">worked</span>
        <span className="big">{mins}m</span><span className="lbl">elapsed</span>
        <span className="spacer" />
        <span style={{ color: "#fff", fontSize: 13 }}>after each call: 👍 the alert in Telegram</span>
      </div>

      <section className="card">
        <div className="cockpit-head">
          <h1>{id ? id.name : `DOT ${e.dot}`}</h1>
          <span className="chip rs">abandoned quote</span>
          <span className="rec">{id ? `${id.st} · ` : ""}bailed at {(e.last_step || "?").replace(/_/g, " ")} · {e.ts ? fmtTime(e.ts) : ""}</span>
        </div>

        <div className="phone-line">
          <span className="phone-num">{e.phone}</span>
          <button className="btn util" onClick={() => {
            navigator.clipboard?.writeText(e.phone.replace(/\D/g, "").slice(-10));
            toast.success("Number copied");
          }}>Copy #</button>
          {e.email && <span className="dim">{e.email}</span>}
          <button className="link" onClick={() => openUrl(`https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=USDOT&query_string=${e.dot}`)}>SAFER ↗</button>
        </div>

        <div className="flow" style={{ marginTop: 16 }}>
          <div className="flow-step">
            <span className="flow-k">SAY</span>
            <p className="opener big-say">"{sc.say}"</p>
          </div>
          <div className="flow-step">
            <span className="flow-k">THEN</span>
            <p className="flow-then">{sc.then}</p>
          </div>
          <div className="flow-step">
            <span className="flow-k">GOAL</span>
            <p className="flow-then">Resume the quote before the next UW pass (11am / 4pm PT) — or lock the exact renewal date. They already wanted this — you're finishing, not selling.</p>
          </div>
        </div>

        <div className="row" style={{ marginTop: 16, gap: 8 }}>
          <input placeholder="note (what stopped them, renewal date…)" value={note} onChange={(ev) => setNote(ev.target.value)} style={{ flex: 1 }} />
        </div>
        <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
          {OUTCOMES.map(([code, label, cls]) => (
            <button key={code} className={`pill ${cls}`} onClick={() => commit(code)}>{label}</button>
          ))}
        </div>
      </section>
    </div>
  );
}
