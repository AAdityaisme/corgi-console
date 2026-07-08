import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import type {
  Activity,
  Counts,
  ImportReport,
  IntelBundle,
  Lead,
  LogInput,
  QueryResult,
  ViewQuery,
} from "./types";

/** Every mutation surfaces failures — no silent .catch(()=>{}) anywhere. */
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    const msg = typeof e === "string" ? e : (e as Error)?.message || String(e);
    toast.error(`${cmd} failed`, { description: msg.slice(0, 200) });
    throw e;
  }
}

export const importLeads = () => call<ImportReport>("import_leads");
export const migrateLegacy = () => call<string>("migrate_legacy");
export const queryLeads = (view: ViewQuery) => call<QueryResult>("query_leads", { view });
export const pillCounts = (kind: string) => call<Record<string, number>>("pill_counts", { kind });
export const getCounts = () => call<Counts>("counts");
export const getLead = (id: number) => call<{ lead: Lead; activities: unknown[] }>("get_lead", { id });
export const logActivity = (input: LogInput) => call<{ lead: Lead }>("log_activity", { input });
export const undoLast = () => call<string>("undo_last");
export const updateActivity = (id: number, patch: { note?: string; objection?: string; outcome?: string }) =>
  call<{ activity: Activity }>("update_activity", { id, ...patch });
export const updateLead = (id: number, patch: Record<string, unknown>) =>
  call<void>("update_lead", { id, patch });
export const listTable = <T>(table: string) => call<T[]>("list_table", { table });
export const upsertRow = (table: string, row: Record<string, unknown>) =>
  call<number>("upsert_row", { table, row });
export const softDelete = (table: string, id: number) => call<void>("soft_delete", { table, id });
export const getSetting = (key: string) => call<string | null>("get_setting", { key });
export const setSetting = (key: string, value: string) => call<void>("set_setting", { key, value });
export const backupNow = () => call<string>("backup_now");
export const runPipeline = (which: "truckers" | "brokers") => call<string>("run_pipeline", { which });
export const refreshTelegram = (days: number) => call<string>("refresh_telegram", { days });
export const readIntel = (days: number) => call<IntelBundle>("read_intel", { days });
export const readDoc = (rel: string) => call<string>("read_doc", { rel });

export const logRevive = (dot: string, phone: string, outcome: string, note: string, step: string) =>
  call<null>("log_revive", { dot, phone, outcome, note, step });
