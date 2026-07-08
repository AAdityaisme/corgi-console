// Corgi Console UI regression suite (red-team findings → assertions).
// Runs the built frontend under Playwright with a JS mock of the Tauri bridge
// that reimplements v3 command semantics over the REAL CSVs — so filter
// correctness, count honesty, and the disposition loop are actually asserted.
// Usage: node tests/e2e.mjs   (expects `npm run build` output in dist/ and
// playwright available via ../automation symlink)
import { chromium } from "playwright";
import fs from "fs";
import { execSync, spawn } from "child_process";
import os from "os";
import path from "path";

const ROOT = path.join(os.homedir(), "Desktop/corgi/corgi-os");
const DATA = path.join(os.homedir(), "Desktop/corgi/corgi-os-data");
const PORT = 4321;

function parseCSV(p) {
  const text = fs.readFileSync(p, "utf8");
  const rows = [];
  let field = "", row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); field = ""; if (row.some((c) => c !== "")) rows.push(row); row = []; }
    else if (ch !== "\r") field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const [h, ...rest] = rows;
  return rest.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ""])));
}

function daysFromToday(iso) {
  if (!iso) return null;
  return Math.floor((new Date(iso + "T12:00:00").getTime() - Date.now()) / 86400000);
}

function computeSignals(l, kind) {
  if (kind === "broker") {
    const spec = l.trucking_signal === "specialist";
    return { angle: "PARTNER", why: spec ? "specialist agency" : "commercial agency", priority: spec ? 650 : 450 };
  }
  const dc = l.cancel_date ? daysFromToday(l.cancel_date) : null;
  const ds = l.susp_date ? daysFromToday(l.susp_date) : null;
  const dr = l.est_renewal ? daysFromToday(l.est_renewal) : null;
  if (dc !== null && dc >= -30 && dc <= 75) return { angle: "RS", why: `cancellation effective ${l.cancel_date}`, priority: 900 - Math.min(60, Math.abs(dc)) };
  if (ds !== null && ds >= -60 && ds <= 0) return { angle: "RS", why: "suspension", priority: 860 };
  if (dr !== null && dr >= 0 && dr <= 75) return { angle: "RW", why: `renewal ${l.est_renewal}`, priority: 800 - Math.min(60, dr) };
  const am = parseInt(l.authority_months || "", 10);
  if (!isNaN(am) && am <= 24) return { angle: "NA", why: `authority ${am}mo`, priority: 600 };
  const units = parseInt(l.units || "0", 10);
  if (units > 0 && units <= 3) return { angle: "PL", why: "per-load", priority: 500 };
  return { angle: "GEN", why: "no live signal", priority: 300 };
}

function buildFixture() {
  const fleets = parseCSV(path.join(DATA, "truckers.csv")).map((r, i) => {
    const sig = computeSignals(r, "fleet");
    return { id: i + 1, lead_key: `fleet:${r.dot}`, kind: "fleet", ...r,
      units: parseInt(r.units || "0", 10), authority_months: parseInt(r.authority_months || "", 10) || null,
      warmth: parseInt(r.score || "0", 10), status: "new", stage: "uncontacted", dnc: 0, attempts: 0,
      last_attempt: null, next_eligible: null, pinned: 0, angle: sig.angle, angle_why: sig.why,
      priority: sig.priority, dox_dot: 0, dox_dec: 0, renewal_month: "", telematics_vendor: "",
      incumbent: "", gatekeeper: "", cell: "", notes_pinned: "", tz: "America/Chicago", dnc_reason: null };
  });
  const brokers = parseCSV(path.join(DATA, "brokers.csv")).map((r, i) => {
    const sig = computeSignals(r, "broker");
    return { id: 100000 + i, lead_key: `broker:${i}`, kind: "broker", company: r.agency, ...r,
      units: 0, authority_months: null, warmth: 0, status: "new", stage: "uncontacted", dnc: 0,
      attempts: 0, last_attempt: null, next_eligible: null, pinned: 0, angle: sig.angle,
      angle_why: sig.why, priority: sig.priority, dox_dot: 0, dox_dec: 0, renewal_month: "",
      telematics_vendor: "", incumbent: "", gatekeeper: "", cell: "", notes_pinned: "",
      tz: "America/Chicago", dot: "", dnc_reason: null };
  });
  return { fleets, brokers };
}

const MOCK = `
(() => {
  const F = window.__FIXTURE__;
  const state = { activities: [], meetings: [], deals: [], tasks: [], undo: [] };
  const all = () => [...F.fleets, ...F.brokers];
  function pillFilter(rows, pill) {
    const now = new Date().toISOString();
    switch (pill) {
      case "queue": return rows.filter(r => !r.dnc && r.status !== "dead" && (!r.next_eligible || r.next_eligible <= now));
      case "rescue": return rows.filter(r => r.angle === "RS");
      case "wire": return rows.filter(r => r.angle === "RW");
      case "na": return rows.filter(r => r.angle === "NA");
      case "worked": return rows.filter(r => r.attempts > 0);
      case "callbacks": return rows.filter(r => state.tasks.some(t => t.lead_id === r.id && t.kind === "callback" && !t.done && t.due <= now));
      case "specialist": return rows.filter(r => r.trucking_signal === "specialist");
      case "commercial": return rows.filter(r => r.trucking_signal !== "specialist");
      case "has_email": return rows.filter(r => r.email);
      default:
        if (pill && pill.startsWith("stage:")) { const st = pill.slice(6); return rows.filter(r => r.stage === st); }
        return rows;
    }
  }
  const impl = {
    counts: () => ({
      fleets: F.fleets.length, brokers: F.brokers.length,
      rescue: F.fleets.filter(r => r.angle === "RS").length,
      wire: F.fleets.filter(r => r.angle === "RW").length,
      new_auth: F.fleets.filter(r => r.angle === "NA").length,
      callbacks_due: 0, tasks_due: 0,
      specialists: F.brokers.filter(r => r.trucking_signal === "specialist").length,
    }),
    import_leads: () => ({ inserted: 0, updated: 0, skipped: 0, errors: [], fleets: F.fleets.length, brokers: F.brokers.length }),
    migrate_legacy: () => "ok",
    query_leads: ({ view }) => {
      let rows = all().filter(r => r.kind === (view.kind === "broker" ? "broker" : "fleet"));
      rows = pillFilter(rows, view.pill || "all");
      if (view.search) {
        const n = view.search.toLowerCase().trim();
        rows = rows.filter(r => (r.company||"").toLowerCase().includes(n) || (r.dot||"").includes(n) ||
          (r.owner||"").toLowerCase().includes(n) || (r.city||"").toLowerCase().includes(n) || (r.state||"").toLowerCase() === n);
      }
      rows = [...rows].sort((a,b) => b.priority - a.priority || b.warmth - a.warmth);
      const total = rows.length;
      const off = view.offset || 0;
      return { rows: rows.slice(off, off + (view.limit || 200)), total };
    },
    pill_counts: ({ kind }) => {
      const rows = all().filter(r => r.kind === (kind === "broker" ? "broker" : "fleet"));
      const pills = kind === "broker"
        ? ["all","queue","specialist","commercial","has_email","worked","callbacks","stage:uncontacted","stage:pitched","stage:docs_sent","stage:appointed","stage:producing"]
        : ["all","queue","rescue","wire","na","callbacks","worked"];
      return Object.fromEntries(pills.map(p => [p, pillFilter(rows, p).length]));
    },
    log_activity: ({ input }) => {
      const lead = all().find(r => r.id === input.lead_id);
      const atype = input.outcome === "EMAIL" ? "email" : input.outcome === "NOTE" ? "note" : "call";
      state.activities.push({ id: state.activities.length + 1, lead_id: input.lead_id, ts: new Date().toISOString(), ...input, type: atype, meta: "{}" });
      lead.attempts += 1;
      if (input.outcome === "DNC") { lead.dnc = 1; lead.status = "dead"; }
      else if (input.outcome === "BN") { lead.status = "dead"; }        // bad number → out of queue, no callback
      else if (input.outcome !== "BM") lead.next_eligible = new Date(Date.now() + 2*86400000).toISOString();
      state.undo.push({ lead, prevAttempts: lead.attempts - 1 });
      return { lead };
    },
    undo_last: () => { const u = state.undo.pop(); if (!u) throw "nothing to undo"; u.lead.attempts = u.prevAttempts; u.lead.dnc = 0; if (u.lead.status === "dead") u.lead.status = "new"; u.lead.next_eligible = null; state.activities.pop(); return "undid"; },
    update_activity: ({ id, note, objection, outcome }) => {
      const a = state.activities.find((x) => x.id === id);
      if (!a) throw "activity not found";
      if (outcome !== undefined && outcome !== a.outcome && a.ts.slice(0, 10) !== new Date().toISOString().slice(0, 10)) throw "outcome locked after day close — undo the log instead";
      if (note !== undefined) a.note = note;
      if (objection !== undefined) a.objection = objection;
      if (outcome !== undefined) a.outcome = outcome;
      a.edited_at = new Date().toISOString();
      return { activity: a };
    },
    update_lead: ({ id, patch }) => { Object.assign(all().find(r => r.id === id), patch); },
    list_table: ({ table }) => state[table === "activities" ? "activities" : table] || [],
    upsert_row: ({ table, row }) => { const arr = state[table]; if (row.id) { Object.assign(arr.find(x => x.id === row.id), row); return row.id; } const id = arr.length + 1; arr.push({ dec_page:0,t_booking:0,t_24:0,t_1:0,status:"upcoming",note:"", ...row, id }); return id; },
    soft_delete: ({ table, id }) => { const arr = state[table]; const i = arr.findIndex(x => x.id === id); if (i >= 0) arr.splice(i, 1); },
    get_setting: () => null, set_setting: () => {}, backup_now: () => "/tmp/backup.db",
    read_intel: () => ({ source_mtime: "", digest: null, events: [] }),
    read_doc: () => "", run_pipeline: () => "ok", refresh_telegram: () => "ok", get_lead: ({ id }) => ({ lead: all().find(r => r.id === id), activities: state.activities.filter(a => a.lead_id === id).slice().reverse() }),
  };
  window.__TAURI_INTERNALS__ = { invoke: (cmd, args) => { try { return Promise.resolve(impl[cmd] ? impl[cmd](args || {}) : null); } catch (e) { return Promise.reject(String(e)); } }, transformCallback: () => 0, metadata: {} };
})();
`;

let pass = 0, fail = 0;
const results = [];
function check(name, cond, detail = "") {
  if (cond) { pass++; results.push(`  ✓ ${name}`); }
  else { fail++; results.push(`  ✗ ${name} ${detail}`); }
}

async function main() {
  const fixture = buildFixture();
  const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--outDir", "dist"], { cwd: ROOT, stdio: "ignore" });
  await new Promise((res) => {
    const t = setInterval(() => {
      fetch(`http://localhost:${PORT}`).then(() => { clearInterval(t); res(); }).catch(() => {});
    }, 300);
  });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(`window.__FIXTURE__ = ${JSON.stringify(fixture)};`);
  await page.addInitScript(MOCK);
  await page.goto(`http://localhost:${PORT}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  // --- Today: counts honesty (P1-7) ---
  const hero = (await page.locator(".today-hero .lead").textContent()) || "";
  check("Today shows real fleet count", hero.includes(fixture.fleets.length.toLocaleString()), hero.slice(0, 80));
  check("Today shows real broker count", hero.includes(fixture.brokers.length.toLocaleString()));
  const rescueCount = fixture.fleets.filter((r) => r.angle === "RS").length;
  check("Today rescue == signals-module rescue", hero.includes(rescueCount.toLocaleString()));

  // --- Dial: pills + counts + virtualization (P0-5, P1-6) ---
  await page.keyboard.press("2");
  await page.waitForTimeout(700);
  const foot = (await page.locator(".queue-foot").textContent()) || "";
  check("Dial footer shows honest total", foot.includes("of"), foot);
  const queueRows = fixture.fleets.length; // none worked yet → queue == all
  check("Dial 'queue' total equals eligible", foot.includes(queueRows.toLocaleString()), foot);

  // rescue pill matches signals count
  await page.locator(".pill", { hasText: "Rescue" }).first().click();
  await page.waitForTimeout(600);
  const foot2 = (await page.locator(".queue-foot").textContent()) || "";
  check("Rescue pill count matches", foot2.includes(rescueCount.toLocaleString()), foot2);

  // search
  await page.locator(".queue-head input").fill(" TX ");
  await page.waitForTimeout(600);
  const footTx = (await page.locator(".queue-foot").textContent()) || "";
  const txRescue = fixture.fleets.filter((r) => r.angle === "RS" && r.state === "TX").length;
  const shown = parseInt((footTx.match(/of ([\d,]+)/) || [])[1]?.replace(/,/g, "") || "0", 10);
  check("Trimmed state search works (' TX ')", shown >= txRescue && shown > 1, `${footTx} vs >=${txRescue}`);
  await page.locator(".queue-head input").fill("");
  await page.waitForTimeout(500);

  // virtualization: scroll to bottom reaches last row
  await page.locator(".pill", { hasText: "All" }).first().click();
  await page.waitForTimeout(600);
  await page.locator(".queue-list").evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.waitForTimeout(900);
  await page.locator(".queue-list").evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.waitForTimeout(900);
  const rendered = await page.locator(".qrow").count();
  check("Virtualized list renders window not whole set", rendered < 100, `rendered ${rendered}`);

  // --- Disposition loop ---
  await page.locator(".pill", { hasText: "Queue" }).first().click();
  await page.waitForTimeout(600);
  const firstName = (await page.locator(".qrow-name").first().textContent()) || "";
  await page.keyboard.press("a"); // NA outcome
  await page.waitForTimeout(200);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  const newFirst = (await page.locator(".qrow-name").first().textContent()) || "";
  check("Disposition auto-advances (queue drops logged lead)", newFirst !== firstName, `${firstName} -> ${newFirst}`);
  const foot3 = (await page.locator(".queue-foot").textContent()) || "";
  check("Queue total decrements after log", foot3.includes((queueRows - 1).toLocaleString()), foot3);

  // --- DNC confirm flow (P3-16) ---
  await page.keyboard.press("x");
  await page.waitForTimeout(200);
  check("DNC requires confirmation", (await page.locator(".logbar", { hasText: "Do-Not-Call" }).count()) === 1);
  const confirmBtn = page.locator("button", { hasText: "Confirm DNC" });
  check("DNC confirm disabled without reason", await confirmBtn.isDisabled());
  await page.locator('input[placeholder="reason (required)"]').fill("asked to stop");
  await confirmBtn.click();
  await page.waitForTimeout(400);
  check("DNC undo toast appears", (await page.locator("[data-sonner-toast]").count()) >= 1);

  // --- Brokers: real pills (P0-5) ---
  await page.keyboard.press("3");
  await page.waitForTimeout(700);
  const brokerPills = (await page.locator(".filters .pill").allTextContents()).join(" ");
  check("Broker view has NO rescue/wire pills", !brokerPills.includes("Rescue") && !brokerPills.includes("Wire"), brokerPills);
  check("Broker view has specialist pill", brokerPills.includes("Specialist"));
  const specCount = fixture.brokers.filter((r) => r.trucking_signal === "specialist").length;
  await page.locator(".pill", { hasText: "Specialist" }).first().click();
  await page.waitForTimeout(600);
  const bfoot = (await page.locator(".queue-foot").textContent()) || "";
  check("Specialist pill count honest", bfoot.includes(`of ${specCount.toLocaleString()}`), `${bfoot} vs ${specCount}`);

  // --- Broker call logging: kind-aware objections + visible feedback (bug report 2026-07-07) ---
  await page.locator(".pill", { hasText: "Queue" }).first().click();
  await page.waitForTimeout(600);
  await page.keyboard.press("d"); // DM outcome opens logbar
  await page.waitForTimeout(300);
  const brokerObjOptions = (await page.locator(".logbar select option").allTextContents()).join(" | ");
  check("Broker logbar objections are broker-specific (A-rated present)", /a[- ]?rated/i.test(brokerObjOptions), brokerObjOptions);
  check("Broker logbar has NO fleet objections", !brokerObjOptions.includes("I'm just one truck"), brokerObjOptions);
  await page.keyboard.press("Enter"); // commit DM
  await page.waitForTimeout(500);
  const toastText = (await page.locator("[data-sonner-toast]").allTextContents()).join(" ");
  check("Logging a call shows success toast", /logged/i.test(toastText), toastText);
  // logged lead moved out of queue — find it under Worked; History tab shows the count
  await page.locator(".pill", { hasText: "Worked" }).first().click();
  await page.waitForTimeout(600);
  const cockpitText = (await page.locator(".cockpit").textContent()) || "";
  check("History tab shows logged-call count", /History ✓[1-9]/.test(cockpitText), cockpitText.slice(0, 160));

  // --- WP-2: per-lead History timeline pane ---
  await page.locator(".panes .pill", { hasText: "History" }).first().click();
  await page.waitForTimeout(300);
  check("History pane opens with a Today group", ((await page.locator(".tl-day").first().textContent()) || "").includes("Today"));
  check("History pane renders the logged DM row", (await page.locator(".hist-pane .chip", { hasText: "Decision-maker" }).count()) >= 1);
  await page.locator(".hist-pane .tl-row").first().click();
  await page.waitForTimeout(200);
  check("Editing a today activity reveals outcome select", (await page.locator(".act-edit select").count()) === 1);
  await page.locator(".act-edit input").first().fill("edited-by-test");
  await page.locator(".act-edit button", { hasText: "Save" }).click();
  await page.waitForTimeout(400);
  check("Edited note persists in the timeline", ((await page.locator(".hist-pane").textContent()) || "").includes("edited-by-test"));

  // --- Bad # + Emailed dispositions (2026-07-07) ---
  await page.locator(".pill", { hasText: "Queue" }).first().click();
  await page.waitForTimeout(500);
  check("Bad # disposition renders", (await page.locator(".disp", { hasText: "Bad #" }).count()) === 1);
  check("Emailed disposition renders", (await page.locator(".disp", { hasText: "Emailed" }).count()) === 1);
  const bnBefore = (await page.locator(".qrow-name").first().textContent()) || "";
  await page.locator(".disp", { hasText: "Bad #" }).click();
  await page.waitForTimeout(150);
  await page.locator(".logbar button", { hasText: "Log BN" }).click();
  await page.waitForTimeout(500);
  const bnAfter = (await page.locator(".qrow-name").first().textContent()) || "";
  check("Bad # drops the lead from queue", bnBefore !== bnAfter, `${bnBefore} -> ${bnAfter}`);
  await page.locator(".disp", { hasText: "Emailed" }).click();
  await page.waitForTimeout(150);
  await page.locator(".logbar button", { hasText: "Log EMAIL" }).click();
  await page.waitForTimeout(500);
  const emailToasts = (await page.locator("[data-sonner-toast]").allTextContents()).join(" ");
  check("Emailed disposition logs through", /EMAIL logged/i.test(emailToasts), emailToasts.slice(0, 120));

  // --- Pipeline validation (P2-14) ---
  await page.keyboard.press("4");
  await page.waitForTimeout(600);
  await page.locator("button", { hasText: "+ Book" }).click();
  await page.waitForTimeout(200);
  check("Meeting add without fields shows message", ((await page.locator("section.card").first().textContent()) || "").includes("required"));

  // --- Empty state (Stats with no data is fine; check Dial empty search) ---
  await page.keyboard.press("2");
  await page.waitForTimeout(500);
  await page.locator(".queue-head input").fill("zzzzqqqq");
  await page.waitForTimeout(600);
  check("Empty search shows explanatory empty state", ((await page.locator(".queue-list").textContent()) || "").includes("No leads match"));

  check("Zero page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

  console.log(results.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  server.kill();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
