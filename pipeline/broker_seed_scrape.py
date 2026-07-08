#!/usr/bin/env python3
"""Top-up broker list from a curated domain seed (WebSearch-sourced specialists).

Scrapes each seed domain for phone/email/state and merges into the existing
brokers.csv (dedup by phone/domain). Run after broker_search.py.
"""
import csv
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from broker_search import scrape_site, domain_of, TZ, agency_name  # reuse

DATA = Path.home() / "Desktop/corgi/corgi-os-data"
SEED = DATA / "broker_seed.txt"
OUT = DATA / "brokers.csv"


def main():
    domains = [d.strip() for d in SEED.read_text().splitlines() if d.strip() and not d.startswith("#")]
    print(f"[seed] scraping {len(domains)} curated specialist domains …", flush=True)
    scraped = []
    with ThreadPoolExecutor(12) as ex:
        futs = {ex.submit(scrape_site, d): d for d in domains}
        for f in as_completed(futs):
            r = f.result()
            if r:
                if not r["agency"]:
                    r["agency"] = agency_name(futs[f])
                r["trucking_signal"] = "specialist"  # curated = all trucking specialists
                scraped.append(r)
    print(f"[seed] {len(scraped)} scraped with phone", flush=True)

    rows, seen = [], set()

    def add(r, source):
        key = re.sub(r"\D", "", r.get("phone", ""))[-10:] or domain_of(r.get("website", ""))
        if not key or key in seen:
            return
        seen.add(key)
        rows.append({
            "kind": "broker", "agency": r.get("agency", ""), "phone": r.get("phone", ""),
            "email": r.get("email", ""), "website": r.get("website", ""), "street": r.get("street", ""),
            "city": r.get("city", ""), "state": r.get("state", ""), "zip": r.get("zip", ""),
            "tz_offset": TZ.get(r.get("state", ""), -6),
            "trucking_signal": r.get("trucking_signal", "commercial"), "source": source,
        })

    existing = list(csv.DictReader(open(OUT))) if OUT.exists() else []
    for r in existing:
        add(r, r.get("source", "progressiveagent.com"))
    for r in scraped:
        add(r, "websearch-seed")

    rows.sort(key=lambda r: (r["trucking_signal"] != "specialist", not r["email"], r["state"]))
    with open(OUT, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    spec = sum(1 for r in rows if r["trucking_signal"] == "specialist")
    print(f"[seed] merged → {len(rows)} brokers ({spec} specialist) → {OUT}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
