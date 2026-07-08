#!/usr/bin/env python3
"""Sync Corgi Gmail (sent mail) + Calendly bookings into Corgi Console's DB.

- Sent emails: match To: address against leads.email -> log activity (type=email,
  outcome=EMAIL), bump attempts. Dedupe by Gmail Message-ID.
- Calendly: scheduled events -> upsert meetings (status=upcoming), match lead by
  invitee email; cancellations -> status=cancelled.

Creds: ~/Desktop/corgi/corgi-os-data/.external_creds.json (0600)
  { "gmail_user": "you@corgi...", "gmail_app_password": "xxxx xxxx xxxx xxxx",
    "calendly_token": "eyJ..." }
Runs idempotently; safe every 15 min via launchd (com.aadi.corgi-sync).
"""
import imaplib
import json
import re
import sqlite3
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from email import message_from_bytes
from email.utils import getaddresses, parsedate_to_datetime
from pathlib import Path

DATA = Path.home() / "Desktop/corgi/corgi-os-data"
DB = DATA / "console.db"
CREDS_F = DATA / ".external_creds.json"
STATE_F = DATA / ".sync_state.json"

if not CREDS_F.exists():
    sys.exit("no creds yet: create .external_creds.json (see docstring)")
CREDS = json.loads(CREDS_F.read_text())
state = json.loads(STATE_F.read_text()) if STATE_F.exists() else {"seen_msgids": [], "seen_events": []}
seen_msgids = set(state["seen_msgids"])
seen_events = set(state["seen_events"])

db = sqlite3.connect(DB, timeout=15)
db.execute("PRAGMA journal_mode=WAL")


def lead_by_email(em):
    r = db.execute("SELECT id, company FROM leads WHERE lower(email)=? AND deleted_at IS NULL",
                   (em.lower(),)).fetchone()
    return r


def log_email(lead_id, note, ts):
    db.execute(
        "INSERT INTO activities (lead_id, ts, type, outcome, script, objection, note, duration_s, meta) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        (lead_id, ts, "email", "EMAIL", "", "", note[:200], None, json.dumps({"src": "gmail-sync"})))
    db.execute("UPDATE leads SET attempts=attempts+1, last_attempt=? WHERE id=?", (ts, lead_id))


def sync_gmail():
    user, pw = CREDS.get("gmail_user"), CREDS.get("gmail_app_password")
    if not (user and pw):
        print("gmail: no creds, skipping"); return 0
    M = imaplib.IMAP4_SSL("imap.gmail.com")
    M.login(user, pw.replace(" ", ""))
    M.select('"[Gmail]/Sent Mail"', readonly=True)
    since = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%d-%b-%Y")
    _, data = M.search(None, f'(SINCE "{since}")')
    ids = data[0].split()
    n = 0
    for i in ids[-300:]:
        _, msg_data = M.fetch(i, "(BODY.PEEK[HEADER.FIELDS (MESSAGE-ID TO SUBJECT DATE)])")
        msg = message_from_bytes(msg_data[0][1])
        mid = (msg.get("Message-ID") or "").strip()
        if not mid or mid in seen_msgids:
            continue
        seen_msgids.add(mid)
        try:
            ts = parsedate_to_datetime(msg.get("Date")).astimezone(timezone.utc).isoformat()
        except Exception:
            ts = datetime.now(timezone.utc).isoformat()
        subj = msg.get("Subject", "")
        for _, addr in getaddresses([msg.get("To", "")]):
            lead = lead_by_email(addr)
            if lead:
                log_email(lead[0], f"sent: {subj}", ts)
                n += 1
                print(f"  email -> {lead[1]}: {subj[:50]}")
    M.logout()
    return n


def calendly_get(url):
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {CREDS['calendly_token']}",
        "User-Agent": "curl/8.6.0", "Accept": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=30).read())


def sync_calendly():
    tok = CREDS.get("calendly_token")
    if not tok:
        print("calendly: no token, skipping"); return 0
    me = calendly_get("https://api.calendly.com/users/me")["resource"]["uri"]
    min_t = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    url = f"https://api.calendly.com/scheduled_events?user={me}&min_start_time={min_t}&count=100"
    n = 0
    while url:
        page = calendly_get(url)
        for ev in page["collection"]:
            uri = ev["uri"]
            evid = uri.rsplit("/", 1)[-1]
            start = ev["start_time"]
            cancelled = ev["status"] == "canceled"
            # invitee details
            name, email, phone = ev.get("name") or "Calendly meeting", "", ""
            try:
                inv = calendly_get(uri + "/invitees")["collection"]
                if inv:
                    name = inv[0].get("name") or name
                    email = inv[0].get("email") or ""
                    for qa in inv[0].get("questions_and_answers", []):
                        if re.search(r"phone", qa.get("question", ""), re.I):
                            phone = qa.get("answer", "")
            except Exception:
                pass
            lead = lead_by_email(email) if email else None
            key = f"{evid}:{ev['status']}"
            if key in seen_events:
                continue
            seen_events.add(key)
            existing = db.execute("SELECT id FROM meetings WHERE note LIKE ?", (f"%cal:{evid}%",)).fetchone()
            if existing:
                if cancelled:
                    db.execute("UPDATE meetings SET status='no-show', note=note||' (cancelled)' WHERE id=?", (existing[0],))
                else:
                    db.execute("UPDATE meetings SET at=? WHERE id=?", (start, existing[0]))
            elif not cancelled:
                db.execute(
                    "INSERT INTO meetings (lead_id, name, phone, at, ae, dec_page, t_booking, t_24, t_1, status, note) "
                    "VALUES (?,?,?,?,?,0,0,0,0,'upcoming',?)",
                    (lead[0] if lead else None, (lead[1] if lead else name)[:60], phone, start, "",
                     f"cal:{evid} {email}"))
                n += 1
                print(f"  meeting -> {name} @ {start}")
        url = page.get("pagination", {}).get("next_page")
    return n


if __name__ == "__main__":
    e = m = 0
    try:
        e = sync_gmail()
    except Exception as ex:
        print(f"gmail sync error: {ex}")
    try:
        m = sync_calendly()
    except Exception as ex:
        print(f"calendly sync error: {ex}")
    db.commit()
    db.close()
    state["seen_msgids"] = list(seen_msgids)[-5000:]
    state["seen_events"] = list(seen_events)[-2000:]
    STATE_F.write_text(json.dumps(state))
    print(f"done: {e} emails logged, {m} meetings synced")
