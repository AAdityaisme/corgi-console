import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { Shell } from "../App";
import { listTable, readDoc, readIntel, refreshTelegram } from "../api";
import type { Activity, IntelBundle, IntelEvent } from "../types";
import { fmtTime } from "../signals";

const META: Record<string, { label: string; cls: string }> = {
  abandoned: { label: "Abandoned", cls: "hot" },
  sla: { label: "SLA breach", cls: "hot" },
  cancelled: { label: "Cancelled", cls: "hot" },
  bound: { label: "Bound", cls: "partner" },
  quoted: { label: "Quoted", cls: "partner" },
  manual_review: { label: "Manual review", cls: "rw" },
  prequote: { label: "Prequote", cls: "cold" },
  declined: { label: "Declined", cls: "cold" },
};

export default function Intel({ s }: { s: Shell }) {
  const [bundle, setBundle] = useState<IntelBundle | null>(null);
  const [acts, setActs] = useState<Activity[]>([]);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"queue" | "feed" | "kb">("queue");
  const [kbDigest, setKbDigest] = useState<string>("");
  const [loadErr, setLoadErr] = useState(false);

  const load = () => {
    readIntel(365).then(setBundle).catch(() => setLoadErr(true));
    listTable<Activity>("activities").then(setActs).catch(() => {});
    readDoc("telegram/kb/digests/Trucking_-1003926206326.md").then(setKbDigest).catch(() => {});
  };
  useEffect(load, [s.bump]);

  const events = bundle?.events ?? [];
  const calledPhones = useMemo(
    () => new Set(acts.map((a) => { try { return JSON.parse(a.meta || "{}").phone || ""; } catch { return ""; } }).filter(Boolean)),
    [acts]
  );

  const abandoned = useMemo(() => {
    const isJunk = (e: IntelEvent) =>
      !e.dot || e.dot.length < 6 || new Set(e.dot).size <= 2 || /^1234567/.test(e.dot) ||
      /example\.com/.test(e.email || "") || /^\+1\d{3}555\d{4}$/.test((e.phone || "").replace(/\s/g, "")) ||
      !/^\+1\d{10}$/.test((e.phone || "").replace(/\s/g, ""));
    const cand = events.filter((e) => e.kind === "abandoned" && !isJunk(e) && !e.called && !e.bad && !calledPhones.has(e.phone));
    // resumed later (manual review / quoted / prequote after the abandon) = not actually lost
    const progressed = (e: IntelEvent) =>
      events.some((o) => o.kind !== "abandoned" && o.dot === e.dot && o.ts > e.ts);
    const byDot = new Map<string, IntelEvent>();
    for (const e of cand) if (!progressed(e)) {
      const prev = byDot.get(e.dot);
      if (!prev || e.ts > prev.ts) byDot.set(e.dot, e);
    }
    return [...byDot.values()].sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));
  }, [events, calledPhones]);
  const cancellations = events.filter((e) => e.kind === "cancelled");
  const sla = events.filter((e) => e.kind === "sla");

  async function refresh() {
    setBusy(true);
    try {
      await refreshTelegram(14);
      load();
      toast.success("Telegram refreshed");
    } catch { /* toasted */ } finally { setBusy(false); }
  }

  const dhirajDraft = (e: IntelEvent) => {
    const text = `@dhirajtourani heads up — ${e.company || "DOT " + e.dot} cancelled (${e.extra || e.ts?.slice(0, 10)}). Flagging before it shows in federal filings.`;
    navigator.clipboard?.writeText(text).then(() => toast.success("Dhiraj alert copied — paste in Trucking chat"));
  };

  const age = bundle?.source_mtime ? Math.round((Date.now() / 1000 - parseInt(bundle.source_mtime)) / 3600) : null;

  return (
    <div className="wrap-pad">
      <div className="toolbar">
        <button className={tab === "queue" ? "pill on" : "pill"} onClick={() => setTab("queue")}>Work queue</button>
        <button className={tab === "feed" ? "pill on" : "pill"} onClick={() => setTab("feed")}>Event feed ({events.length})</button>
        <button className={tab === "kb" ? "pill on" : "pill"} onClick={() => setTab("kb")}>Floor digest (KB)</button>
        <span className="spacer" />
        {age !== null && <span className="dim">source {age}h old</span>}
        <button className="btn primary sm" disabled={busy} onClick={refresh}>{busy ? "Refreshing…" : "⟳ Refresh telegram"}</button>
      </div>

      {bundle === null && !loadErr && <p className="dim pad">Loading intel…</p>}
      {loadErr && <p className="pad" style={{ color: "var(--hot)" }}>Couldn't read the telegram export — run refresh or check tg-export.</p>}

      {bundle && tab === "queue" && (
        <div className="grid3" style={{ alignItems: "start" }}>
          <section className="card">
            <div className="section-head">Abandoned quotes · all-time · verified</div>
            <p className="dim" style={{ fontSize: 12, marginBottom: 8 }}>Real, unworked, uncalled. Phones verified against FMCSA.</p>
            {abandoned.map((e, i) => <Abandoned key={i} e={e} />)}
            {abandoned.length === 0 && <p className="dim pad">None unworked in window.</p>}
          </section>
          <section className="card">
            <div className="section-head">Cancellations → Dhiraj</div>
            <p className="dim" style={{ fontSize: 12, marginBottom: 8 }}>Tell him before federal filings do — instant credibility.</p>
            {cancellations.map((e, i) => (
              <div key={i}>
                <Evt e={e} />
                <button className="link" onClick={() => dhirajDraft(e)}>copy Dhiraj alert →</button>
              </div>
            ))}
            {cancellations.length === 0 && <p className="dim pad">None in window.</p>}
          </section>
          <section className="card">
            <div className="section-head">SLA breaches</div>
            {sla.map((e, i) => <Evt key={i} e={e} />)}
            {sla.length === 0 && <p className="dim pad">None in window.</p>}
          </section>
        </div>
      )}

      {tab === "kb" && (
        <section className="card">
          <div className="section-head">Trucking chat — current state (regenerated daily 18:15 by the KB pipeline)</div>
          {kbDigest ? <pre className="pre mt" style={{ fontSize: 13, fontFamily: "var(--font)" }}>{kbDigest}</pre> : <p className="dim pad">No digest yet — run the KB update.</p>}
        </section>
      )}

      {bundle && tab === "feed" && (
        <section className="card">
          <div className="section-head">Bot event feed · full history</div>
          <div className="mt">
            {events.map((e, i) => <Evt key={i} e={e} />)}
            {events.length === 0 && <p className="dim pad">No events — hit refresh.</p>}
          </div>
        </section>
      )}
    </div>
  );
}

function routing(e: IntelEvent) {
  const p = (e.partner || "").trim();
  const b = (e.broker || "").trim();
  if (b && b.toLowerCase() !== "direct") return { label: `Broker · ${b}`, cls: "rw" };
  if (p && p.toLowerCase() !== "direct" && p.toLowerCase() !== "n/a" && p !== "(not provided)") {
    const isMga = /mga/i.test(p);
    return { label: `${isMga ? "MGA" : "Partner"} · ${p}`, cls: "na" };
  }
  return { label: "Direct", cls: "partner" };
}

function Abandoned({ e }: { e: IntelEvent }) {
  const r = routing(e);
  return (
    <div className="evt abn">
      <div className="abn-top">
        <span className={`chip ${r.cls}`}>{r.label}</span>
        {e.source && <span className="chip cold">{e.source}</span>}
        <span className="dim">DOT {e.dot || "—"}</span>
        <span className="spacer" />
        <span className="dim">{e.ts ? fmtTime(e.ts) : ""}</span>
      </div>
      <div className="abn-mid">
        {e.phone && <b className="ph">{e.phone}</b>}
        {e.email && <span className="dim">{e.email}</span>}
        {e.last_step && <span className="chip rw">bailed at: {e.last_step.replace(/_/g, " ")}</span>}
      </div>
    </div>
  );
}

function Evt({ e }: { e: IntelEvent }) {
  const m = META[e.kind] ?? { label: e.kind, cls: "cold" };
  return (
    <div className="evt">
      <span className={`chip ${m.cls}`}>{m.label}</span>
      <span className="co">{e.company || "—"}</span>
      <span className="dim">DOT {e.dot || "—"}</span>
      {e.premium && <span className="prem">{e.premium}</span>}
      {e.phone && <b className="ph">{e.phone}</b>}
      {e.extra && <span className="dim">{e.extra}</span>}
      <span className="spacer" />
      <span className="dim">{e.ts ? fmtTime(e.ts) : ""}</span>
    </div>
  );
}
