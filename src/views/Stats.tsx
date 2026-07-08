import { Fragment, useEffect, useMemo, useState } from "react";
import type { Shell } from "../App";
import { listTable } from "../api";
import type { Activity } from "../types";
import { OUTCOMES_V2, SCRIPTS } from "../content";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function Stats({ s }: { s: Shell }) {
  const [acts, setActs] = useState<Activity[] | null>(null);
  useEffect(() => {
    listTable<Activity>("activities").then(setActs).catch(() => setActs([]));
  }, [s.bump]);

  const calls = useMemo(() => (acts ?? []).filter((a) => a.type === "call"), [acts]);

  const byScript = useMemo(
    () =>
      SCRIPTS.map((sc) => {
        const cs = calls.filter((c) => c.script === sc.tag);
        const conn = cs.filter((c) => ["DM", "BM", "NI", "CB"].includes(c.outcome));
        const dm = cs.filter((c) => ["DM", "BM"].includes(c.outcome));
        const mt = cs.filter((c) => c.outcome === "BM");
        return {
          tag: sc.tag, name: sc.name, dials: cs.length, connects: conn.length, dm: dm.length, mt: mt.length,
          hold: conn.length ? Math.round((dm.length / conn.length) * 100) : null,
          book: dm.length ? Math.round((mt.length / dm.length) * 100) : null,
          ready: conn.length >= 15,
        };
      }),
    [calls]
  );

  const objections = useMemo(() => {
    const f = new Map<string, number>();
    calls.forEach((c) => c.objection && f.set(c.objection, (f.get(c.objection) ?? 0) + 1));
    return [...f.entries()].sort((a, b) => b[1] - a[1]);
  }, [calls]);

  const outcomes = useMemo(() => {
    const f = new Map<string, number>();
    calls.forEach((c) => f.set(c.outcome, (f.get(c.outcome) ?? 0) + 1));
    return OUTCOMES_V2.map((o) => ({ ...o, n: f.get(o.code) ?? 0 }));
  }, [calls]);

  const heat = useMemo(() => {
    const grid: Record<string, { dials: number; connects: number }> = {};
    for (const c of calls) {
      const d = new Date(c.ts);
      const key = `${d.getDay()}-${d.getHours()}`;
      const cell = grid[key] ?? { dials: 0, connects: 0 };
      cell.dials++;
      if (["DM", "BM", "NI", "CB"].includes(c.outcome)) cell.connects++;
      grid[key] = cell;
    }
    return grid;
  }, [calls]);
  const maxRate = Math.max(0.01, ...Object.values(heat).map((c) => (c.dials ? c.connects / c.dials : 0)));

  const byDay = useMemo(() => {
    const d = new Map<string, { dials: number; mt: number }>();
    calls.forEach((c) => {
      const k = c.ts.slice(0, 10);
      const cur = d.get(k) ?? { dials: 0, mt: 0 };
      cur.dials++;
      if (c.outcome === "BM") cur.mt++;
      d.set(k, cur);
    });
    return [...d.entries()].sort().slice(-14);
  }, [calls]);
  const maxD = Math.max(1, ...byDay.map(([, v]) => v.dials));

  if (acts === null) return <div className="wrap-pad"><p className="dim pad">Loading stats…</p></div>;

  return (
    <div className="wrap-pad">
      <section className="card">
        <div className="section-head">Script lab · judge nothing under 15 connects</div>
        <table className="tbl mt">
          <thead>
            <tr><th>script</th><th>dials</th><th>connects</th><th>DM</th><th>mtg</th><th>opener holds</th><th>DM→mtg</th><th>verdict</th></tr>
          </thead>
          <tbody>
            {byScript.map((x) => (
              <tr key={x.tag}>
                <td><b>{x.tag}</b> {x.name}</td>
                <td>{x.dials}</td><td>{x.connects}</td><td>{x.dm}</td><td>{x.mt}</td>
                <td>{x.hold !== null ? `${x.hold}%` : "—"}</td>
                <td>{x.book !== null ? `${x.book}%` : "—"}</td>
                <td className="dim">{x.ready ? "judgeable" : `${Math.max(0, 15 - x.connects)} to go`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid2 mt" style={{ alignItems: "start" }}>
        <section className="card">
          <div className="section-head">Connect rate by hour × day (your data)</div>
          <div className="heat mt">
            <div className="lbl" />
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="lbl" style={{ justifyContent: "center" }}>{h % 3 === 0 ? h : ""}</div>
            ))}
            {DOW.map((d, di) => (
              <Fragment key={di}>
                <div className="lbl">{d}</div>
                {Array.from({ length: 24 }, (_, h) => {
                  const cell = heat[`${di}-${h}`];
                  const rate = cell && cell.dials ? cell.connects / cell.dials : 0;
                  const alpha = cell ? 0.15 + 0.85 * (rate / maxRate) : 0;
                  return (
                    <div key={`${di}-${h}`} className="cell" title={cell ? `${d} ${h}:00 — ${cell.connects}/${cell.dials}` : ""}
                      style={{ background: cell ? `rgba(0,102,204,${alpha})` : "var(--divider)" }} />
                  );
                })}
              </Fragment>
            ))}
          </div>
          <p className="dim mt" style={{ fontSize: 12 }}>Darker = higher connect rate. Front-load your best windows.</p>
        </section>

        <section className="card">
          <div className="section-head">Objection frequency</div>
          <div className="mt">
            {objections.map(([name, n]) => (
              <div key={name} className="bar-row">
                <span>{name}</span>
                <div className="bar" style={{ width: `${Math.min(100, n * 12)}%` }} />
                <b>{n}</b>
              </div>
            ))}
            {objections.length === 0 && <p className="dim pad">Log objections on calls to rank what the market throws.</p>}
          </div>
          <div className="section-head mt">Outcome mix</div>
          <div className="mt">
            {outcomes.map((o) => (
              <div key={o.code} className="bar-row">
                <span>{o.code} {o.label}</span>
                <div className="bar" style={{ width: `${Math.min(100, o.n * 4)}%` }} />
                <b>{o.n}</b>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="card mt">
        <div className="section-head">Last 14 days</div>
        <div className="spark">
          {byDay.map(([day, v]) => (
            <div key={day} className="spark-col" title={`${day}: ${v.dials} dials, ${v.mt} mtg`}>
              <div className="spark-mtg">{v.mt || ""}</div>
              <div className="spark-bar" style={{ height: `${(v.dials / maxD) * 100}%` }} />
              <div className="spark-day">{day.slice(5)}</div>
            </div>
          ))}
          {byDay.length === 0 && <p className="dim pad">No calls logged yet. Day 1 starts the curve.</p>}
        </div>
      </section>
    </div>
  );
}
