import { useCallback, useEffect, useState } from "react";
import { Toaster, toast } from "sonner";
import "./App.css";
import {
  backupNow,
  getCounts,
  importLeads,
  listTable,
  migrateLegacy,
  runPipeline,
  undoLast,
} from "./api";
import type { Counts, Task, View } from "./types";
import Today from "./views/Today";
import Dial from "./views/Dial";
import Pipeline from "./views/Pipeline";
import Validate from "./views/Validate";
import Intel from "./views/Intel";
import Revive from "./views/Revive";
import Stats from "./views/Stats";
import Palette from "./views/Palette";

const TABS: Array<{ id: View; label: string; key: string }> = [
  { id: "today", label: "Today", key: "1" },
  { id: "dial", label: "Dial", key: "2" },
  { id: "revive", label: "Revive", key: "8" },
  { id: "brokers", label: "Brokers", key: "3" },
  { id: "pipeline", label: "Pipeline", key: "4" },
  { id: "validate", label: "Validate", key: "5" },
  { id: "intel", label: "Intel", key: "6" },
  { id: "stats", label: "Stats", key: "7" },
];

export interface Shell {
  counts: Counts | null;
  refreshCounts: () => void;
  refreshAll: (full: boolean) => Promise<void>;
  refreshing: boolean;
  goto: (v: View) => void;
  bump: number; // increments after data-changing ops so views can refetch
  poke: () => void;
}

export default function App() {
  const [view, setView] = useState<View>("today");
  const [counts, setCounts] = useState<Counts | null>(null);
  const [booted, setBooted] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [bump, setBump] = useState(0);
  const poke = useCallback(() => setBump((b) => b + 1), []);

  const refreshCounts = useCallback(() => {
    getCounts().then(setCounts).catch(() => {});
  }, []);

  // boot: open DB, first-run import + legacy migration
  useEffect(() => {
    (async () => {
      try {
        let c = await getCounts();
        if (c.fleets + c.brokers === 0) {
          toast.info("First run — importing lead lists…");
          const rep = await importLeads();
          await migrateLegacy();
          toast.success(`Imported ${rep.fleets.toLocaleString()} fleets · ${rep.brokers.toLocaleString()} brokers`);
          c = await getCounts();
        }
        setCounts(c);
        backupNow().catch(() => {}); // daily snapshot; failure is non-fatal but logged by api layer
      } catch {
        /* toasts already fired by api layer */
      } finally {
        setBooted(true);
      }
    })();
  }, []);

  /** Refresh: re-import CSVs (fast). full=true also reruns the python pipelines first. */
  const refreshAll = useCallback(
    async (full: boolean) => {
      setRefreshing(true);
      try {
        if (full) {
          toast.info("Running FMCSA pipeline… (few minutes)");
          await runPipeline("truckers");
          toast.info("Merging broker list…");
          await runPipeline("brokers");
        }
        const rep = await importLeads();
        toast.success(
          `Data refreshed — ${rep.fleets.toLocaleString()} fleets · ${rep.brokers.toLocaleString()} brokers` +
            (rep.errors.length ? ` · ${rep.errors.length} row errors` : "")
        );
        refreshCounts();
        poke();
      } finally {
        setRefreshing(false);
      }
    },
    [refreshCounts, poke]
  );

  // global keys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        undoLast()
          .then((msg) => {
            toast.success(msg);
            poke();
            refreshCounts();
          })
          .catch(() => {});
        return;
      }
      const t = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tab = TABS.find((x) => x.key === e.key);
      if (tab) setView(tab.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [poke, refreshCounts]);

  // callback notifications (persist fired ids in sessionStorage to avoid re-fires)
  useEffect(() => {
    const tick = async () => {
      try {
        const tasks = await listTable<Task>("tasks");
        const due = tasks.filter((t) => t.kind === "callback" && !t.done && new Date(t.due) <= new Date());
        if (!due.length) return;
        const fired = new Set<string>(JSON.parse(sessionStorage.getItem("fired") || "[]"));
        const fresh = due.filter((t) => !fired.has(String(t.id)));
        if (!fresh.length) return;
        const { isPermissionGranted, requestPermission, sendNotification } = await import(
          "@tauri-apps/plugin-notification"
        );
        let ok = await isPermissionGranted();
        if (!ok) ok = (await requestPermission()) === "granted";
        if (ok)
          fresh.forEach((t) => {
            sendNotification({ title: "Callback due", body: `${t.name} — ${t.note || "call now"}` });
            fired.add(String(t.id));
          });
        sessionStorage.setItem("fired", JSON.stringify([...fired]));
      } catch {
        /* not in tauri / no permission */
      }
    };
    const iv = setInterval(tick, 60000);
    tick();
    return () => clearInterval(iv);
  }, []);

  const shell: Shell = { counts, refreshCounts, refreshAll, refreshing, goto: setView, bump, poke };

  return (
    <div className="app">
      <Toaster position="bottom-right" richColors closeButton />
      <nav className="globalnav">
        <div className="gn-brand">Corgi Console</div>
        <div className="gn-tabs">
          {TABS.map((t) => (
            <button key={t.id} className={view === t.id ? "gn-tab on" : "gn-tab"} onClick={() => setView(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="gn-metrics">
          {counts && (
            <>
              <span>{counts.rescue.toLocaleString()} rescue</span>
              <span>{counts.wire.toLocaleString()} wire</span>
              <span className="gn-accent">{counts.callbacks_due} due</span>
            </>
          )}
          <button className="gn-tab" onClick={() => setPaletteOpen(true)} title="⌘K">
            ⌘K
          </button>
        </div>
      </nav>

      <main className="stage">
        {!booted ? (
          <div className="boot">
            <div className="boot-card">Opening database…</div>
          </div>
        ) : (
          <>
            {view === "today" && <Today s={shell} />}
            {view === "dial" && <Dial s={shell} kind="fleet" />}
            {view === "brokers" && <Dial s={shell} kind="broker" />}
            {view === "pipeline" && <Pipeline s={shell} />}
            {view === "validate" && <Validate />}
            {view === "intel" && <Intel s={shell} />}
            {view === "revive" && <Revive s={shell} />}
            {view === "stats" && <Stats s={shell} />}
          </>
        )}
      </main>

      <Palette open={paletteOpen} setOpen={setPaletteOpen} shell={shell} />
    </div>
  );
}
