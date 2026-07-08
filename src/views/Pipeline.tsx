import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { Shell } from "../App";
import { listTable, softDelete, undoLast, upsertRow } from "../api";
import type { Deal, Meeting } from "../types";
import { fmtMoney, fmtTime } from "../signals";
import { LOSS_REASONS } from "../content";

const COMMISSION_RATE = 0.1;
const PAYOUT = "2026-09-30";

export default function Pipeline({ s }: { s: Shell }) {
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [deals, setDeals] = useState<Deal[] | null>(null);

  const reload = () => {
    listTable<Meeting>("meetings").then(setMeetings).catch(() => setMeetings([]));
    listTable<Deal>("deals").then(setDeals).catch(() => setDeals([]));
  };
  useEffect(reload, [s.bump]);

  return (
    <div className="wrap-pad">
      <Meetings meetings={meetings} reload={reload} />
      <div style={{ height: 28 }} />
      <Deals deals={deals} reload={reload} />
    </div>
  );
}

function delWithUndo(table: string, id: number, reload: () => void) {
  softDelete(table, id).then(() => {
    reload();
    toast(`Deleted ${table.slice(0, -1)}`, {
      action: { label: "Undo", onClick: () => undoLast().then(() => { reload(); toast.success("Restored"); }) },
      duration: 8000,
    });
  });
}

function Meetings({ meetings, reload }: { meetings: Meeting[] | null; reload: () => void }) {
  const [name, setName] = useState("");
  const [at, setAt] = useState("");
  const [err, setErr] = useState("");

  const upcoming = (meetings ?? []).filter((m) => m.status === "upcoming").sort((a, b) => a.at.localeCompare(b.at));
  const past = (meetings ?? []).filter((m) => m.status !== "upcoming");
  const shows = past.filter((m) => m.status === "showed").length;
  const rate = past.length ? Math.round((shows / past.length) * 100) : null;

  const up = (id: number, patch: Record<string, unknown>) => upsertRow("meetings", { id, ...patch }).then(reload);

  return (
    <section className="card">
      <div className="section-head">
        Meetings {rate !== null ? `· show rate ${100 - rate}% no-show vs 32% floor / 5% Cicero` : "· 3-touch confirm = the no-show fix"}
      </div>
      <div className="add-row mt">
        <input placeholder="company" value={name} onChange={(e) => { setName(e.target.value); setErr(""); }} />
        <input type="datetime-local" value={at} onChange={(e) => { setAt(e.target.value); setErr(""); }} />
        <button
          className="btn primary sm"
          onClick={() => {
            if (!name.trim()) return setErr("Company name required");
            if (!at) return setErr("Pick a date & time");
            upsertRow("meetings", { name: name.trim(), at: new Date(at).toISOString(), phone: "", status: "upcoming" }).then(() => {
              setName(""); setAt(""); reload(); toast.success("Meeting booked — confirm cadence started");
            });
          }}
        >
          + Book
        </button>
        {err && <span style={{ color: "var(--hot)", fontSize: 13 }}>{err}</span>}
      </div>
      {meetings === null ? (
        <p className="dim pad">Loading…</p>
      ) : (
        upcoming.map((m) => (
          <div key={m.id} className="meeting">
            <div className="meeting-head">
              <b>{m.name}</b> <span className="dim">· {fmtTime(m.at)}</span>
              <span className="spacer" />
              <label className="chk">
                <input type="checkbox" checked={!!m.dec_page} onChange={(e) => up(m.id, { dec_page: e.target.checked })} />
                dec page
              </label>
              <button className="link" onClick={() => delWithUndo("meetings", m.id, reload)}>delete</button>
            </div>
            <div className="touches">
              {([["t_booking", "T0 · booking text"], ["t_24", "T-24h confirm"], ["t_1", "T-1h still good?"]] as const).map(([k, lbl]) => (
                <label key={k} className={m[k] ? "touch done" : "touch"}>
                  <input type="checkbox" checked={!!m[k]} onChange={(e) => up(m.id, { [k]: e.target.checked })} />
                  {lbl}
                </label>
              ))}
              <span className="spacer" />
              <button className="pill" onClick={() => up(m.id, { status: "showed" })}>Showed</button>
              <button className="pill" onClick={() => up(m.id, { status: "no-show" })}>No-show</button>
            </div>
          </div>
        ))
      )}
      {meetings !== null && upcoming.length === 0 && (
        <p className="dim pad">No upcoming meetings — book from Dial (outcome B) or add one above.</p>
      )}
    </section>
  );
}

function Deals({ deals, reload }: { deals: Deal[] | null; reload: () => void }) {
  const [name, setName] = useState("");
  const [premium, setPremium] = useState("");
  const [err, setErr] = useState("");
  const bound = (deals ?? []).filter((d) => d.status === "bound");
  const boundPrem = bound.reduce((s, d) => s + d.premium, 0);
  const daysToPayout = Math.ceil((new Date(PAYOUT).getTime() - Date.now()) / 86400000);

  const up = (id: number, patch: Record<string, unknown>) => upsertRow("deals", { id, ...patch }).then(reload);
  const STATUSES = ["working", "submitted", "quoted", "bound", "lost"];

  return (
    <section className="card">
      <div className="section-head">
        Deal ledger · bound {fmtMoney(boundPrem)} · commission @10% = {fmtMoney(boundPrem * COMMISSION_RATE)}
        <span style={{ color: "var(--warn)" }}> · payout in {daysToPayout}d ({PAYOUT}) — forfeiture clause unresolved; 10% floor-confirmed w/ receipts ($1,460 on $14,605), offer letter says 0.5–1% — reconcile</span>
      </div>
      <div className="add-row mt">
        <input placeholder="company" value={name} onChange={(e) => { setName(e.target.value); setErr(""); }} />
        <input placeholder="premium $" value={premium} onChange={(e) => { setPremium(e.target.value); setErr(""); }} style={{ width: 130 }} />
        <button
          className="btn primary sm"
          onClick={() => {
            if (!name.trim()) return setErr("Company name required");
            const p = parseFloat(premium);
            if (premium && (isNaN(p) || p < 0)) return setErr("Premium must be a number");
            upsertRow("deals", { name: name.trim(), premium: p || 0, status: "working", created_at: new Date().toISOString() }).then(() => {
              setName(""); setPremium(""); reload(); toast.success("Deal added");
            });
          }}
        >
          + Deal
        </button>
        {err && <span style={{ color: "var(--hot)", fontSize: 13 }}>{err}</span>}
      </div>
      {deals === null ? (
        <p className="dim pad">Loading…</p>
      ) : (
        <table className="tbl">
          <thead>
            <tr><th>company</th><th>premium</th><th>status</th><th>bind date</th><th>loss reason</th><th>note</th><th></th></tr>
          </thead>
          <tbody>
            {deals.map((d) => (
              <tr key={d.id} className={d.status === "bound" ? "bound" : d.status === "lost" ? "lost" : ""}>
                <td>{d.name}</td>
                <td>
                  <input className="cell-in" defaultValue={d.premium || ""} onBlur={(e) => {
                    const p = parseFloat(e.target.value);
                    if (!isNaN(p) && p !== d.premium) up(d.id, { premium: p });
                  }} />
                </td>
                <td>
                  <select className="cell-in" value={d.status} onChange={(e) => up(d.id, { status: e.target.value, bind_date: e.target.value === "bound" ? new Date().toISOString().slice(0, 10) : d.bind_date })}>
                    {STATUSES.map((st) => <option key={st}>{st}</option>)}
                  </select>
                </td>
                <td>{d.bind_date || "—"}</td>
                <td>
                  {d.status === "lost" ? (
                    <select className="cell-in" value={d.loss_reason || ""} onChange={(e) => up(d.id, { loss_reason: e.target.value })}>
                      <option value="">why?</option>
                      {LOSS_REASONS.map((r) => <option key={r}>{r}</option>)}
                    </select>
                  ) : "—"}
                </td>
                <td><input className="cell-in wide" defaultValue={d.note} onBlur={(e) => e.target.value !== d.note && up(d.id, { note: e.target.value })} /></td>
                <td><button className="link" onClick={() => delWithUndo("deals", d.id, reload)}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {deals !== null && deals.length === 0 && (
        <p className="dim pad">Every deal you source goes here with a bind date — your paycheck's paper trail.</p>
      )}
    </section>
  );
}
