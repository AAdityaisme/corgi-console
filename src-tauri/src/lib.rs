// Corgi Console v3 — SQLite-backed data layer.
// Rust owns the DB, filesystem, and subprocesses. Frontend gets typed JSON and
// NEVER silently loses a write: every command returns Result and the UI toasts errors.
use rusqlite::{params, params_from_iter, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map as JsonMap, Value as Json};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::State;

pub struct Db(pub Mutex<Connection>);

fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_default()
}
fn corgi_dir() -> PathBuf {
    home().join("Desktop").join("corgi")
}
fn data_dir() -> PathBuf {
    corgi_dir().join("corgi-os-data")
}
fn db_path() -> PathBuf {
    data_dir().join("console.db")
}

// ---------- time helpers (no chrono; dates are ISO strings, epochs are secs) ----------

fn now_epoch() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn iso_to_epoch(s: &str) -> i64 {
    let b = s.as_bytes();
    if b.len() < 10 {
        return 0;
    }
    let num = |from: usize, to: usize| s.get(from..to).and_then(|x| x.parse::<i64>().ok()).unwrap_or(0);
    let (y, mo, d) = (num(0, 4), num(5, 7), num(8, 10));
    let (h, mi, sec) = if b.len() >= 19 { (num(11, 13), num(14, 16), num(17, 19)) } else { (0, 0, 0) };
    let y_adj = if mo <= 2 { y - 1 } else { y };
    let era = if y_adj >= 0 { y_adj } else { y_adj - 399 } / 400;
    let yoe = y_adj - era * 400;
    let mp = (mo + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    (era * 146097 + doe - 719468) * 86400 + h * 3600 + mi * 60 + sec
}

fn epoch_to_date(epoch: i64) -> String {
    let days = epoch.div_euclid(86400);
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mo <= 2 { y + 1 } else { y };
    format!("{:04}-{:02}-{:02}", y, mo, d)
}

fn now_iso() -> String {
    let e = now_epoch();
    format!("{}T{:02}:{:02}:{:02}Z", epoch_to_date(e), (e % 86400) / 3600, (e % 3600) / 60, e % 60)
}

fn days_from_today(date_iso: &str) -> Option<i64> {
    if date_iso.len() < 10 {
        return None;
    }
    Some((iso_to_epoch(date_iso) - now_epoch()).div_euclid(86400))
}

// ---------- schema ----------

const MIGRATIONS: &[&str] = &[
    // v1
    "CREATE TABLE leads(
        id INTEGER PRIMARY KEY,
        lead_key TEXT UNIQUE NOT NULL,
        kind TEXT NOT NULL,
        company TEXT DEFAULT '', dba TEXT DEFAULT '', owner TEXT DEFAULT '',
        phone TEXT DEFAULT '', email TEXT DEFAULT '', website TEXT DEFAULT '',
        street TEXT DEFAULT '', city TEXT DEFAULT '', state TEXT DEFAULT '', zip TEXT DEFAULT '',
        tz TEXT DEFAULT 'America/Chicago',
        dot TEXT DEFAULT '', mc TEXT DEFAULT '', units INTEGER DEFAULT 0, drivers TEXT DEFAULT '',
        equipment TEXT DEFAULT '', hazmat TEXT DEFAULT '', safety_rating TEXT DEFAULT '',
        mileage TEXT DEFAULT '', authority_date TEXT DEFAULT '', authority_months INTEGER,
        insurer TEXT DEFAULT '', ins_eff TEXT DEFAULT '', ins_cov TEXT DEFAULT '',
        est_renewal TEXT DEFAULT '', cancel_date TEXT DEFAULT '', cancel_insurer TEXT DEFAULT '',
        susp_type TEXT DEFAULT '', susp_date TEXT DEFAULT '',
        trucking_signal TEXT DEFAULT '', source TEXT DEFAULT '', warmth INTEGER DEFAULT 0,
        status TEXT DEFAULT 'new', stage TEXT DEFAULT 'uncontacted',
        dnc INTEGER DEFAULT 0, dnc_at TEXT, dnc_reason TEXT,
        attempts INTEGER DEFAULT 0, last_attempt TEXT, next_eligible TEXT,
        pinned INTEGER DEFAULT 0, deleted_at TEXT,
        angle TEXT DEFAULT 'GEN', angle_why TEXT DEFAULT '', priority INTEGER DEFAULT 300,
        dox_dot INTEGER DEFAULT 0, dox_dec INTEGER DEFAULT 0,
        renewal_month TEXT DEFAULT '', telematics_vendor TEXT DEFAULT '',
        incumbent TEXT DEFAULT '', gatekeeper TEXT DEFAULT '', cell TEXT DEFAULT '',
        notes_pinned TEXT DEFAULT ''
    )",
    "CREATE TABLE activities(
        id INTEGER PRIMARY KEY, lead_id INTEGER, ts TEXT NOT NULL,
        type TEXT NOT NULL, outcome TEXT DEFAULT '', script TEXT DEFAULT '',
        objection TEXT DEFAULT '', note TEXT DEFAULT '', callback_at TEXT,
        duration_s INTEGER, meta TEXT DEFAULT '{}'
    )",
    "CREATE TABLE meetings(
        id INTEGER PRIMARY KEY, lead_id INTEGER, name TEXT DEFAULT '', phone TEXT DEFAULT '',
        at TEXT NOT NULL, ae TEXT DEFAULT '', dec_page INTEGER DEFAULT 0,
        t_booking INTEGER DEFAULT 0, t_24 INTEGER DEFAULT 0, t_1 INTEGER DEFAULT 0,
        status TEXT DEFAULT 'upcoming', note TEXT DEFAULT '', deleted_at TEXT
    )",
    "CREATE TABLE deals(
        id INTEGER PRIMARY KEY, lead_id INTEGER, name TEXT DEFAULT '', premium REAL DEFAULT 0,
        status TEXT DEFAULT 'working', bind_date TEXT, loss_reason TEXT DEFAULT '',
        note TEXT DEFAULT '', created_at TEXT, broker_id INTEGER, deleted_at TEXT
    )",
    "CREATE TABLE tasks(
        id INTEGER PRIMARY KEY, lead_id INTEGER, name TEXT DEFAULT '', kind TEXT NOT NULL,
        due TEXT NOT NULL, done INTEGER DEFAULT 0, note TEXT DEFAULT '', deleted_at TEXT
    )",
    "CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT)",
    "CREATE TABLE undo_log(id INTEGER PRIMARY KEY, ts TEXT, description TEXT, revert TEXT)",
    "CREATE INDEX idx_leads_kind ON leads(kind, deleted_at, dnc)",
    "CREATE INDEX idx_activities_lead ON activities(lead_id, ts)",
    "CREATE INDEX idx_tasks_due ON tasks(done, due)",
    "CREATE VIRTUAL TABLE leads_fts USING fts5(text)",
];

const SCHEMA_VERSION: i64 = 2;

/// True if `table` already has a column named `col`. Guards ALTERs against schema drift —
/// meetings.lead_id, for instance, already exists in v1's CREATE TABLE, so a blind ADD would abort.
fn column_exists(conn: &Connection, table: &str, col: &str) -> Result<bool, String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(1))
        .map_err(|e| e.to_string())?;
    for name in rows {
        if name.map_err(|e| e.to_string())? == col {
            return Ok(true);
        }
    }
    Ok(false)
}

fn add_column_if_missing(conn: &Connection, table: &str, col: &str, decl: &str) -> Result<(), String> {
    if !column_exists(conn, table, col)? {
        conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {col} {decl}"))
            .map_err(|e| format!("add {table}.{col}: {e}"))?;
    }
    Ok(())
}

fn open_db() -> Result<Connection, String> {
    fs::create_dir_all(data_dir()).map_err(|e| e.to_string())?;
    let mut conn = Connection::open(db_path()).map_err(|e| e.to_string())?;
    conn.pragma_update(None, "journal_mode", "WAL").map_err(|e| e.to_string())?;
    conn.pragma_update(None, "synchronous", "NORMAL").map_err(|e| e.to_string())?;
    let ver: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0)).map_err(|e| e.to_string())?;
    if ver < 1 {
        for m in MIGRATIONS {
            conn.execute_batch(m).map_err(|e| format!("v1 migration failed: {e}"))?;
        }
    }
    if ver < 2 {
        // Atomic + drift-safe: only add columns that don't already exist (meetings.lead_id
        // ships in v1), then backfill types + indexes. Partial failure rolls back for clean retry.
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        add_column_if_missing(&tx, "activities", "edited_at", "TEXT")?;
        add_column_if_missing(&tx, "tasks", "done_at", "TEXT")?;
        add_column_if_missing(&tx, "meetings", "lead_id", "INTEGER")?;
        tx.execute_batch(
            "UPDATE activities SET type='email' WHERE outcome='EMAIL';
             UPDATE activities SET type='note' WHERE outcome='NOTE';
             CREATE INDEX IF NOT EXISTS idx_activities_ts ON activities(ts);
             CREATE INDEX IF NOT EXISTS idx_tasks_open ON tasks(done, due);",
        )
        .map_err(|e| format!("v2 migration failed: {e}"))?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    conn.pragma_update(None, "user_version", SCHEMA_VERSION).map_err(|e| e.to_string())?;
    Ok(conn)
}

// ---------- signals: THE one place angle/priority live ----------

fn compute_signals(cancel_date: &str, susp_date: &str, est_renewal: &str, authority_months: Option<i64>, units: i64, kind: &str, trucking_signal: &str) -> (String, String, i64) {
    if kind == "broker" {
        let sig = if trucking_signal == "specialist" { "specialist agency" } else { "commercial agency" };
        let p = if trucking_signal == "specialist" { 650 } else { 450 };
        return ("PARTNER".into(), sig.into(), p);
    }
    let dc = if cancel_date.is_empty() { None } else { days_from_today(cancel_date) };
    let ds = if susp_date.is_empty() { None } else { days_from_today(susp_date) };
    let dr = if est_renewal.is_empty() { None } else { days_from_today(est_renewal) };
    // RS: cancellation effective within [-30, +75] days, or suspension served within last 60d
    if let Some(d) = dc {
        if (-30..=75).contains(&d) {
            let why = format!("cancellation effective {} ({:+}d)", cancel_date, d);
            return ("RS".into(), why, 900 - d.abs().min(60));
        }
    }
    if let Some(d) = ds {
        if (-60..=0).contains(&d) {
            return ("RS".into(), format!("suspension order served {}", susp_date), 860);
        }
    }
    if let Some(d) = dr {
        if (0..=75).contains(&d) {
            return ("RW".into(), format!("renewal ~{} ({}d out)", est_renewal, d), 800 - d.min(60));
        }
    }
    if let Some(am) = authority_months {
        if am <= 24 {
            return ("NA".into(), format!("authority {}mo old", am), 600);
        }
    }
    if units > 0 && units <= 3 {
        return ("PL".into(), format!("{} trucks — per-load angle", units), 500);
    }
    ("GEN".into(), "no live signal".into(), 300)
}

fn state_tz(state: &str) -> &'static str {
    match state {
        "CT" | "DE" | "FL" | "GA" | "IN" | "KY" | "ME" | "MD" | "MA" | "MI" | "NH" | "NJ" | "NY" | "NC" | "OH" | "PA" | "RI" | "SC" | "VT" | "VA" | "WV" | "DC" => "America/New_York",
        "AL" | "AR" | "IL" | "IA" | "KS" | "LA" | "MN" | "MS" | "MO" | "NE" | "ND" | "OK" | "SD" | "TN" | "TX" | "WI" => "America/Chicago",
        "CO" | "ID" | "MT" | "NM" | "UT" | "WY" => "America/Denver",
        "AZ" => "America/Phoenix",
        "CA" | "NV" | "OR" | "WA" => "America/Los_Angeles",
        "AK" => "America/Anchorage",
        "HI" => "Pacific/Honolulu",
        _ => "America/Chicago",
    }
}

// ---------- lead_key ----------

fn digits(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_digit()).collect()
}

fn fnv(s: &str) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

fn lead_key(kind: &str, dot: &str, phone: &str, website: &str, name: &str, city: &str) -> String {
    if kind == "fleet" && !dot.is_empty() {
        return format!("fleet:{dot}");
    }
    let ph = digits(phone);
    if ph.len() == 10 {
        return format!("{kind}:{ph}");
    }
    let d = website.to_lowercase().replace("https://", "").replace("http://", "").replace("www.", "");
    let d = d.split('/').next().unwrap_or("");
    if !d.is_empty() {
        return format!("{kind}:d:{d}");
    }
    format!("{kind}:h:{:x}", fnv(&format!("{}|{}", name.to_lowercase(), city.to_lowercase())))
}

// ---------- import ----------

#[derive(Serialize)]
struct ImportReport {
    inserted: i64,
    updated: i64,
    skipped: i64,
    errors: Vec<String>,
    fleets: i64,
    brokers: i64,
}

const DATA_COLS: &[&str] = &[
    "company", "dba", "owner", "phone", "email", "website", "street", "city", "state", "zip",
    "tz", "dot", "mc", "units", "drivers", "equipment", "hazmat", "safety_rating", "mileage",
    "authority_date", "authority_months", "insurer", "ins_eff", "ins_cov", "est_renewal",
    "cancel_date", "cancel_insurer", "susp_type", "susp_date", "trucking_signal", "source",
    "warmth", "angle", "angle_why", "priority",
];

fn import_file(conn: &Connection, path: &PathBuf, kind: &str, report: &mut ImportReport) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let mut rdr = csv::ReaderBuilder::new().flexible(true).from_path(path).map_err(|e| e.to_string())?;
    let headers: Vec<String> = rdr.headers().map_err(|e| e.to_string())?.iter().map(|s| s.to_string()).collect();
    let idx = |name: &str| headers.iter().position(|h| h == name);
    let get = |rec: &csv::StringRecord, name: &str| -> String {
        idx(name).and_then(|i| rec.get(i)).unwrap_or("").trim().to_string()
    };

    let insert_sql = format!(
        "INSERT INTO leads (lead_key, kind, {}) VALUES (?1, ?2, {}) \
         ON CONFLICT(lead_key) DO UPDATE SET {}",
        DATA_COLS.join(", "),
        (0..DATA_COLS.len()).map(|i| format!("?{}", i + 3)).collect::<Vec<_>>().join(", "),
        DATA_COLS.iter().map(|c| format!("{c}=excluded.{c}")).collect::<Vec<_>>().join(", ")
    );
    let mut stmt = conn.prepare(&insert_sql).map_err(|e| e.to_string())?;

    for (rownum, rec) in rdr.records().enumerate() {
        let rec = match rec {
            Ok(r) => r,
            Err(e) => {
                report.errors.push(format!("{kind} row {}: {e}", rownum + 2));
                report.skipped += 1;
                continue;
            }
        };
        let company = if kind == "fleet" { get(&rec, "company") } else { get(&rec, "agency") };
        let phone = get(&rec, "phone");
        let website = get(&rec, "website");
        let dot = get(&rec, "dot");
        if company.is_empty() || (digits(&phone).len() != 10 && website.is_empty() && dot.is_empty()) {
            report.skipped += 1;
            continue;
        }
        let city = get(&rec, "city");
        let state = get(&rec, "state");
        let key = lead_key(kind, &dot, &phone, &website, &company, &city);
        let units: i64 = get(&rec, "units").parse().unwrap_or(0);
        let am: Option<i64> = get(&rec, "authority_months").parse().ok();
        let cancel = get(&rec, "cancel_date");
        let susp = get(&rec, "susp_date");
        let renewal = get(&rec, "est_renewal");
        let tsignal = get(&rec, "trucking_signal");
        let (angle, why, prio) = compute_signals(&cancel, &susp, &renewal, am, units, kind, &tsignal);
        let warmth: i64 = get(&rec, "score").parse().unwrap_or(0);

        let vals: Vec<String> = vec![
            company.clone(), get(&rec, "dba"), get(&rec, "owner"), phone.clone(), get(&rec, "email"),
            website.clone(), get(&rec, "street"), city.clone(), state.clone(), get(&rec, "zip"),
            state_tz(&state).to_string(), dot.clone(), get(&rec, "mc"), units.to_string(),
            get(&rec, "drivers"), get(&rec, "equipment"), get(&rec, "hazmat"), get(&rec, "safety_rating"),
            get(&rec, "mileage"), get(&rec, "authority_date"),
            am.map(|v| v.to_string()).unwrap_or_default(), get(&rec, "insurer"), get(&rec, "ins_eff"),
            get(&rec, "ins_cov"), renewal.clone(), cancel.clone(), get(&rec, "cancel_insurer"),
            get(&rec, "susp_type"), susp.clone(), tsignal, get(&rec, "source"), warmth.to_string(),
            angle, why, prio.to_string(),
        ];
        let existed: bool = conn
            .query_row("SELECT 1 FROM leads WHERE lead_key=?1", params![key], |_| Ok(true))
            .unwrap_or(false);
        let mut p: Vec<&dyn rusqlite::ToSql> = vec![&key, &kind];
        for v in &vals {
            p.push(v);
        }
        match stmt.execute(params_from_iter(p.iter().map(|x| *x))) {
            Ok(_) => {
                if existed { report.updated += 1 } else { report.inserted += 1 }
            }
            Err(e) => {
                report.errors.push(format!("{kind} row {} ({}): {e}", rownum + 2, company));
                report.skipped += 1;
            }
        }
    }
    Ok(())
}

fn rebuild_fts(conn: &Connection) -> Result<(), String> {
    conn.execute("DELETE FROM leads_fts", []).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO leads_fts(rowid, text) \
         SELECT id, company||' '||dba||' '||owner||' '||city||' '||state||' '||dot||' '||replace(phone,'-','') FROM leads WHERE deleted_at IS NULL",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn import_leads(db: State<Db>) -> Result<ImportReport, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut report = ImportReport { inserted: 0, updated: 0, skipped: 0, errors: vec![], fleets: 0, brokers: 0 };
    import_file(&conn, &data_dir().join("truckers.csv"), "fleet", &mut report)?;
    import_file(&conn, &data_dir().join("brokers.csv"), "broker", &mut report)?;
    rebuild_fts(&conn)?;
    report.fleets = conn.query_row("SELECT COUNT(*) FROM leads WHERE kind='fleet' AND deleted_at IS NULL", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    report.brokers = conn.query_row("SELECT COUNT(*) FROM leads WHERE kind='broker' AND deleted_at IS NULL", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    report.errors.truncate(20);
    Ok(report)
}

// ---------- legacy migration (state.json + calls.jsonl → tables, one-time) ----------

fn legacy_lead_id(conn: &Connection, legacy: &str) -> Option<i64> {
    // v2 ids: "fleet:<dot>" or "broker:(xxx) xxx-xxxx"
    if let Some(dot) = legacy.strip_prefix("fleet:") {
        return conn.query_row("SELECT id FROM leads WHERE kind='fleet' AND dot=?1", params![dot], |r| r.get(0)).ok();
    }
    if let Some(ph) = legacy.strip_prefix("broker:") {
        let d = digits(ph);
        if d.len() == 10 {
            let key = format!("broker:{d}");
            return conn.query_row("SELECT id FROM leads WHERE lead_key=?1", params![key], |r| r.get(0)).ok();
        }
    }
    None
}

#[tauri::command]
fn migrate_legacy(db: State<Db>) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let done: bool = conn
        .query_row("SELECT 1 FROM settings WHERE key='legacy_migrated'", [], |_| Ok(true))
        .unwrap_or(false);
    if done {
        return Ok("already migrated".into());
    }
    let sj = data_dir().join("state.json");
    let mut n_calls = 0;
    let mut n_other = 0;
    if sj.exists() {
        let s: Json = serde_json::from_str(&fs::read_to_string(&sj).map_err(|e| e.to_string())?).unwrap_or(json!({}));
        for c in s["calls"].as_array().unwrap_or(&vec![]) {
            let lid = c["leadId"].as_str().and_then(|l| legacy_lead_id(&conn, l));
            conn.execute(
                "INSERT INTO activities(lead_id, ts, type, outcome, script, objection, note, callback_at, duration_s, meta) \
                 VALUES (?1,?2,'call',?3,?4,?5,?6,?7,?8,?9)",
                params![
                    lid,
                    c["ts"].as_str().unwrap_or(""),
                    c["outcome"].as_str().unwrap_or(""),
                    c["script"].as_str().unwrap_or(""),
                    c["objection"].as_str().unwrap_or(""),
                    c["note"].as_str().unwrap_or(""),
                    c["callbackAt"].as_str(),
                    c["durationSec"].as_i64(),
                    json!({"name": c["name"], "phone": c["phone"], "legacy": true}).to_string()
                ],
            )
            .map_err(|e| e.to_string())?;
            n_calls += 1;
        }
        for m in s["meetings"].as_array().unwrap_or(&vec![]) {
            let lid = m["leadId"].as_str().and_then(|l| legacy_lead_id(&conn, l));
            conn.execute(
                "INSERT INTO meetings(lead_id, name, phone, at, ae, dec_page, t_booking, t_24, t_1, status, note) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                params![
                    lid, m["name"].as_str().unwrap_or(""), m["phone"].as_str().unwrap_or(""),
                    m["at"].as_str().unwrap_or(""), m["ae"].as_str().unwrap_or(""),
                    m["decPage"].as_bool().unwrap_or(false) as i64,
                    m["touches"]["booking"].as_bool().unwrap_or(false) as i64,
                    m["touches"]["h24"].as_bool().unwrap_or(false) as i64,
                    m["touches"]["h1"].as_bool().unwrap_or(false) as i64,
                    m["status"].as_str().unwrap_or("upcoming"), m["note"].as_str().unwrap_or("")
                ],
            )
            .map_err(|e| e.to_string())?;
            n_other += 1;
        }
        for d in s["deals"].as_array().unwrap_or(&vec![]) {
            let lid = d["leadId"].as_str().and_then(|l| legacy_lead_id(&conn, l));
            conn.execute(
                "INSERT INTO deals(lead_id, name, premium, status, bind_date, loss_reason, note, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                params![
                    lid, d["name"].as_str().unwrap_or(""), d["premium"].as_f64().unwrap_or(0.0),
                    d["status"].as_str().unwrap_or("working"), d["bindDate"].as_str(),
                    d["lossReason"].as_str().unwrap_or(""), d["note"].as_str().unwrap_or(""),
                    d["createdAt"].as_str().unwrap_or("")
                ],
            )
            .map_err(|e| e.to_string())?;
            n_other += 1;
        }
        for t in s["tasks"].as_array().unwrap_or(&vec![]) {
            let lid = t["leadId"].as_str().and_then(|l| legacy_lead_id(&conn, l));
            conn.execute(
                "INSERT INTO tasks(lead_id, name, kind, due, done, note) VALUES (?1,?2,?3,?4,?5,?6)",
                params![
                    lid, t["name"].as_str().unwrap_or(""), t["kind"].as_str().unwrap_or("callback"),
                    t["due"].as_str().unwrap_or(""), t["done"].as_bool().unwrap_or(false) as i64,
                    t["note"].as_str().unwrap_or("")
                ],
            )
            .map_err(|e| e.to_string())?;
            n_other += 1;
        }
        if let Some(ov) = s["overrides"].as_object() {
            for (legacy, o) in ov {
                if let Some(lid) = legacy_lead_id(&conn, legacy) {
                    conn.execute(
                        "UPDATE leads SET dnc=?1, status=COALESCE(?2,status), attempts=?3, last_attempt=?4, next_eligible=?5 WHERE id=?6",
                        params![
                            o["doNotCall"].as_bool().unwrap_or(false) as i64,
                            o["status"].as_str(),
                            o["attempts"].as_i64().unwrap_or(0),
                            o["lastAttempt"].as_str(),
                            o["nextEligible"].as_str(),
                            lid
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                    n_other += 1;
                }
            }
        }
        let _ = fs::rename(&sj, data_dir().join("state.json.bak"));
    }
    conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('legacy_migrated','1')", []).map_err(|e| e.to_string())?;
    Ok(format!("migrated {n_calls} calls + {n_other} records"))
}

// ---------- query ----------

#[derive(Deserialize)]
struct ViewQuery {
    kind: String,
    pill: Option<String>,          // queue|rescue|wire|na|callbacks|worked|all|specialist|commercial|has_email|stage:<x>
    search: Option<String>,
    state: Option<String>,
    sort: Option<String>,          // priority|warmth|company|attempts
    limit: Option<i64>,
    offset: Option<i64>,
    zone_bonus: Option<HashMap<String, i64>>, // IANA zone -> bonus (frontend computes DST-correct windows)
}

fn pill_where(pill: &str, now: &str) -> String {
    match pill {
        "queue" => format!("AND dnc=0 AND status!='dead' AND (next_eligible IS NULL OR next_eligible<='{now}')"),
        "rescue" => "AND angle='RS'".into(),
        "wire" => "AND angle='RW'".into(),
        "na" => "AND angle='NA'".into(),
        "callbacks" => format!("AND EXISTS(SELECT 1 FROM tasks t WHERE t.lead_id=leads.id AND t.kind='callback' AND t.done=0 AND t.deleted_at IS NULL AND t.due<='{now}')"),
        "worked" => "AND attempts>0".into(),
        "specialist" => "AND trucking_signal='specialist'".into(),
        "commercial" => "AND trucking_signal!='specialist'".into(),
        "has_email" => "AND email!=''".into(),
        p if p.starts_with("stage:") => format!("AND stage='{}'", p.trim_start_matches("stage:").replace('\'', "")),
        _ => "".into(),
    }
}

fn zone_case(zone_bonus: &Option<HashMap<String, i64>>) -> String {
    match zone_bonus {
        Some(m) if !m.is_empty() => {
            let mut s = String::from("CASE tz ");
            for (z, b) in m {
                s.push_str(&format!("WHEN '{}' THEN {} ", z.replace('\'', ""), b));
            }
            s.push_str("ELSE 0 END");
            s
        }
        _ => "0".into(),
    }
}

fn row_to_json(cols: &[String], row: &rusqlite::Row) -> Json {
    let mut obj = JsonMap::new();
    for (i, name) in cols.iter().enumerate() {
        let v: Json = match row.get_ref(i) {
            Ok(rusqlite::types::ValueRef::Null) => Json::Null,
            Ok(rusqlite::types::ValueRef::Integer(n)) => json!(n),
            Ok(rusqlite::types::ValueRef::Real(f)) => json!(f),
            Ok(rusqlite::types::ValueRef::Text(t)) => json!(String::from_utf8_lossy(t)),
            _ => Json::Null,
        };
        obj.insert(name.to_string(), v);
    }
    Json::Object(obj)
}

#[tauri::command]
fn query_leads(db: State<Db>, view: ViewQuery) -> Result<Json, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = now_iso();
    let mut wh = format!("WHERE kind='{}' AND deleted_at IS NULL ", if view.kind == "broker" { "broker" } else { "fleet" });
    wh.push_str(&pill_where(view.pill.as_deref().unwrap_or("all"), &now));
    if let Some(st) = &view.state {
        if !st.is_empty() {
            wh.push_str(&format!(" AND state='{}'", st.replace('\'', "")));
        }
    }
    // search via FTS
    let mut fts_ids: Option<Vec<i64>> = None;
    if let Some(q) = &view.search {
        let q = q.trim();
        if !q.is_empty() {
            let toks: Vec<String> = q
                .split_whitespace()
                .map(|t| format!("\"{}\"*", t.replace('"', "")))
                .collect();
            let match_q = toks.join(" ");
            let mut st = conn.prepare("SELECT rowid FROM leads_fts WHERE leads_fts MATCH ?1 LIMIT 3000").map_err(|e| e.to_string())?;
            let ids: Vec<i64> = st
                .query_map(params![match_q], |r| r.get(0))
                .map_err(|e| e.to_string())?
                .filter_map(|x| x.ok())
                .collect();
            fts_ids = Some(ids);
        }
    }
    if let Some(ids) = &fts_ids {
        if ids.is_empty() {
            return Ok(json!({"rows": [], "total": 0}));
        }
        let list = ids.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(",");
        wh.push_str(&format!(" AND id IN ({list})"));
    }

    let total: i64 = conn
        .query_row(&format!("SELECT COUNT(*) FROM leads {wh}"), [], |r| r.get(0))
        .map_err(|e| e.to_string())?;

    let zc = zone_case(&view.zone_bonus);
    let cb_boost = format!(
        "(CASE WHEN EXISTS(SELECT 1 FROM tasks t WHERE t.lead_id=leads.id AND t.kind='callback' AND t.done=0 AND t.deleted_at IS NULL AND t.due<='{now}') THEN 1000 ELSE 0 END)"
    );
    let order = match view.sort.as_deref() {
        Some("company") => "company COLLATE NOCASE ASC".to_string(),
        Some("warmth") => "warmth DESC".to_string(),
        Some("attempts") => "attempts DESC, last_attempt DESC".to_string(),
        _ => format!("(priority + {zc} + {cb_boost} + pinned*2000) DESC, warmth DESC"),
    };
    let limit = view.limit.unwrap_or(200).min(1000);
    let offset = view.offset.unwrap_or(0);
    let sql = format!("SELECT * FROM leads {wh} ORDER BY {order} LIMIT {limit} OFFSET {offset}");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let cols: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let mut rows_out = Vec::new();
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        rows_out.push(row_to_json(&cols, row));
    }
    Ok(json!({"rows": rows_out, "total": total}))
}

#[tauri::command]
fn pill_counts(db: State<Db>, kind: String) -> Result<Json, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = now_iso();
    let k = if kind == "broker" { "broker" } else { "fleet" };
    let pills: Vec<&str> = if k == "broker" {
        vec!["all", "queue", "specialist", "commercial", "has_email", "worked", "callbacks",
             "stage:uncontacted", "stage:pitched", "stage:docs_sent", "stage:appointed", "stage:producing"]
    } else {
        vec!["all", "queue", "rescue", "wire", "na", "callbacks", "worked"]
    };
    let mut out = JsonMap::new();
    for p in pills {
        let wh = format!("WHERE kind='{k}' AND deleted_at IS NULL {}", pill_where(p, &now));
        let n: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM leads {wh}"), [], |r| r.get(0)).map_err(|e| e.to_string())?;
        out.insert(p.to_string(), json!(n));
    }
    Ok(Json::Object(out))
}

#[tauri::command]
fn counts(db: State<Db>) -> Result<Json, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = now_iso();
    let q = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap_or(0) };
    Ok(json!({
        "fleets": q("SELECT COUNT(*) FROM leads WHERE kind='fleet' AND deleted_at IS NULL"),
        "brokers": q("SELECT COUNT(*) FROM leads WHERE kind='broker' AND deleted_at IS NULL"),
        "rescue": q("SELECT COUNT(*) FROM leads WHERE kind='fleet' AND deleted_at IS NULL AND angle='RS'"),
        "wire": q("SELECT COUNT(*) FROM leads WHERE kind='fleet' AND deleted_at IS NULL AND angle='RW'"),
        "new_auth": q("SELECT COUNT(*) FROM leads WHERE kind='fleet' AND deleted_at IS NULL AND angle='NA'"),
        "callbacks_due": q(&format!("SELECT COUNT(*) FROM tasks WHERE kind='callback' AND done=0 AND deleted_at IS NULL AND due<='{now}'")),
        "tasks_due": q(&format!("SELECT COUNT(*) FROM tasks WHERE done=0 AND deleted_at IS NULL AND due<='{now}'")),
        "specialists": q("SELECT COUNT(*) FROM leads WHERE kind='broker' AND deleted_at IS NULL AND trucking_signal='specialist'"),
    }))
}

#[tauri::command]
fn get_lead(db: State<Db>, id: i64) -> Result<Json, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT * FROM leads WHERE id=?1").map_err(|e| e.to_string())?;
    let lcols: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let lead = {
        let mut rows = stmt.query(params![id]).map_err(|e| e.to_string())?;
        match rows.next().map_err(|e| e.to_string())? {
            Some(row) => row_to_json(&lcols, row),
            None => return Err("lead not found".into()),
        }
    };
    let mut astmt = conn.prepare("SELECT * FROM activities WHERE lead_id=?1 ORDER BY ts DESC LIMIT 200").map_err(|e| e.to_string())?;
    let acols: Vec<String> = astmt.column_names().iter().map(|s| s.to_string()).collect();
    let mut acts = Vec::new();
    let mut rows = astmt.query(params![id]).map_err(|e| e.to_string())?;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        acts.push(row_to_json(&acols, row));
    }
    Ok(json!({"lead": lead, "activities": acts}))
}

// ---------- mutations ----------

#[derive(Deserialize)]
struct LogInput {
    lead_id: i64,
    outcome: String,
    script: Option<String>,
    objection: Option<String>,
    note: Option<String>,
    callback_at: Option<String>,
    meeting_at: Option<String>,
    duration_s: Option<i64>,
    dox_dot: Option<bool>,
    dox_dec: Option<bool>,
    renewal_month: Option<String>,
    telematics_vendor: Option<String>,
    dnc_reason: Option<String>,
    spacing_attempts: Option<i64>,
    spacing_days: Option<i64>,
    rest_days: Option<i64>,
}

#[tauri::command]
fn log_revive(db: State<Db>, dot: String, phone: String, outcome: String, note: String, step: String) -> Result<(), String> {
    let guard = db.0.lock().map_err(|e| e.to_string())?;
    guard.execute(
        "INSERT INTO activities(lead_id, ts, type, outcome, script, objection, note, callback_at, duration_s, meta) VALUES (NULL,?1,'call',?2,'REVIVE','',?3,NULL,NULL,?4)",
        params![now_iso(), outcome, note, json!({"src":"revive","dot":dot,"phone":phone,"step":step}).to_string()],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn log_activity(db: State<Db>, input: LogInput) -> Result<Json, String> {
    let mut guard = db.0.lock().map_err(|e| e.to_string())?;
    let tx = guard.transaction().map_err(|e| e.to_string())?;
    let now = now_iso();

    // snapshot for undo
    let prev: Json = {
        let mut stmt = tx.prepare("SELECT * FROM leads WHERE id=?1").map_err(|e| e.to_string())?;
        let cols: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        let mut rows = stmt.query(params![input.lead_id]).map_err(|e| e.to_string())?;
        match rows.next().map_err(|e| e.to_string())? {
            Some(row) => row_to_json(&cols, row),
            None => return Err("lead not found".into()),
        }
    };
    let name = prev["company"].as_str().unwrap_or("").to_string();
    let phone = prev["phone"].as_str().unwrap_or("").to_string();
    // Honest activity type from outcome (was hardcoded 'call' — emails/notes were mistyped).
    let atype = match input.outcome.as_str() {
        "EMAIL" => "email",
        "NOTE" => "note",
        _ => "call",
    };

    tx.execute(
        &format!("INSERT INTO activities(lead_id, ts, type, outcome, script, objection, note, callback_at, duration_s, meta) VALUES (?1,?2,'{atype}',?3,?4,?5,?6,?7,?8,?9)"),
        params![
            input.lead_id, now, input.outcome,
            input.script.clone().unwrap_or_default(), input.objection.clone().unwrap_or_default(),
            input.note.clone().unwrap_or_default(), input.callback_at, input.duration_s,
            json!({"name": name, "phone": phone}).to_string()
        ],
    )
    .map_err(|e| e.to_string())?;
    let act_id = tx.last_insert_rowid();

    // lifecycle
    let attempts = prev["attempts"].as_i64().unwrap_or(0) + 1;
    let max_a = input.spacing_attempts.unwrap_or(3).max(1);
    let gap_d = input.spacing_days.unwrap_or(2);
    let rest_d = input.rest_days.unwrap_or(14);
    let (mut status, mut next_el): (String, Option<String>) = (prev["status"].as_str().unwrap_or("new").to_string(), None);
    let mut dnc = 0i64;
    match input.outcome.as_str() {
        "DNC" => {
            dnc = 1;
            status = "dead".into();
        }
        "BN" => {
            // bad/disconnected number — drop from the queue but NOT a compliance DNC (dnc stays 0),
            // and don't schedule a callback (there's no working number to call).
            status = "dead".into();
        }
        "BM" => {
            status = "working".into();
        }
        _ => {
            if ["DM", "NI"].contains(&input.outcome.as_str()) {
                status = "working".into();
            }
            let rest_now = attempts % max_a == 0;
            let gap = if rest_now { rest_d } else { gap_d };
            next_el = Some(format!("{}T00:00:00Z", epoch_to_date(now_epoch() + gap * 86400)));
            if rest_now {
                status = "recycle".into();
            }
        }
    }
    // broker stage auto-advance on first touch
    let stage_sql = if prev["kind"].as_str() == Some("broker") && prev["stage"].as_str() == Some("uncontacted") {
        ", stage='pitched'"
    } else {
        ""
    };
    tx.execute(
        &format!(
            "UPDATE leads SET attempts=?1, last_attempt=?2, next_eligible=?3, status=?4, \
             dnc=CASE WHEN ?5=1 THEN 1 ELSE dnc END, dnc_at=CASE WHEN ?5=1 THEN ?2 ELSE dnc_at END, dnc_reason=CASE WHEN ?5=1 THEN ?6 ELSE dnc_reason END, \
             dox_dot=MAX(dox_dot, ?7), dox_dec=MAX(dox_dec, ?8), \
             renewal_month=CASE WHEN ?9!='' THEN ?9 ELSE renewal_month END, \
             telematics_vendor=CASE WHEN ?10!='' THEN ?10 ELSE telematics_vendor END{stage_sql} \
             WHERE id=?11"
        ),
        params![
            attempts, now, next_el, status, dnc,
            input.dnc_reason.clone().unwrap_or_default(),
            input.dox_dot.unwrap_or(false) as i64, input.dox_dec.unwrap_or(false) as i64,
            input.renewal_month.clone().unwrap_or_default(),
            input.telematics_vendor.clone().unwrap_or_default(),
            input.lead_id
        ],
    )
    .map_err(|e| e.to_string())?;

    // spawned records
    let mut spawned: Vec<i64> = vec![];
    if input.outcome == "CB" {
        if let Some(cb) = &input.callback_at {
            tx.execute(
                "INSERT INTO tasks(lead_id, name, kind, due, note) VALUES (?1,?2,'callback',?3,?4)",
                params![input.lead_id, name, cb, input.note.clone().unwrap_or_default()],
            )
            .map_err(|e| e.to_string())?;
            spawned.push(tx.last_insert_rowid());
        }
    }
    if input.outcome == "BM" {
        if let Some(at) = &input.meeting_at {
            tx.execute(
                "INSERT INTO meetings(lead_id, name, phone, at) VALUES (?1,?2,?3,?4)",
                params![input.lead_id, name, phone, at],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    if ["VM", "NA"].contains(&input.outcome.as_str()) {
        tx.execute(
            "INSERT INTO tasks(lead_id, name, kind, due, note) VALUES (?1,?2,'email',?3,'send follow-up email')",
            params![input.lead_id, name, now],
        )
        .map_err(|e| e.to_string())?;
        spawned.push(tx.last_insert_rowid());
    }
    // renewal-month capture → 45-day-ahead callback
    if let Some(rm) = &input.renewal_month {
        if !rm.is_empty() && input.outcome != "BM" {
            if let Ok(due_e) = rm.parse::<String>().map(|m| iso_to_epoch(&format!("{m}-01")) - 45 * 86400) {
                if due_e > now_epoch() {
                    tx.execute(
                        "INSERT INTO tasks(lead_id, name, kind, due, note) VALUES (?1,?2,'callback',?3,'45 days before stated renewal')",
                        params![input.lead_id, name, format!("{}T16:00:00Z", epoch_to_date(due_e))],
                    )
                    .map_err(|e| e.to_string())?;
                    spawned.push(tx.last_insert_rowid());
                }
            }
        }
    }

    tx.execute(
        "INSERT INTO undo_log(ts, description, revert) VALUES (?1,?2,?3)",
        params![
            now,
            format!("{} — {}", input.outcome, name),
            json!({"kind":"log_activity","activity_id":act_id,"lead_prev":prev,"task_ids":spawned}).to_string()
        ],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;

    let conn = &*guard;
    let mut stmt = conn.prepare("SELECT * FROM leads WHERE id=?1").map_err(|e| e.to_string())?;
    let cols: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let mut rows = stmt.query(params![input.lead_id]).map_err(|e| e.to_string())?;
    let lead = match rows.next().map_err(|e| e.to_string())? {
        Some(row) => row_to_json(&cols, row),
        None => Json::Null,
    };
    Ok(json!({"lead": lead}))
}

#[tauri::command]
fn undo_last(db: State<Db>) -> Result<String, String> {
    let mut guard = db.0.lock().map_err(|e| e.to_string())?;
    let tx = guard.transaction().map_err(|e| e.to_string())?;
    let (uid, desc, revert): (i64, String, String) = match tx.query_row(
        "SELECT id, description, revert FROM undo_log ORDER BY id DESC LIMIT 1",
        [],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    ) {
        Ok(v) => v,
        Err(_) => return Err("nothing to undo".into()),
    };
    let rv: Json = serde_json::from_str(&revert).map_err(|e| e.to_string())?;
    match rv["kind"].as_str() {
        Some("log_activity") => {
            if let Some(aid) = rv["activity_id"].as_i64() {
                tx.execute("DELETE FROM activities WHERE id=?1", params![aid]).map_err(|e| e.to_string())?;
            }
            for t in rv["task_ids"].as_array().unwrap_or(&vec![]) {
                if let Some(tid) = t.as_i64() {
                    tx.execute("DELETE FROM tasks WHERE id=?1", params![tid]).map_err(|e| e.to_string())?;
                }
            }
            let p = &rv["lead_prev"];
            if let Some(id) = p["id"].as_i64() {
                tx.execute(
                    "UPDATE leads SET attempts=?1, last_attempt=?2, next_eligible=?3, status=?4, dnc=?5, dnc_at=?6, dnc_reason=?7, dox_dot=?8, dox_dec=?9, renewal_month=?10, telematics_vendor=?11, stage=?12 WHERE id=?13",
                    params![
                        p["attempts"].as_i64().unwrap_or(0), p["last_attempt"].as_str(), p["next_eligible"].as_str(),
                        p["status"].as_str().unwrap_or("new"), p["dnc"].as_i64().unwrap_or(0), p["dnc_at"].as_str(),
                        p["dnc_reason"].as_str(), p["dox_dot"].as_i64().unwrap_or(0), p["dox_dec"].as_i64().unwrap_or(0),
                        p["renewal_month"].as_str().unwrap_or(""), p["telematics_vendor"].as_str().unwrap_or(""),
                        p["stage"].as_str().unwrap_or("uncontacted"), id
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        Some("update_activity") => {
            if let Some(aid) = rv["id"].as_i64() {
                let p = &rv["prev"];
                tx.execute(
                    "UPDATE activities SET note=?1, objection=?2, outcome=?3, edited_at=?4 WHERE id=?5",
                    params![
                        p["note"].as_str().unwrap_or(""), p["objection"].as_str().unwrap_or(""),
                        p["outcome"].as_str().unwrap_or(""), p["edited_at"].as_str(), aid
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        Some("soft_delete") => {
            let table = rv["table"].as_str().unwrap_or("");
            if ["meetings", "deals", "tasks", "leads"].contains(&table) {
                if let Some(id) = rv["id"].as_i64() {
                    tx.execute(&format!("UPDATE {table} SET deleted_at=NULL WHERE id=?1"), params![id]).map_err(|e| e.to_string())?;
                }
            }
        }
        _ => return Err("unknown undo entry".into()),
    }
    tx.execute("DELETE FROM undo_log WHERE id=?1", params![uid]).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(format!("undid: {desc}"))
}

#[tauri::command]
fn update_activity(
    db: State<Db>,
    id: i64,
    note: Option<String>,
    objection: Option<String>,
    outcome: Option<String>,
) -> Result<Json, String> {
    let mut guard = db.0.lock().map_err(|e| e.to_string())?;
    let tx = guard.transaction().map_err(|e| e.to_string())?;
    let (prev_ts, prev_note, prev_obj, prev_outcome, prev_edited): (String, String, String, String, Option<String>) = tx
        .query_row(
            "SELECT ts, note, objection, outcome, edited_at FROM activities WHERE id=?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .map_err(|_| "activity not found".to_string())?;
    let now = now_iso();
    // Outcome edits only allowed same-day — after the day closes it's history; undo instead.
    if let Some(oc) = &outcome {
        if oc != &prev_outcome && prev_ts.get(0..10) != now.get(0..10) {
            return Err("outcome locked after day close — undo the log instead".into());
        }
    }
    tx.execute(
        "UPDATE activities SET note=?1, objection=?2, outcome=?3, edited_at=?4 WHERE id=?5",
        params![
            note.unwrap_or(prev_note.clone()),
            objection.unwrap_or(prev_obj.clone()),
            outcome.unwrap_or(prev_outcome.clone()),
            now,
            id
        ],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO undo_log(ts, description, revert) VALUES (?1,?2,?3)",
        params![
            now,
            format!("edit activity {id}"),
            json!({"kind":"update_activity","id":id,"prev":{
                "note":prev_note,"objection":prev_obj,"outcome":prev_outcome,"edited_at":prev_edited
            }})
            .to_string()
        ],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    let conn = &*guard;
    let mut stmt = conn.prepare("SELECT * FROM activities WHERE id=?1").map_err(|e| e.to_string())?;
    let cols: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let mut rows = stmt.query(params![id]).map_err(|e| e.to_string())?;
    let act = match rows.next().map_err(|e| e.to_string())? {
        Some(row) => row_to_json(&cols, row),
        None => Json::Null,
    };
    Ok(json!({ "activity": act }))
}

#[tauri::command]
fn update_lead(db: State<Db>, id: i64, patch: Json) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let allowed = [
        "owner", "email", "cell", "gatekeeper", "incumbent", "notes_pinned", "pinned", "status",
        "stage", "renewal_month", "telematics_vendor", "dox_dot", "dox_dec", "est_renewal",
    ];
    let obj = patch.as_object().ok_or("patch must be object")?;
    for (k, v) in obj {
        if !allowed.contains(&k.as_str()) {
            return Err(format!("field not editable: {k}"));
        }
        let sql = format!("UPDATE leads SET {k}=?1 WHERE id=?2");
        match v {
            Json::String(s) => conn.execute(&sql, params![s, id]).map_err(|e| e.to_string())?,
            Json::Number(n) => conn.execute(&sql, params![n.as_i64().unwrap_or(0), id]).map_err(|e| e.to_string())?,
            Json::Bool(b) => conn.execute(&sql, params![*b as i64, id]).map_err(|e| e.to_string())?,
            _ => return Err(format!("bad value for {k}")),
        };
    }
    Ok(())
}

#[tauri::command]
fn list_table(db: State<Db>, table: String) -> Result<Json, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let sql = match table.as_str() {
        "meetings" => "SELECT * FROM meetings WHERE deleted_at IS NULL ORDER BY at ASC",
        "deals" => "SELECT * FROM deals WHERE deleted_at IS NULL ORDER BY created_at DESC",
        "tasks" => "SELECT * FROM tasks WHERE deleted_at IS NULL AND done=0 ORDER BY due ASC LIMIT 500",
        "activities" => "SELECT * FROM activities ORDER BY ts DESC LIMIT 20000",
        _ => return Err("unknown table".into()),
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let cols: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let mut out = Vec::new();
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        out.push(row_to_json(&cols, row));
    }
    Ok(Json::Array(out))
}

#[tauri::command]
fn upsert_row(db: State<Db>, table: String, row: Json) -> Result<i64, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let cols: &[&str] = match table.as_str() {
        "meetings" => &["lead_id", "name", "phone", "at", "ae", "dec_page", "t_booking", "t_24", "t_1", "status", "note"],
        "deals" => &["lead_id", "name", "premium", "status", "bind_date", "loss_reason", "note", "created_at", "broker_id"],
        "tasks" => &["lead_id", "name", "kind", "due", "done", "note"],
        _ => return Err("unknown table".into()),
    };
    let obj = row.as_object().ok_or("row must be object")?;
    let id = obj.get("id").and_then(|v| v.as_i64());
    let present: Vec<&&str> = cols.iter().filter(|c| obj.contains_key(**c)).collect();
    if present.is_empty() {
        return Err("no valid fields".into());
    }
    let to_sql = |v: &Json| -> String {
        match v {
            Json::String(s) => format!("'{}'", s.replace('\'', "''")),
            Json::Number(n) => n.to_string(),
            Json::Bool(b) => if *b { "1".into() } else { "0".into() },
            Json::Null => "NULL".into(),
            _ => "NULL".into(),
        }
    };
    if let Some(id) = id {
        let sets = present.iter().map(|c| format!("{c}={}", to_sql(&obj[**c]))).collect::<Vec<_>>().join(", ");
        conn.execute(&format!("UPDATE {table} SET {sets} WHERE id={id}"), []).map_err(|e| e.to_string())?;
        Ok(id)
    } else {
        let names = present.iter().map(|c| c.to_string()).collect::<Vec<_>>().join(", ");
        let vals = present.iter().map(|c| to_sql(&obj[**c])).collect::<Vec<_>>().join(", ");
        conn.execute(&format!("INSERT INTO {table} ({names}) VALUES ({vals})"), []).map_err(|e| e.to_string())?;
        Ok(conn.last_insert_rowid())
    }
}

#[tauri::command]
fn soft_delete(db: State<Db>, table: String, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    if !["meetings", "deals", "tasks", "leads"].contains(&table.as_str()) {
        return Err("unknown table".into());
    }
    let now = now_iso();
    conn.execute(&format!("UPDATE {table} SET deleted_at=?1 WHERE id=?2"), params![now, id]).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO undo_log(ts, description, revert) VALUES (?1,?2,?3)",
        params![now, format!("deleted {table} #{id}"), json!({"kind":"soft_delete","table":table,"id":id}).to_string()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_setting(db: State<Db>, key: String) -> Result<Option<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    Ok(conn.query_row("SELECT value FROM settings WHERE key=?1", params![key], |r| r.get(0)).ok())
}

#[tauri::command]
fn set_setting(db: State<Db>, key: String, value: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?1,?2)", params![key, value]).map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- backup / export ----------

#[tauri::command]
fn backup_now(db: State<Db>) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let dir = data_dir().join("backups");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(format!("console-{}.db", epoch_to_date(now_epoch())));
    if dest.exists() {
        return Ok(format!("already backed up today: {}", dest.to_string_lossy()));
    }
    conn.execute("VACUUM INTO ?1", params![dest.to_string_lossy()]).map_err(|e| e.to_string())?;
    // keep last 14
    let mut files: Vec<_> = fs::read_dir(&dir).map_err(|e| e.to_string())?.filter_map(|e| e.ok()).collect();
    files.sort_by_key(|f| f.file_name());
    while files.len() > 14 {
        let f = files.remove(0);
        let _ = fs::remove_file(f.path());
    }
    Ok(dest.to_string_lossy().to_string())
}

// ---------- pipelines (async, with timeout) ----------

#[tauri::command(async)]
fn run_pipeline(which: String) -> Result<String, String> {
    let script = match which.as_str() {
        "truckers" => "fmcsa_warm_pull.py",
        "brokers" => "broker_merge.py",
        _ => return Err("unknown pipeline".into()),
    };
    let dir = corgi_dir().join("corgi-os").join("pipeline");
    let mut child = Command::new("python3")
        .current_dir(&dir)
        .arg(script)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let deadline = std::time::Instant::now() + Duration::from_secs(900);
    loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(status) => {
                let out = child.wait_with_output().map_err(|e| e.to_string())?;
                if status.success() {
                    return Ok(String::from_utf8_lossy(&out.stdout).lines().last().unwrap_or("done").to_string());
                }
                return Err(String::from_utf8_lossy(&out.stderr).chars().take(400).collect());
            }
            None => {
                if std::time::Instant::now() > deadline {
                    let _ = child.kill();
                    return Err("pipeline timed out after 15 min".into());
                }
                std::thread::sleep(Duration::from_millis(500));
            }
        }
    }
}

#[tauri::command(async)]
fn refresh_telegram(days: i64) -> Result<String, String> {
    let tg = home().join("Desktop").join("Coding Projects").join("tg-export");
    let py = tg.join(".venv").join("bin").join("python");
    if !py.exists() {
        return Err("tg-export venv missing".into());
    }
    let out_dir = data_dir().join("tg");
    fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
    let min_date = epoch_to_date(now_epoch() - days * 86400);
    let output = Command::new(&py)
        .current_dir(&tg)
        .arg("export.py")
        .arg("--ids=-1003926206326")
        .arg(format!("--out-dir={}", out_dir.to_string_lossy()))
        .arg(format!("--min-date={min_date}"))
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok("telegram refreshed".into())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).chars().take(400).collect())
    }
}

// ---------- intel (unchanged parse, kept from v2) ----------

fn field(text: &str, key: &str) -> String {
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix(key) {
            return rest.trim_start_matches(':').trim().to_string();
        }
    }
    String::new()
}

#[tauri::command]
fn read_intel(days: i64) -> Result<Json, String> {
    let candidates = [data_dir().join("tg"), corgi_dir().join("telegram").join("export")];
    let mut jsonl: Option<PathBuf> = None;
    for dir in &candidates {
        if let Ok(entries) = fs::read_dir(dir) {
            let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
            for e in entries.flatten() {
                let p = e.path();
                let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
                if name.starts_with("Trucking_-") && name.ends_with(".jsonl") {
                    if let Ok(t) = e.metadata().and_then(|m| m.modified()) {
                        if best.as_ref().map(|(bt, _)| t > *bt).unwrap_or(true) {
                            best = Some((t, p.clone()));
                        }
                    }
                }
            }
            if let Some((_, p)) = best {
                jsonl = Some(p);
                break;
            }
        }
    }
    let jsonl = match jsonl {
        Some(p) => p,
        None => return Ok(json!({"digest": null, "events": [], "source_mtime": ""})),
    };
    let content = fs::read_to_string(&jsonl).map_err(|e| e.to_string())?;
    let cutoff = now_epoch() - days * 86400;
    let mut events = Vec::new();
    let mut digest: Option<Json> = None;
    let source_mtime = fs::metadata(&jsonl)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs().to_string())
        .unwrap_or_default();
    for line in content.lines() {
        let m: Json = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if m["sender"]["name"].as_str() != Some("Bordan Jerra") {
            continue;
        }
        let text = m["text"].as_str().unwrap_or("");
        let ts = m["date"].as_str().unwrap_or("");
        if text.is_empty() {
            continue;
        }
        if text.starts_with("Good morning!") {
            if digest.is_none() {
                digest = Some(json!({
                    "ts": ts, "conversion_rate": field(text, "Conversion Rate"),
                    "manual_review": field(text, "  Manual Review"),
                    "policies_bound_24h": field(text, "Policies Bound"),
                    "active_premium": field(text, "Active Premium"),
                    "gwp": field(text, "Gross Written Premium"),
                    "organizations": field(text, "Organizations"),
                }));
            }
            continue;
        }
        if iso_to_epoch(ts) < cutoff {
            if digest.is_some() {
                break;
            }
            continue;
        }
        let first = text.lines().next().unwrap_or("");
        let kind = if first.contains("Prequote Requested") { "prequote" }
            else if first.contains("Quote Manual Review") { "manual_review" }
            else if first.contains("Manual Review Quoted") { "quoted" }
            else if first.contains("Policy Bound") || first.contains("Quote Bound") { "bound" }
            else if first.contains("Quote Declined") { "declined" }
            else if first.contains("Cancelled") { "cancelled" }
            else if first.contains("Quote Abandoned") { "abandoned" }
            else if first.contains("taking longer") { "sla" }
            else { continue };
        let reacts: Vec<String> = m["reactions"].as_array().map(|a| {
            a.iter().filter_map(|r| r["reaction"].as_str().map(String::from)).collect()
        }).unwrap_or_default();
        events.push(json!({
            "kind": kind, "ts": ts, "company": field(text, "Company"), "dot": field(text, "DOT"),
            "premium": field(text, "Premium"),
            "partner": field(text, "Partner"),
            "source": field(text, "Source"),
            "broker": field(text, "Broker"),
            "last_step": field(text, "Last step"),
            "idle": field(text, "Idle"),
            "phone": field(text, "Phone"),
            "email": field(text, "Email"),
            "called": reacts.iter().any(|r| r == "\u{1F44D}"),
            "bad": reacts.iter().any(|r| r == "\u{1F44E}"),
            "extra": if kind == "abandoned" { format!("last step: {}", field(text, "Last step")) } else { field(text, "Reason") },
        }));
    }
    Ok(json!({"source_mtime": source_mtime, "digest": digest, "events": events}))
}

#[tauri::command]
fn read_doc(rel: String) -> Result<String, String> {
    if rel.contains("..") {
        return Err("bad path".into());
    }
    fs::read_to_string(corgi_dir().join(&rel)).map_err(|e| e.to_string())
}

// Bundled starter data (public FMCSA/registry rows) so a fresh install demos every feature
// immediately — signal-ranked queues, scripts, logging — instead of an empty screen.
// Only runs when the leads table is empty AND no CSVs exist; a real CSV drop or pipeline
// run replaces it via the normal import (upsert by lead_key).
const SEED_TRUCKERS: &str = include_str!("../../seed/truckers_seed.csv");
const SEED_BROKERS: &str = include_str!("../../seed/brokers_seed.csv");

fn seed_if_empty(conn: &Connection) {
    let lead_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM leads WHERE deleted_at IS NULL", [], |r| r.get(0))
        .unwrap_or(0);
    let t_csv = data_dir().join("truckers.csv");
    let b_csv = data_dir().join("brokers.csv");
    if lead_count > 0 || t_csv.exists() || b_csv.exists() {
        return;
    }
    if fs::write(&t_csv, SEED_TRUCKERS).is_err() || fs::write(&b_csv, SEED_BROKERS).is_err() {
        return;
    }
    let mut report = ImportReport { inserted: 0, updated: 0, skipped: 0, errors: vec![], fleets: 0, brokers: 0 };
    let _ = import_file(conn, &t_csv, "fleet", &mut report);
    let _ = import_file(conn, &b_csv, "broker", &mut report);
    let _ = rebuild_fts(conn);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let conn = open_db().expect("failed to open database");
    seed_if_empty(&conn);
    tauri::Builder::default()
        .manage(Db(Mutex::new(conn)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            import_leads,
            migrate_legacy,
            query_leads,
            pill_counts,
            counts,
            get_lead,
            log_activity,
            undo_last,
            update_activity,
            update_lead,
            list_table,
            upsert_row,
            soft_delete,
            get_setting,
            set_setting,
            backup_now,
            run_pipeline,
            refresh_telegram,
            read_intel,
            read_doc, log_revive
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
