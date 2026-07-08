// v3 — SQLite-backed. Leads come from the DB with lifecycle + precomputed signals.

export interface Lead {
  id: number;
  lead_key: string;
  kind: "fleet" | "broker";
  company: string;
  dba: string;
  owner: string;
  phone: string;
  email: string;
  website: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  tz: string; // IANA
  dot: string;
  mc: string;
  units: number;
  drivers: string;
  equipment: string;
  hazmat: string;
  safety_rating: string;
  mileage: string;
  authority_date: string;
  authority_months: number | null;
  insurer: string;
  ins_eff: string;
  ins_cov: string;
  est_renewal: string;
  cancel_date: string;
  cancel_insurer: string;
  susp_type: string;
  susp_date: string;
  trucking_signal: string;
  source: string;
  warmth: number;
  status: string;
  stage: string;
  dnc: number;
  dnc_reason: string | null;
  attempts: number;
  last_attempt: string | null;
  next_eligible: string | null;
  pinned: number;
  angle: string; // RS RW NA PL GEN PARTNER
  angle_why: string;
  priority: number;
  dox_dot: number;
  dox_dec: number;
  renewal_month: string;
  telematics_vendor: string;
  incumbent: string;
  gatekeeper: string;
  cell: string;
  notes_pinned: string;
}

export interface Activity {
  id: number;
  lead_id: number | null;
  ts: string;
  type: string;
  outcome: string;
  script: string;
  objection: string;
  note: string;
  callback_at: string | null;
  duration_s: number | null;
  meta: string;
  edited_at?: string | null;
}

export interface Meeting {
  id: number;
  lead_id: number | null;
  name: string;
  phone: string;
  at: string;
  ae: string;
  dec_page: number;
  t_booking: number;
  t_24: number;
  t_1: number;
  status: string;
  note: string;
}

export interface Deal {
  id: number;
  lead_id: number | null;
  name: string;
  premium: number;
  status: string;
  bind_date: string | null;
  loss_reason: string;
  note: string;
  created_at: string;
  broker_id: number | null;
}

export interface Task {
  id: number;
  lead_id: number | null;
  name: string;
  kind: string;
  due: string;
  done: number;
  note: string;
}

export interface ViewQuery {
  kind: "fleet" | "broker";
  pill?: string;
  search?: string;
  state?: string;
  sort?: string;
  limit?: number;
  offset?: number;
  zone_bonus?: Record<string, number>;
}

export interface QueryResult {
  rows: Lead[];
  total: number;
}

export interface Counts {
  fleets: number;
  brokers: number;
  rescue: number;
  wire: number;
  new_auth: number;
  callbacks_due: number;
  tasks_due: number;
  specialists: number;
}

export interface ImportReport {
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
  fleets: number;
  brokers: number;
}

export interface LogInput {
  lead_id: number;
  outcome: string;
  script?: string;
  objection?: string;
  note?: string;
  callback_at?: string;
  meeting_at?: string;
  duration_s?: number;
  dox_dot?: boolean;
  dox_dec?: boolean;
  renewal_month?: string;
  telematics_vendor?: string;
  dnc_reason?: string;
}

export interface IntelEvent {
  kind: string;
  ts: string;
  company: string;
  dot: string;
  premium: string;
  partner: string;
  source: string;
  broker: string;
  last_step: string;
  idle: string;
  phone: string;
  email: string;
  called: boolean;
  bad: boolean;
  extra: string;
}
export interface Digest {
  ts: string;
  conversion_rate: string;
  manual_review: string;
  policies_bound_24h: string;
  active_premium: string;
  gwp: string;
  organizations: string;
}
export interface IntelBundle {
  source_mtime: string;
  digest: Digest | null;
  events: IntelEvent[];
}

export type View = "today" | "dial" | "brokers" | "pipeline" | "validate" | "intel" | "stats" | "revive";
