import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import type { Shell } from "../App";
import { getLead, logActivity, pillCounts, queryLeads, undoLast, updateActivity, updateLead } from "../api";
import type { Activity, Lead, LogInput } from "../types";
import { groupByDay } from "../activity/groupByDay";
import { ActivityRow } from "../activity/ActivityRow";
import {
  ANGLE_LABEL,
  daysUntil,
  inWindow,
  joinLoc,
  isToday,
  landmines,
  localHour,
  render,
  zoneBonus,
} from "../signals";
import {
  AGENT_QA,
  BROKER_OBJECTIONS,
  BROKER_SCRIPTS,
  COVERAGE_QUICK,
  EDGE_ANSWERS,
  EMAIL_TEMPLATES,
  FIVE_BEAT,
  GATEKEEPER,
  MEETING_SETUP,
  NOT_INTERESTED,
  OBJECTIONS,
  OUTCOMES_V2,
  QUALIFYING,
  SCRIPTS,
  VOICEMAIL_SCRIPTS,
} from "../content";

const PAGE = 400;
const FLEET_PILLS = ["queue", "rescue", "wire", "na", "callbacks", "worked", "all"] as const;
const BROKER_PILLS = ["queue", "specialist", "commercial", "has_email", "callbacks", "worked", "all"] as const;
const PILL_LABEL: Record<string, string> = {
  queue: "Queue", rescue: "Rescue", wire: "Wire", na: "New auth", callbacks: "Callbacks",
  worked: "Worked", all: "All", specialist: "Specialist", commercial: "Commercial", has_email: "Has email",
};
const STAGES = ["uncontacted", "pitched", "docs_sent", "appointed", "producing"];

export default function Dial({ s, kind }: { s: Shell; kind: "fleet" | "broker" }) {
  const [pill, setPill] = useState<string>("queue");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [rows, setRows] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState(0);
  const [pane, setPane] = useState<"script" | "obj" | "qual" | "meet" | "gate" | "vm" | "email" | "cov" | "hist">("script");
  const [disp, setDisp] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [objection, setObjection] = useState("");
  const [when, setWhen] = useState("");
  const [doxDot, setDoxDot] = useState(false);
  const [doxDec, setDoxDec] = useState(false);
  const [renewalMonth, setRenewalMonth] = useState("");
  const [dncConfirm, setDncConfirm] = useState(false);
  const [dncReason, setDncReason] = useState("");
  const [sprint, setSprint] = useState<{ target: number; start: number; done: number } | null>(null);
  const [hist, setHist] = useState<Activity[]>([]);
  const [editAct, setEditAct] = useState<number | null>(null);
  const [, tick] = useState(0);
  const noteRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const callStart = useRef(Date.now());
  const fetching = useRef(false);
  const curLeadRef = useRef<number | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 200);
    return () => clearTimeout(t);
  }, [search]);

  const fetchPage = useCallback(
    async (offset: number, replace: boolean) => {
      if (fetching.current) return;
      fetching.current = true;
      if (replace) setLoading(true);
      try {
        const res = await queryLeads({
          kind, pill, search: debounced || undefined, zone_bonus: zoneBonus(),
          limit: PAGE, offset,
        });
        setTotal(res.total);
        setRows((prev) => (replace ? res.rows : [...prev, ...res.rows]));
        if (replace) setSel(0);
      } catch {
        /* toasted */
      } finally {
        fetching.current = false;
        setLoading(false);
      }
    },
    [kind, pill, debounced]
  );

  useEffect(() => {
    fetchPage(0, true);
    pillCounts(kind).then(setCounts).catch(() => {});
  }, [kind, pill, debounced, s.bump]); // eslint-disable-line react-hooks/exhaustive-deps

  const lead: Lead | undefined = rows[Math.min(sel, rows.length - 1)];

  useEffect(() => {
    callStart.current = Date.now();
    setDoxDot(false);
    setDoxDec(false);
    setRenewalMonth("");
    setHist([]);
    setEditAct(null);
    curLeadRef.current = lead?.id ?? null;
    if (!lead?.id) return;
    getLead(lead.id)
      .then((r) => { if (curLeadRef.current === lead.id) setHist((r.activities as Activity[]) ?? []); })
      .catch(() => {});
  }, [lead?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Guard every hist fetch against the selection having moved on — otherwise a slow refetch for
  // the just-logged lead can clobber the newly-selected lead's timeline (they race after commit).
  const refetchHist = useCallback((id: number) => {
    getLead(id).then((r) => { if (curLeadRef.current === id) setHist((r.activities as Activity[]) ?? []); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!sprint) return;
    const iv = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, [sprint]);

  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 56,
    overscan: 10,
  });

  // infinite load
  useEffect(() => {
    const items = virt.getVirtualItems();
    const last = items[items.length - 1];
    if (last && last.index >= rows.length - 30 && rows.length < total) {
      fetchPage(rows.length, false);
    }
  }, [virt.getVirtualItems(), rows.length, total]); // eslint-disable-line react-hooks/exhaustive-deps

  const scripts = kind === "broker" ? BROKER_SCRIPTS : SCRIPTS;
  const script = useMemo(
    () => scripts.find((x) => x.tag === lead?.angle) ?? scripts[0],
    [scripts, lead?.angle]
  );

  const copyPhone = useCallback((p: string) => {
    navigator.clipboard?.writeText(p.replace(/\D/g, "")).then(
      () => toast.success("Number copied"),
      () => toast.error("Clipboard blocked")
    );
  }, []);

  async function commit(outcome: string, extra?: Partial<LogInput>) {
    if (!lead) return;
    const input: LogInput = {
      lead_id: lead.id,
      outcome,
      script: lead.angle,
      objection,
      note,
      duration_s: Math.round((Date.now() - callStart.current) / 1000),
      dox_dot: doxDot,
      dox_dec: doxDec,
      renewal_month: renewalMonth || undefined,
      callback_at: outcome === "CB" && when ? new Date(when).toISOString() : undefined,
      meeting_at: outcome === "BM" && when ? new Date(when).toISOString() : undefined,
      ...extra,
    };
    try {
      await logActivity(input);
    } catch {
      return; // toasted; do NOT advance — the log did not persist
    }
    callStart.current = Date.now(); // next call's duration starts now, even on the same lead
    if (outcome === "DNC") {
      toast(`${lead.company} marked Do-Not-Call`, {
        action: { label: "Undo", onClick: () => undoLast().then((m) => { toast.success(m); s.poke(); }) },
        duration: 8000,
      });
    } else if (outcome !== "BM") {
      // every log gets visible confirmation — silence here read as "call wasn't logged"
      toast.success(`${outcome} logged — ${lead.company} (attempt ${(lead.attempts ?? 0) + 1})`, {
        action: { label: "Undo", onClick: () => undoLast().then((m) => { toast.success(m); s.poke(); }) },
      });
    }
    if (outcome === "BM") {
      const tpl = EMAIL_TEMPLATES.find((t) => t.key === "docs");
      if (tpl) navigator.clipboard?.writeText(render(tpl.body, lead)).catch(() => {});
      toast.success("Meeting booked — confirm cadence created; docs-ask copied to clipboard");
    }
    refetchHist(lead.id); // keep the timeline pane live even when the lead stays selected
    setDisp(null); setNote(""); setObjection(""); setWhen(""); setDncConfirm(false); setDncReason("");
    setSprint((sp) => (sp ? { ...sp, done: sp.done + 1 } : sp));
    // remove from queue-like pills (lead now has next_eligible); keep in place otherwise
    if (["queue", "callbacks"].includes(pill)) {
      setRows((prev) => prev.filter((r) => r.id !== lead.id));
      setTotal((t) => Math.max(0, t - 1));
    } else {
      setSel((i) => Math.min(i + 1, rows.length - 1));
    }
    pillCounts(kind).then(setCounts).catch(() => {});
    s.refreshCounts();
  }

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) {
        if (e.key === "Enter" && disp && disp !== "DNC") commit(disp);
        if (e.key === "Escape") { setDisp(null); setDncConfirm(false); }
        return;
      }
      if (e.metaKey || e.ctrlKey) return;
      if (e.altKey) {
        if (e.code === "KeyD") { setDoxDot((v) => !v); e.preventDefault(); }
        if (e.code === "KeyP") { setDoxDec((v) => !v); e.preventDefault(); }
        return;
      }
      if (e.key === "j") setSel((x) => Math.min(x + 1, rows.length - 1));
      else if (e.key === "k") setSel((x) => Math.max(x - 1, 0));
      else if (e.key === "s") setPane("script");
      else if (e.key === "h") setPane("hist");
      else if (e.key === "o") setPane("obj");
      else if (e.key === "q") setPane("qual");
      else if (e.key === "m") setPane("meet");
      else if (e.key === "g") setPane("gate");
      else if (e.key === "v") setPane("vm");
      else if (e.key === "e") setPane("email");
      else if (e.key === "f") setPane("cov");
      else if (e.key === "c" && lead) copyPhone(lead.phone);
      else {
        const oc = OUTCOMES_V2.find((x) => x.key === e.key.toUpperCase());
        if (oc && lead) {
          if (oc.code === "DNC") { setDncConfirm(true); return; }
          setDisp(oc.code);
          if (oc.code === "VM") setPane("vm");
          setTimeout(() => noteRef.current?.focus(), 20);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows.length, lead, disp, note, objection, when, doxDot, doxDec, renewalMonth]); // eslint-disable-line react-hooks/exhaustive-deps

  // scroll selection into view
  useEffect(() => {
    virt.scrollToIndex(sel, { align: "auto" });
  }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  const pills = kind === "broker" ? BROKER_PILLS : FLEET_PILLS;
  const mines = lead ? landmines(lead) : [];
  const sprintSecs = sprint ? Math.floor((Date.now() - sprint.start) / 1000) : 0;

  return (
    <div className="dial">
      <aside className="queue">
        <div className="queue-head">
          <input placeholder="search name / DOT / owner / city / state" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="filters">
            {pills.map((f) => (
              <button key={f} className={pill === f ? "pill on" : "pill"} onClick={() => setPill(f)}>
                {PILL_LABEL[f]} {counts[f] !== undefined && <span className="pill-n">{counts[f].toLocaleString()}</span>}
              </button>
            ))}
          </div>
          {kind === "broker" && (
            <div className="filters">
              {STAGES.map((st) => (
                <button key={st} className={pill === `stage:${st}` ? "pill on" : "pill"} onClick={() => setPill(`stage:${st}`)}>
                  {st.replace("_", " ")} {counts[`stage:${st}`] !== undefined && <span className="pill-n">{counts[`stage:${st}`]}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="queue-list" ref={listRef}>
          {loading ? (
            <div className="pad dim">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="pad dim">
              No leads match{debounced ? ` “${debounced}”` : ""} in {PILL_LABEL[pill] ?? pill}.
              <br />
              Try another filter or clear search.
            </div>
          ) : (
            <div style={{ height: virt.getTotalSize(), position: "relative" }}>
              {virt.getVirtualItems().map((vi) => {
                const l = rows[vi.index];
                return (
                  <div
                    key={l.id}
                    className={vi.index === sel ? "qrow sel" : "qrow"}
                    style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${vi.start}px)`, height: vi.size }}
                    onClick={() => setSel(vi.index)}
                  >
                    <div className="qrow-top">
                      <span className="qrow-name">{l.company}</span>
                      <span className={`chip ${l.angle.toLowerCase()}`}>{l.angle}</span>
                    </div>
                    <div className="qrow-sub">
                      {l.kind === "fleet" ? `${l.owner || "—"} · ${l.units} trk` : l.trucking_signal}
                      {joinLoc("", l.state) && ` · ${l.state}`}
                      {inWindow(l.tz) ? " · 🟢" : ""}
                      {l.attempts > 0 && <span className="win"> · ✓{l.attempts}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="queue-foot">
          showing {rows.length.toLocaleString()} of {total.toLocaleString()} · j/k · h/s/o/g/v/e panes · A G D B I C V X · ⌥D DOT ⌥P dec · c copy
        </div>
      </aside>

      {lead ? (
        <section className="cockpit">
          {sprint ? (
            <div className="sprint">
              <span className="big">{sprint.done}/{sprint.target}</span>
              <span className="lbl">logged</span>
              <span className="big">{Math.floor(sprintSecs / 60)}:{String(sprintSecs % 60).padStart(2, "0")}</span>
              <span className="lbl">elapsed</span>
              <span className="spacer" />
              <button className="btn ghost sm" style={{ borderColor: "#fff", color: "#fff" }} onClick={() => { toast.info(`Sprint done: ${sprint.done} logged in ${Math.round(sprintSecs / 60)}min`); setSprint(null); }}>
                End sprint
              </button>
            </div>
          ) : (
            <div style={{ marginBottom: 14 }}>
              <button className="btn primary sm" onClick={() => setSprint({ target: 25, start: Date.now(), done: 0 })}>
                ▶ Start dial sprint
              </button>
            </div>
          )}

          <div className="cockpit-head">
            <h1>{lead.company}</h1>
            <span className={`chip ${lead.angle.toLowerCase()}`}>{ANGLE_LABEL[lead.angle] ?? lead.angle}</span>
            <span className="rec">{lead.angle_why}</span>
          </div>

          {mines.length > 0 && (
            <div className="mines">
              {mines.map((m, i) => (
                <span key={i} className={`mine ${m.level}`}>{m.level === "red" ? "⛔" : "⚠️"} {m.text}</span>
              ))}
            </div>
          )}

          <div className="phone-line">
            <span className="phone-num">{lead.phone || "no phone"}</span>
            {lead.phone && <button className="btn util" onClick={() => copyPhone(lead.phone)}>Copy #</button>}
            {lead.email && <button className="link" onClick={() => openUrl(`mailto:${lead.email}`)}>{lead.email}</button>}
            <span className="dim" style={{ fontSize: 12 }}>
              local {localHour(lead.tz)}:00 {inWindow(lead.tz) ? "· in window" : "· off-hours"}
            </span>
          </div>

          <div className="factgrid">
            {lead.kind === "fleet" ? (
              <>
                <Fact k="Owner" v={lead.owner} big warn={!lead.owner} warnText="find owner first" />
                <Fact k="DOT" v={lead.dot} />
                <Fact k="Units" v={String(lead.units || "—")} />
                <Fact k="Location" v={joinLoc(lead.city, lead.state) || "—"} />
                <Fact k="Safety" v={lead.safety_rating || "Unrated"} />
                <Fact k="Insurer (file)" v={lead.insurer || "unknown"} />
                <Fact k="Renewal" v={lead.est_renewal ? `${lead.est_renewal} (${daysUntil(lead.est_renewal)}d)` : lead.renewal_month || "—"} />
                <Fact k="Cancel" v={lead.cancel_date} warn={!!lead.cancel_date} />
                <Fact k="Suspension" v={lead.susp_type ? `${lead.susp_type.slice(0, 30)} ${lead.susp_date}` : ""} warn={!!lead.susp_type} />
                <Fact k="Equipment" v={lead.equipment} />
              </>
            ) : (
              <>
                <Fact k="Focus" v={lead.trucking_signal} big />
                <Fact k="Location" v={joinLoc(lead.city, lead.state) || "—"} />
                <Fact k="Email" v={lead.email || "—"} />
                <Fact k="Source" v={lead.source} />
                <div className="fact">
                  <div className="k">Stage</div>
                  <select
                    className="cell-in"
                    value={lead.stage}
                    onChange={(e) => {
                      const stage = e.target.value;
                      updateLead(lead.id, { stage }).then(() => {
                        setRows((prev) => prev.map((r) => (r.id === lead.id ? { ...r, stage } : r)));
                        pillCounts(kind).then(setCounts).catch(() => {});
                        toast.success(`Stage → ${stage}`);
                      });
                    }}
                  >
                    {STAGES.map((st) => <option key={st} value={st}>{st.replace("_", " ")}</option>)}
                  </select>
                </div>
              </>
            )}
          </div>

          <div className="research-row">
            {lead.kind === "fleet" && lead.dot && (
              <>
                <button className="link" onClick={() => openUrl(`https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=USDOT&query_string=${lead.dot}`)}>SAFER ↗</button>
                <button className="link" onClick={() => openUrl(`https://www.google.com/search?q=${encodeURIComponent(`${lead.company} ${lead.city} owner`)}`)}>Google owner ↗</button>
              </>
            )}
            {lead.website && <button className="link" onClick={() => openUrl(lead.website)}>{lead.website.replace(/https?:\/\/(www\.)?/, "")} ↗</button>}
          </div>

          <div className="panes">
            {((kind === "broker"
              ? [["hist", hist.length ? `History ✓${hist.length}` : "History"], ["script", `Pitch`], ["obj", "Objections + Q&A"], ["meet", "15-min ask"], ["cov", "Coverage facts"], ["vm", "Voicemail"], ["email", "Email"]]
              : [["hist", hist.length ? `History ✓${hist.length}` : "History"], ["script", `Script ${script.tag}`], ["obj", "Objections"], ["qual", "Qualify"], ["meet", "Book it"], ["gate", "Craft"], ["cov", "Coverage"], ["vm", "VM"], ["email", "Email"]]) as Array<[typeof pane, string]>).map(([id, label]) => (
              <button key={id} className={pane === id ? "pill on" : "pill"} onClick={() => setPane(id)}>{label}</button>
            ))}
          </div>

          <div className="pane">
            {pane === "hist" && (
              <div className="hist-pane">
                {hist.length === 0 ? (
                  <p className="dim pad">No touches yet — outcomes you log land here, newest first.</p>
                ) : (
                  groupByDay(hist).map((g) => (
                    <div key={g.day}>
                      <div className="tl-day">{g.label}</div>
                      {g.items.map((a) => (
                        <div key={a.id}>
                          <div onClick={() => setEditAct(editAct === a.id ? null : a.id)} style={{ cursor: "pointer" }} title="click to edit">
                            <ActivityRow a={a} />
                          </div>
                          {editAct === a.id && (
                            <ActEdit
                              a={a}
                              onSaved={() => { setEditAct(null); if (lead) refetchHist(lead.id); }}
                              onCancel={() => setEditAct(null)}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
            )}
            {pane === "script" && (
              <div className="flow">
                <div className="flow-step">
                  <span className="flow-k">SAY</span>
                  <p className="opener big-say">"{render(script.opener, lead)}"</p>
                </div>
                <div className="flow-step">
                  <span className="flow-k">THEN</span>
                  <p className="flow-then">{render(script.then, lead)}</p>
                </div>
                <div className="flow-step">
                  <span className="flow-k">IF</span>
                  <div className="row">
                    <button className="pill" onClick={() => setPane(kind === "broker" ? "obj" : "qual")}>They engage → qualify</button>
                    <button className="pill" onClick={() => setPane("obj")}>Objection / brush-off</button>
                    {kind === "fleet" && <button className="pill" onClick={() => setPane("gate")}>Gatekeeper</button>}
                    <button className="pill" onClick={() => setPane("vm")}>Voicemail</button>
                    <button className="pill" onClick={() => setPane("meet")}>Ready to book →</button>
                  </div>
                </div>
                <details className="flow-more">
                  <summary className="dim">more context — {script.name}</summary>
                  <p className="dim" style={{ marginTop: 6 }}>{script.when}</p>
                  <p className="hook" style={{ marginTop: 6 }}><b>DEPTH</b>{script.hook}</p>
                  <ul className="notes">{script.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
                </details>
                <p className="dim mt" style={{ fontSize: 12 }}>{FIVE_BEAT}</p>
              </div>
            )}
            {pane === "obj" && (
              <div className="obj-grid">
                {(kind === "broker" ? [...BROKER_OBJECTIONS, ...AGENT_QA] : OBJECTIONS).map((o) => (
                  <div key={o.name} className="obj">
                    <div className="obj-name">"{o.name}"</div>
                    <div><b>HEAR</b>{o.hear}</div>
                    <div><b>TURN</b>{o.turn}</div>
                    {o.ask && <div><b>ASK</b>{o.ask}</div>}
                  </div>
                ))}
                {kind === "fleet" && (
                  <div className="obj">
                    <div className="obj-name">Brush-offs = questions in disguise</div>
                    {NOT_INTERESTED.map((n) => <div key={n.mode}><b>{n.mode}</b> <span className="dim">{n.cue}</span> {n.move}</div>)}
                  </div>
                )}
              </div>
            )}
            {pane === "qual" && (
              <div>
                <div className="tagline" style={{ marginBottom: 8 }}>Qualify before you book <span className="dim" style={{ fontSize: 13, fontWeight: 400 }}>— pick 3–5. A fast yes with no engagement is a polite no.</span></div>
                {QUALIFYING.map((x, i) => (
                  <div key={i} className="obj" style={{ marginBottom: 8 }}>
                    <div className="obj-name">{x.q}</div>
                    <div><b>LISTEN</b>{x.listen}</div>
                  </div>
                ))}
              </div>
            )}
            {pane === "meet" && (
              <div>
                <div className="tagline" style={{ marginBottom: 8 }}>The 15-minute meeting machine</div>
                <p className="opener">{MEETING_SETUP.agenda}</p>
                <div className="obj-grid">
                  <div className="obj">
                    <div className="obj-name">Earn a REAL yes (in order)</div>
                    {MEETING_SETUP.realYesSequence.map((x, i) => <div key={i}>{x}</div>)}
                    <div style={{ marginTop: 6 }}><b>TEST</b>{MEETING_SETUP.testBeforeBook}</div>
                  </div>
                  <div className="obj">
                    <div className="obj-name">Spot the hollow yes</div>
                    {MEETING_SETUP.hollowYes.map((x, i) => <div key={i}>{x}</div>)}
                  </div>
                  <div className="obj">
                    <div className="obj-name">Prep them the moment they book</div>
                    {MEETING_SETUP.prepList.map((x, i) => <div key={i}>{x}</div>)}
                  </div>
                  <div className="obj">
                    <div className="obj-name">Lock it in / kill the no-show</div>
                    {MEETING_SETUP.lockIn.map((x, i) => <div key={i}>{x}</div>)}
                    <div style={{ marginTop: 6 }}>
                      <b>CONFIRM</b>{MEETING_SETUP.confirm}
                      <button className="link" onClick={() => { navigator.clipboard?.writeText(MEETING_SETUP.confirm); toast.success("Confirmation text copied"); }}>copy →</button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {pane === "cov" && (
              <div className="obj-grid">
                <div className="obj">
                  <div className="obj-name">Coverage facts (official manual)</div>
                  {COVERAGE_QUICK.map((x, i) => <div key={i} style={{ marginBottom: 4 }}>{x}</div>)}
                </div>
                <div className="obj">
                  <div className="obj-name">"Can you cover…?" — instant answers</div>
                  {EDGE_ANSWERS.map(([q, a], i) => <div key={i} style={{ marginBottom: 4 }}><b>{q}</b> — {a}</div>)}
                </div>
              </div>
            )}
            {pane === "gate" && <ul className="notes">{GATEKEEPER.map((g, i) => <li key={i}>{g}</li>)}</ul>}
            {pane === "vm" && (
              <div>
                {VOICEMAIL_SCRIPTS.map((v) => (
                  <div key={v.name} style={{ marginBottom: 12 }}>
                    <div className="obj-name">{v.name}</div>
                    <p>"{render(v.text, lead)}"</p>
                  </div>
                ))}
              </div>
            )}
            {pane === "email" && (
              <div>
                {EMAIL_TEMPLATES.filter((t) => t.audience === "both" || t.audience === (lead.kind === "broker" ? "broker" : "fleet")).map((t) => (
                  <div key={t.key} style={{ marginBottom: 14 }}>
                    <div className="row">
                      <div className="obj-name">{t.label}</div>
                      <span className="spacer" />
                      <button
                        className="btn primary sm"
                        disabled={!lead.email}
                        onClick={() => {
                          openUrl(`mailto:${lead.email}?subject=${encodeURIComponent(render(t.subject, lead))}&body=${encodeURIComponent(render(t.body, lead))}`);
                          logActivity({ lead_id: lead.id, outcome: "EMAIL", note: t.key }).then(() => s.refreshCounts());
                        }}
                      >
                        {lead.email ? "Compose" : "no email"}
                      </button>
                    </div>
                    <p className="dim" style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{render(t.body, lead)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="artifact-bar">
            <label className={doxDot ? "touch done" : "touch"}>
              <input type="checkbox" checked={doxDot} onChange={(e) => setDoxDot(e.target.checked)} /> DOT captured (⌥D)
            </label>
            <label className={doxDec ? "touch done" : "touch"}>
              <input type="checkbox" checked={doxDec} onChange={(e) => setDoxDec(e.target.checked)} /> Dec page (⌥P)
            </label>
            <input type="month" value={renewalMonth} onChange={(e) => setRenewalMonth(e.target.value)} title="stated renewal month → auto 45-day callback" />
            {(lead.dox_dot === 1 || lead.dox_dec === 1) && (
              <span className="chip partner">prior: {lead.dox_dot ? "DOT✓" : ""} {lead.dox_dec ? "dec✓" : ""}</span>
            )}
          </div>

          <div className="disp-bar">
            {OUTCOMES_V2.map((o) => (
              <button
                key={o.code}
                className={`disp${disp === o.code ? " sel" : ""}${o.code === "DNC" ? " dnc" : ""}`}
                onClick={() => {
                  if (o.code === "DNC") { setDncConfirm(true); return; }
                  setDisp(o.code);
                  if (o.code === "VM") setPane("vm");
                  setTimeout(() => noteRef.current?.focus(), 20);
                }}
              >
                <span className="kbd">{o.key}</span> {o.label}
              </button>
            ))}
          </div>

          {disp && (
            <div className="logbar">
              <input ref={noteRef} placeholder="note / objection verbatim…" value={note} onChange={(e) => setNote(e.target.value)} />
              <select value={objection} onChange={(e) => setObjection(e.target.value)}>
                <option value="">objection?</option>
                {(kind === "broker" ? BROKER_OBJECTIONS : OBJECTIONS).map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
                <option value="other">other</option>
              </select>
              {(disp === "CB" || disp === "BM") && (
                <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
              )}
              {(disp === "DM" || disp === "NI") && !renewalMonth && (
                <input type="month" value={renewalMonth} onChange={(e) => setRenewalMonth(e.target.value)} title="renewal month?" />
              )}
              <button className="btn primary sm" onClick={() => commit(disp)} disabled={(disp === "CB" || disp === "BM") && !when}>
                Log {disp} ⏎
              </button>
              <button className="pill" onClick={() => setDisp(null)}>esc</button>
            </div>
          )}

          {dncConfirm && (
            <div className="logbar" style={{ borderColor: "var(--hot)" }}>
              <b style={{ color: "var(--hot)" }}>Mark {lead.company} Do-Not-Call?</b> Permanent (undo within 8s).
              <input placeholder="reason (required)" value={dncReason} onChange={(e) => setDncReason(e.target.value)} />
              <button className="btn primary sm" style={{ background: "var(--hot)" }} disabled={!dncReason.trim()} onClick={() => commit("DNC", { dnc_reason: dncReason })}>
                Confirm DNC
              </button>
              <button className="pill" onClick={() => { setDncConfirm(false); setDncReason(""); }}>cancel</button>
            </div>
          )}
        </section>
      ) : (
        <section className="cockpit dim pad">{loading ? "Loading…" : "No lead selected — pick a filter with results."}</section>
      )}
    </div>
  );
}

function ActEdit({ a, onSaved, onCancel }: { a: Activity; onSaved: () => void; onCancel: () => void }) {
  const [note, setNote] = useState(a.note ?? "");
  const [objection, setObjection] = useState(a.objection ?? "");
  const [outcome, setOutcome] = useState(a.outcome);
  const [saving, setSaving] = useState(false);
  const editableOutcome = isToday(a.ts); // outcome corrections locked after the day closes
  return (
    <div className="logbar act-edit">
      <input placeholder="note…" value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
      <input placeholder="objection…" value={objection} onChange={(e) => setObjection(e.target.value)} />
      {editableOutcome && (
        <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          {OUTCOMES_V2.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>
      )}
      <button
        className="btn primary sm"
        disabled={saving}
        onClick={() => {
          const changed = note !== (a.note ?? "") || objection !== (a.objection ?? "") || (editableOutcome && outcome !== a.outcome);
          if (!changed) { onCancel(); return; } // no write, no spurious "edited" mark
          setSaving(true);
          updateActivity(a.id, { note, objection, outcome: editableOutcome ? outcome : undefined })
            .then(() => { toast.success("Activity updated"); onSaved(); })
            .catch(() => setSaving(false));
        }}
      >
        Save
      </button>
      <button className="pill" onClick={onCancel}>esc</button>
    </div>
  );
}

function Fact({ k, v, warn, big, warnText }: { k: string; v?: string | null; warn?: boolean; big?: boolean; warnText?: string }) {
  return (
    <div className="fact">
      <div className="k">{k}</div>
      <div className={`v${warn ? " warn" : ""}${big ? " big" : ""}`}>{v || warnText || "—"}</div>
    </div>
  );
}
