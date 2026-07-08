#!/usr/bin/env python3
"""Grand broker merge for Corgi Console.

Sources → one brokers.csv:
  1. existing brokers.csv        (curated WebSearch/progressive/seed set)
  2. directory_agencies.csv      (ustruckingdirectory + ddg domain scrape)
  3. uiia_agencies.csv           (UIIA directory)
  4. Apify Google-Maps dataset   (apify_places.json — title/phone/website/address)

Dedup: phone last-10 → website domain → normalized name+city.
Signal: 'specialist' if name/domain matches trucking regex; Maps hits that
ranked for trucking-insurance searches but lack the name signal → 'commercial'.
Email enrichment for specialists w/ website but no email (own scraper).
"""
import csv
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from broker_search import TRUCK_RE, TZ, fetch, EMAIL_RE, BAD_EMAIL


def get_email(website):
    if not website:
        return ""
    for path in ("", "/contact", "/contact-us", "/about"):
        html = fetch(website + path, timeout=10)
        if not html:
            continue
        for em in EMAIL_RE.findall(html):
            if not BAD_EMAIL.search(em) and len(em) < 60:
                return em.lower()
    return ""

DATA = Path.home() / "Desktop/corgi/corgi-os-data"
OUT = DATA / "brokers.csv"

JUNK_NAME = re.compile(
    r"(progressive|geico|state farm|allstate|farmers insurance|nationwide|"
    r"liberty mutual|the hartford|travelers|sentry|great west|northland|"
    r"canal insurance|biberk|dmv|registration|permit|tag agency|title|"
    r"driving school|cdl school|truck repair|towing service|dealer)", re.I)

ST_ABBR = set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split())
STATE_NAME_TO_ABBR = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA",
    "colorado": "CO", "connecticut": "CT", "delaware": "DE", "florida": "FL", "georgia": "GA",
    "hawaii": "HI", "idaho": "ID", "illinois": "IL", "indiana": "IN", "iowa": "IA",
    "kansas": "KS", "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS",
    "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV", "new hampshire": "NH",
    "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC",
    "north dakota": "ND", "ohio": "OH", "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA",
    "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", "tennessee": "TN",
    "texas": "TX", "utah": "UT", "vermont": "VT", "virginia": "VA", "washington": "WA",
    "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY",
}


def norm_phone(p):
    d = re.sub(r"\D", "", p or "")
    if len(d) == 11 and d.startswith("1"):
        d = d[1:]
    return d if len(d) == 10 else ""


def fmt_phone(p):
    d = norm_phone(p)
    return f"({d[:3]}) {d[3:6]}-{d[6:]}" if d else ""


def dom(url):
    d = re.sub(r"https?://(www\.)?", "", (url or "").lower()).split("/")[0]
    return d


def load_csv(p):
    try:
        return list(csv.DictReader(open(p)))
    except Exception:
        return []


def main():
    candidates = []

    for r in load_csv(OUT):
        candidates.append({**r, "_pri": 0})
    for r in load_csv(DATA / "directory_agencies.csv"):
        candidates.append({"kind": "broker", "agency": r.get("agency", ""), "phone": r.get("phone", ""),
                           "email": r.get("email", ""), "website": r.get("website", ""), "street": "",
                           "city": r.get("city", ""), "state": r.get("state", ""), "zip": "",
                           "trucking_signal": r.get("trucking_signal", ""), "source": "ustruckingdirectory", "_pri": 1})
    for r in load_csv(DATA / "uiia_agencies.csv"):
        candidates.append({"kind": "broker", "agency": r.get("agency", ""), "phone": r.get("phone", ""),
                           "email": r.get("email", ""), "website": r.get("website", ""), "street": "",
                           "city": "", "state": "", "zip": "",
                           "trucking_signal": "specialist", "source": "uiia-directory", "_pri": 1})

    places_file = DATA / "apify_places.json"
    if places_file.exists():
        places = json.loads(places_file.read_text())
        print(f"[merge] {len(places)} Maps places", flush=True)
        for p in places:
            name = (p.get("title") or "").strip()
            cat = (p.get("categoryName") or "").lower()
            if not name or JUNK_NAME.search(name):
                continue
            if "insurance" not in cat and not TRUCK_RE.search(name):
                continue  # keep only insurance-category places (or hard name signal)
            st = p.get("state") or ""
            if st and st not in ST_ABBR:
                st = STATE_NAME_TO_ABBR.get(st.strip().lower(), "")
            desc = (p.get("description") or "")
            sig = "specialist" if TRUCK_RE.search(f"{name} {dom(p.get('website',''))} {desc}") else ""
            candidates.append({"kind": "broker", "agency": name, "phone": p.get("phone", ""),
                               "email": "", "website": p.get("website", ""),
                               "street": p.get("street", ""), "city": p.get("city", ""),
                               "state": st if st in ST_ABBR else "", "zip": p.get("postalCode", ""),
                               "trucking_signal": sig, "source": "google-maps", "_pri": 2})

    # dedup: phone → domain → name+city
    rows, seen = [], set()
    candidates.sort(key=lambda r: r["_pri"])  # curated first (richer records win)
    for r in candidates:
        keys = []
        ph = norm_phone(r.get("phone", ""))
        if ph:
            keys.append("p:" + ph)
        d = dom(r.get("website", ""))
        if d:
            keys.append("d:" + d)
        if not keys:
            keys.append("n:" + re.sub(r"\W", "", (r.get("agency", "") + r.get("city", "")).lower()))
        if any(k in seen for k in keys):
            continue
        seen.update(keys)
        if not r.get("agency") or not (ph or d):
            continue
        sig = r.get("trucking_signal") or ""
        blob = f"{r.get('agency','')} {dom(r.get('website',''))}"
        if TRUCK_RE.search(blob):
            sig = "specialist"
        elif r.get("source") in ("ustruckingdirectory", "uiia-directory"):
            # listed/advertising on a truck-insurance directory = trucking-focused book
            sig = "specialist"
        elif not sig:
            sig = "commercial"
        rows.append({
            "kind": "broker", "agency": r["agency"][:70], "phone": fmt_phone(r.get("phone", "")),
            "email": (r.get("email") or "").lower(), "website": r.get("website", ""),
            "street": r.get("street", ""), "city": r.get("city", ""), "state": r.get("state", ""),
            "zip": r.get("zip", ""), "tz_offset": TZ.get(r.get("state", ""), -6),
            "trucking_signal": sig, "source": r.get("source", ""),
        })

    spec = [r for r in rows if r["trucking_signal"] == "specialist"]
    print(f"[merge] {len(rows)} unique brokers · {len(spec)} specialist", flush=True)

    # email enrichment: specialists w/ website, no email (cap 400)
    targets = [r for r in spec if r["website"] and not r["email"]][:400]
    print(f"[merge] enriching email for {len(targets)} specialists …", flush=True)
    done = 0
    with ThreadPoolExecutor(16) as ex:
        futs = {ex.submit(get_email, r["website"].rstrip("/")): r for r in targets}
        for f in as_completed(futs):
            futs[f]["email"] = f.result() or ""
            done += 1
            if done % 80 == 0:
                print(f"  {done}/{len(targets)}", flush=True)

    rows.sort(key=lambda r: (r["trucking_signal"] != "specialist", not r["email"], not r["phone"], r["state"]))
    cols = ["kind", "agency", "phone", "email", "website", "street", "city", "state", "zip", "tz_offset", "trucking_signal", "source"]
    with open(OUT, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    print(f"DONE: {len(rows)} brokers ({len(spec)} specialist, "
          f"{sum(1 for r in rows if r['email'])} email, {sum(1 for r in rows if r['phone'])} phone) → {OUT}", flush=True)


if __name__ == "__main__":
    main()
