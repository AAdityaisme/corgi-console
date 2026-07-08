import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { toast } from "sonner";
import type { Shell } from "../App";
import { backupNow, queryLeads, undoLast } from "../api";
import type { Lead, View } from "../types";

export default function Palette({ open, setOpen, shell }: { open: boolean; setOpen: (o: boolean) => void; shell: Shell }) {
  const [q, setQ] = useState("");
  const [leads, setLeads] = useState<Lead[]>([]);

  useEffect(() => {
    if (!open) { setQ(""); setLeads([]); return; }
    const t = setTimeout(() => {
      if (q.trim().length >= 2) {
        queryLeads({ kind: "fleet", search: q.trim(), limit: 5 }).then((r) => setLeads(r.rows)).catch(() => {});
      } else setLeads([]);
    }, 200);
    return () => clearTimeout(t);
  }, [q, open]);

  const go = (v: View) => { shell.goto(v); setOpen(false); };

  if (!open) return null;
  return (
    <div className="palette-overlay" onClick={() => setOpen(false)}>
      <div onClick={(e) => e.stopPropagation()}>
        <Command label="Command palette" className="palette" shouldFilter={leads.length === 0}>
          <Command.Input autoFocus placeholder="Type a command or search leads…" value={q} onValueChange={setQ} />
          <Command.List>
            <Command.Empty>No results.</Command.Empty>
            {leads.length > 0 && (
              <Command.Group heading="Leads">
                {leads.map((l) => (
                  <Command.Item key={l.id} value={`${l.company} ${l.dot}`} onSelect={() => { go("dial"); toast.info(`Search Dial for “${l.company}”`); }}>
                    {l.company} <span className="dim">· {l.state} · DOT {l.dot}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            <Command.Group heading="Go to">
              {(["today", "dial", "brokers", "pipeline", "validate", "intel", "stats"] as View[]).map((v) => (
                <Command.Item key={v} onSelect={() => go(v)}>{v[0].toUpperCase() + v.slice(1)}</Command.Item>
              ))}
            </Command.Group>
            <Command.Group heading="Actions">
              <Command.Item onSelect={() => { shell.refreshAll(false); setOpen(false); }}>Re-import lead CSVs</Command.Item>
              <Command.Item onSelect={() => { shell.refreshAll(true); setOpen(false); }}>Full refresh (run pipelines)</Command.Item>
              <Command.Item onSelect={() => { undoLast().then((m) => { toast.success(m); shell.poke(); }); setOpen(false); }}>Undo last action (⌘Z)</Command.Item>
              <Command.Item onSelect={() => { backupNow().then((p) => toast.success(`Backup → ${p.split("/").pop()}`)); setOpen(false); }}>Back up database now</Command.Item>
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
