import { useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { queryLeads } from "../api";
import type { Lead } from "../types";
import { MANUAL_REVIEW_FLAGS, SUBMISSION_PACKET, PRICE_DRIVERS } from "../content";

export default function Validate() {
  const [dot, setDot] = useState("");
  const [lead, setLead] = useState<Lead | null>(null);
  const [manual, setManual] = useState<Record<string, boolean>>({});
  const [packet, setPacket] = useState<Record<number, boolean>>({});
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const d = dot.trim();
    if (!d) return setLead(null);
    const t = setTimeout(() => {
      queryLeads({ kind: "fleet", search: d, limit: 1 })
        .then((r) => setLead(r.rows.find((x) => x.dot === d) ?? r.rows[0] ?? null))
        .catch(() => setLead(null));
    }, 250);
    return () => clearTimeout(t);
  }, [dot]);

  const autoFlags = useMemo(() => {
    if (!lead) return [] as Array<{ label: string; hit: boolean; detail: string }>;
    return [
      { label: "Fleet of more than 10 power units", hit: lead.units > 10, detail: `${lead.units} units` },
      { label: "For-hire carrier with NO BIPD insurance on file", hit: !lead.insurer, detail: lead.insurer ? `insurer: ${lead.insurer}` : "no insurer in our data — verify on L&I" },
      { label: "Power unit/trailer over 20 years old", hit: false, detail: "manual — check roster" },
    ];
  }, [lead]);

  const manualFlags = MANUAL_REVIEW_FLAGS.filter((f) => f.check === "manual");
  const hits = autoFlags.filter((f) => f.hit).length + Object.values(manual).filter(Boolean).length;
  const missing = SUBMISSION_PACKET.filter((_, i) => !packet[i]);

  const brief = useMemo(() => {
    const green: string[] = [], red: string[] = [];
    autoFlags.forEach((f) => (f.hit ? red : green).push(`${f.label} — ${f.detail}`));
    manualFlags.forEach((f) => manual[f.id] && red.push(f.label));
    if (lead) {
      if (lead.safety_rating && lead.safety_rating !== "Unrated") green.push(`Safety rating: ${lead.safety_rating}`);
      if (lead.est_renewal) green.push(`Est. renewal ${lead.est_renewal}`);
      if (lead.telematics_vendor) green.push(`Telematics: ${lead.telematics_vendor}`);
    }
    const net = hits === 0
      ? "CLEAN — should pass automated checks. Submit with notes on loss runs."
      : `${hits} manual-review trigger${hits > 1 ? "s" : ""} — flag to UW up front.`;
    return [
      `INTAKE BRIEF — ${lead?.company ?? "DOT " + dot} (DOT ${lead?.dot || dot})`, ``,
      `GREEN FLAGS`, ...green.map((g) => `  + ${g}`), ``,
      `RED FLAGS`, ...(red.length ? red.map((r) => `  - ${r}`) : ["  (none identified)"]), ``,
      `PACKET GAPS`, ...(missing.length ? missing.map((m) => `  ○ ${m}`) : ["  complete"]), ``,
      `NET: ${net}`,
    ].join("\n");
  }, [autoFlags, manual, manualFlags, lead, dot, hits, missing]);

  return (
    <div className="wrap-pad">
      <div className="grid3" style={{ alignItems: "start" }}>
        <section className="card">
          <div className="section-head">Pre-UW intake validator</div>
          <p className="dim mt" style={{ fontSize: 12 }}>
            Every miss burns the edge — ~10-min file-to-bind. Don't add to the manual-review queue.
          </p>
          <div className="add-row mt">
            <input placeholder="DOT number or company" value={dot} onChange={(e) => setDot(e.target.value)} />
          </div>
          {dot && (
            <div className="research-row">
              <button className="link" onClick={() => openUrl(`https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=USDOT&query_string=${lead?.dot || dot}`)}>SAFER ↗</button>
              {lead && <span className="dim">{lead.company} · {lead.units} units · {lead.state}</span>}
              {dot && !lead && <span className="dim">not in lead file — verify manually</span>}
            </div>
          )}
          <div className="section-head mt">Auto-checked</div>
          {autoFlags.map((f) => (
            <div key={f.label} className={f.hit ? "flag hit" : "flag ok"}>
              {f.hit ? "✗" : "✓"} {f.label} <span className="dim">— {f.detail}</span>
            </div>
          ))}
          {!lead && <p className="dim pad">Enter a DOT to auto-check, or work the checklist manually.</p>}
          <div className="section-head mt">Manual UW triggers</div>
          {manualFlags.map((f) => (
            <label key={f.id} className="chk-row">
              <input type="checkbox" checked={!!manual[f.id]} onChange={(e) => setManual({ ...manual, [f.id]: e.target.checked })} />
              {f.label}
            </label>
          ))}
        </section>

        <section className="card">
          <div className="section-head">Submission packet</div>
          {SUBMISSION_PACKET.map((item, i) => (
            <label key={i} className="chk-row">
              <input type="checkbox" checked={!!packet[i]} onChange={(e) => setPacket({ ...packet, [i]: e.target.checked })} />
              {item}
            </label>
          ))}
          <div className="section-head mt">What drives the price</div>
          <ol className="notes">{PRICE_DRIVERS.map((p, i) => <li key={i}>{p}</li>)}</ol>
        </section>

        <section className="card">
          <div className="row">
            <div className="section-head">The brief</div>
            <span className="spacer" />
            <button className="btn primary sm" onClick={() => { navigator.clipboard.writeText(brief); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
              {copied ? "Copied ✓" : "Copy for UW"}
            </button>
          </div>
          <pre className="pre mt">{brief}</pre>
        </section>
      </div>
    </div>
  );
}
