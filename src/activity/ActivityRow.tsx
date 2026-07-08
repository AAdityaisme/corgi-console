// A single activity in a timeline. Shared by the Dial history pane (WP-2) and the global Log view (WP-3).
// Anatomy borrowed from Twenty's EventRow: an icon rail (with a continuous vertical line) + a content column.

import type { Activity } from "../types";
import { fmtTime } from "../signals";
import { outcomeMeta } from "./OutcomeChip";

export interface ActivityRowData extends Activity {
  company?: string;
  lead_kind?: "fleet" | "broker";
  edited_at?: string | null;
}

function fmtDur(s: number | null): string {
  if (!s || s <= 0) return "";
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function ActivityRow({
  a,
  showCompany,
  onJump,
}: {
  a: ActivityRowData;
  showCompany?: boolean;
  onJump?: (leadId: number) => void;
}) {
  const m = outcomeMeta(a.outcome);
  const dur = fmtDur(a.duration_s);
  return (
    <div className="tl-row">
      <div className="tl-rail">
        <span className="tl-icon" title={m.label}>{m.icon}</span>
        <span className="tl-line" />
      </div>
      <div className="tl-body">
        <div className="tl-head">
          <span className={`chip ${m.chip}`}>{m.label}</span>
          {showCompany && a.company && (
            <button
              className="link tl-company"
              onClick={() => a.lead_id && onJump?.(a.lead_id)}
              disabled={!a.lead_id || !onJump}
            >
              {a.company}
            </button>
          )}
          <span className="spacer" />
          <span className="dim tl-time">
            {fmtTime(a.ts)}{dur && ` · ${dur}`}{a.edited_at && " · edited"}
          </span>
        </div>
        {a.objection && <div className="tl-obj"><b>OBJ</b> {a.objection}</div>}
        {a.note && <div className="tl-note">{a.note}</div>}
      </div>
    </div>
  );
}
