// A single follow-up in the inbox. Shared by Today (WP-4) and the Log upcoming panel.
// Pattern from Twenty's TaskRow: rounded checkbox → complete, line-through when done, red when overdue.

import type { Task } from "../types";
import { fmtTime } from "../signals";

export interface TaskRowData extends Task {
  company?: string;
  done_at?: string | null;
}

/** Snooze targets computed from now: +1 day, +3 days, next Monday 9am. Due stored as true UTC. */
export function snoozeTargets(): Array<{ label: string; due: string }> {
  const iso = (d: Date) => d.toISOString(); // local Date → correct UTC instant (no offset math)
  const plus = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return d; };
  const nextMon = () => {
    const d = new Date();
    const delta = (8 - d.getDay()) % 7 || 7; // days until the coming Monday
    d.setDate(d.getDate() + delta);
    d.setHours(9, 0, 0, 0);
    return d;
  };
  return [
    { label: "+1d", due: iso(plus(1)) },
    { label: "+3d", due: iso(plus(3)) },
    { label: "Mon", due: iso(nextMon()) },
  ];
}

export function TaskRow({
  t,
  onDone,
  onSnooze,
  onJump,
}: {
  t: TaskRowData;
  onDone: (id: number, done: boolean) => void;
  onSnooze: (id: number, due: string) => void;
  onJump?: (leadId: number) => void;
}) {
  const done = t.done === 1;
  const overdue = !done && new Date(t.due).getTime() < Date.now();
  return (
    <div className={`task-row${done ? " done" : ""}`}>
      <input
        type="checkbox"
        className="task-check"
        checked={done}
        onChange={(e) => onDone(t.id, e.target.checked)}
        title={done ? "reopen" : "mark done"}
      />
      <div className="task-main">
        <span className="task-name">{t.name || t.note || t.kind}</span>
        {t.company && (
          <button className="link task-company" onClick={() => t.lead_id && onJump?.(t.lead_id)} disabled={!t.lead_id || !onJump}>
            {t.company}
          </button>
        )}
        {t.note && t.name && <span className="dim task-sub"> — {t.note}</span>}
      </div>
      <span className={`task-due${overdue ? " overdue" : ""}`}>{fmtTime(t.due)}</span>
      {!done && (
        <span className="task-snooze">
          {snoozeTargets().map((s) => (
            <button key={s.label} className="pill sm" title={`snooze to ${s.label}`} onClick={() => onSnooze(t.id, s.due)}>
              {s.label}
            </button>
          ))}
        </span>
      )}
    </div>
  );
}
