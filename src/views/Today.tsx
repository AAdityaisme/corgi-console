import { useEffect, useState } from "react";
import type { Shell } from "../App";
import { listTable, readIntel } from "../api";
import type { Activity, Digest, Meeting, Task } from "../types";
import { BENCH, fmtTime, isToday } from "../signals";
import { DAILY_RITUAL, FLOOR_INTEL } from "../content";

export default function Today({ s }: { s: Shell }) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [acts, setActs] = useState<Activity[] | null>(null);
  const [digest, setDigest] = useState<Digest | null>(null);

  useEffect(() => {
    listTable<Task>("tasks").then(setTasks).catch(() => setTasks([]));
    listTable<Meeting>("meetings").then(setMeetings).catch(() => setMeetings([]));
    listTable<Activity>("activities").then(setActs).catch(() => setActs([]));
    readIntel(14).then((i) => setDigest(i.digest)).catch(() => {});
  }, [s.bump]);

  const now = Date.now();
  const c = s.counts;
  const todayCalls = (acts ?? []).filter((a) => a.type === "call" && isToday(a.ts));
  const connects = todayCalls.filter((a) => ["DM", "BM", "NI", "CB"].includes(a.outcome));
  const meetingsToday = todayCalls.filter((a) => a.outcome === "BM");
  const dms = (acts ?? []).filter((a) => a.type === "call" && ["DM", "BM"].includes(a.outcome));
  const doxed = (acts ?? []).filter((a) => a.type === "call" && a.meta?.includes('"dox"'));

  const tasksDue = (tasks ?? [])
    .filter((t) => !t.done && new Date(t.due).getTime() <= now + 4 * 3600_000)
    .sort((a, b) => a.due.localeCompare(b.due))
    .slice(0, 12);

  const touchesDue = (meetings ?? [])
    .filter((m) => m.status === "upcoming")
    .flatMap((m) => {
      const at = new Date(m.at).getTime();
      const out: Array<{ m: Meeting; t: string }> = [];
      if (!m.t_booking) out.push({ m, t: "booking text — bring dec page + MC/DOT" });
      if (!m.t_24 && at - now < 24 * 3600_000) out.push({ m, t: "24h confirm" });
      if (!m.t_1 && at - now < 3600_000) out.push({ m, t: "1h — still good?" });
      return out;
    });

  const hourPT = new Date().getHours();
  const block =
    hourPT < 7 ? "Pre-floor: roleplay warmup, review confirms due."
    : hourPT < 9 ? "POWER BLOCK — rescue queue first (East Coast late-morning)."
    : hourPT < 10 ? "Renewal wire — Central/Mountain now in window."
    : hourPT < 11.5 ? "Abandoned quotes + new authorities."
    : hourPT < 13 ? "Mid-day trough — confirms, emails, Bryce briefs, brokers."
    : hourPT < 15 ? "POWER BLOCK 2 — West Coast morning + East end-of-day."
    : hourPT < 17 ? "Callbacks due + second attempts."
    : "Close-out: win-post draft, Dhiraj alerts, tomorrow's queue.";

  const eom = new Date();
  const eomDays = Math.ceil((new Date(eom.getFullYear(), eom.getMonth() + 1, 1).getTime() - now) / 86400000);
  const pct = (v: number, t: number) => Math.min(100, Math.round((v / Math.max(1, t)) * 100));

  const loading = tasks === null || acts === null;

  return (
    <div className="today-wrap">
      <div className="today-hero">
        <h1 className="display">Good hunting.</h1>
        <p className="lead">
          {c ? (
            <>
              {c.fleets.toLocaleString()} fleets · {c.brokers.toLocaleString()} brokers ({c.specialists.toLocaleString()} specialist) ·{" "}
              {c.rescue.toLocaleString()} rescue · {c.wire.toLocaleString()} wire
            </>
          ) : (
            "Loading counts…"
          )}
          {eomDays <= 3 && <span style={{ color: "var(--hot)" }}> · Month-end in {eomDays}d — close scramble.</span>}
        </p>
        <p className="dim" style={{ marginTop: 6 }}>▸ {block}</p>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary sm" disabled={s.refreshing} onClick={() => s.refreshAll(false)}>
            {s.refreshing ? "Refreshing…" : "⟳ Re-import CSVs"}
          </button>
          <button className="btn ghost sm" disabled={s.refreshing} onClick={() => s.refreshAll(true)}>
            Full refresh (pipelines + import)
          </button>
        </div>
        <div className="meter-row">
          <Meter label="Dials" v={todayCalls.length} t={BENCH.dials} pct={pct(todayCalls.length, BENCH.dials)} />
          <Meter label="Connects" v={connects.length} t={Math.round(BENCH.dials * BENCH.connectRate)} pct={pct(connects.length, BENCH.dials * BENCH.connectRate)} />
          <Meter label="Meetings" v={meetingsToday.length} t={BENCH.meetings} pct={pct(meetingsToday.length, BENCH.meetings)} />
        </div>
      </div>

      <div className="grid2">
        <section className="card">
          <div className="section-head">Do next</div>
          {loading ? (
            <p className="dim pad">Loading…</p>
          ) : (
            <ul className="action-list mt">
              {touchesDue.map((x, i) => (
                <li key={"t" + i} className="action">
                  <span className="chip rs">Confirm</span> {x.m.name} — {x.t} · {fmtTime(x.m.at)}
                </li>
              ))}
              {tasksDue.map((t) => (
                <li key={t.id} className="action">
                  <span className="chip rw">{t.kind}</span> {t.name} — {t.note || "due"} · {fmtTime(t.due)}
                </li>
              ))}
              <li className="action tap" onClick={() => s.goto("dial")}>
                <span className="chip rs">Queue</span> {c?.rescue.toLocaleString() ?? "…"} rescue · {c?.wire.toLocaleString() ?? "…"} wire → Dial
              </li>
              {touchesDue.length === 0 && tasksDue.length === 0 && (
                <li className="action dim">No confirms or callbacks due. Start a dial sprint.</li>
              )}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="section-head">Floor pulse {digest && <span className="dim">· digest {digest.ts?.slice(0, 10)}</span>}</div>
          {digest ? (
            <div className="grid3 mt">
              <Stat k="Manual review Q" v={digest.manual_review || "—"} warn />
              <Stat k="Conv rate" v={digest.conversion_rate || "—"} />
              <Stat k="Bound 24h" v={digest.policies_bound_24h || "—"} />
              <Stat k="Active prem" v={digest.active_premium || "—"} />
              <Stat k="GWP" v={digest.gwp || "—"} />
              <Stat k="Orgs" v={digest.organizations || "—"} />
            </div>
          ) : (
            <p className="dim mt">No digest parsed — refresh telegram in Intel.</p>
          )}
          <div className="section-head" style={{ marginTop: 20 }}>DOX rate (DOT+dec / DM)</div>
          <p className="mt" style={{ fontSize: 22, fontWeight: 600 }}>
            {dms.length ? `${Math.round((doxed.length / dms.length) * 100)}%` : "—"}
            <span className="dim" style={{ fontSize: 12, fontWeight: 400 }}> · {doxed.length}/{dms.length} DM convos — your leading indicator</span>
          </p>
          <div className="section-head" style={{ marginTop: 20 }}>Floor intel (from the telegram KB)</div>
          <ul className="ritual mt">{FLOOR_INTEL.slice(0, 4).map((r, i) => <li key={i}>{r}</li>)}</ul>
          <div className="section-head" style={{ marginTop: 20 }}>The ritual</div>
          <ul className="ritual mt">{DAILY_RITUAL.slice(0, 4).map((r, i) => <li key={i}>{r}</li>)}</ul>
        </section>
      </div>
    </div>
  );
}

function Meter({ label, v, t, pct }: { label: string; v: number; t: number; pct: number }) {
  return (
    <div className="meter">
      <div className="meter-top">
        <span className="section-head">{label}</span>
        <span className="meter-target"><b className="meter-val" style={{ fontSize: 20 }}>{v}</b> / {Math.round(t)}</span>
      </div>
      <div className="meter-bar"><div className="meter-fill" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}
function Stat({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className={warn ? "stat-tile warn" : "stat-tile"}>
      <div className="v">{v}</div>
      <div className="k">{k}</div>
    </div>
  );
}
