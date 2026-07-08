#!/usr/bin/env python3
"""Scrape a list of agency domains (one per line) for phone/email/state and
write candidates to a CSV. Reuses broker_search.scrape_site.

Usage: python3 domain_scrape.py <domains.txt> <out.csv> [default_signal]
"""
import csv
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from broker_search import scrape_site, TRUCK_RE, agency_name

# junk: carriers, aggregators, big brands, non-insurance
JUNK = re.compile(
    r"(aaa\.com|ace\.aaa|geico|progressive|statefarm|allstate|farmers|nationwide|"
    r"libertymutual|thehartford|travelers|sentry|greatwest|gwccnet|northland|canal|"
    r"biberk|nirvana|coverwhale|next.*insurance|drivingacademy|cdl|dmv|fmcsa|\.gov|"
    r"logrock|freightwaves|truckinfo|dat\.com|uship|freight|loadboard|factoring|"
    r"eld|telematics|samsara|motive|fuel|truckstop|acrisure|hubinternational|"
    r"marsh|aon\.|gallagher|wtwco|lockton|usi\.|expertise\.com|yelp|yellowpages|"
    r"trustedchoice|insurancedirectory|nerdwallet|zebra|insurify|valuepenguin|"
    r"insureon|simplybusiness|coverwallet|policygenius|embroker|attorneys?|law|"
    r"bank|realestate|towing\.com|repair|dealer|parts|wash|permit|tag|title|"
    r"dispatch|mc-authority|authority|compliance|drugtest|scale)", re.I)


def main():
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    default_signal = sys.argv[3] if len(sys.argv) > 3 else ""
    domains = [d.strip().lower() for d in src.read_text().splitlines() if d.strip()]
    domains = [d for d in domains if not JUNK.search(d) and d.count(".") <= 2 and len(d) < 45]
    # de-dup by registrable core
    seen, keep = set(), []
    for d in domains:
        core = d.split(".")[-2] if "." in d else d
        if core not in seen:
            seen.add(core)
            keep.append(d)
    print(f"[domain-scrape] {len(keep)} domains after junk filter", flush=True)

    rows = []
    done = 0
    with ThreadPoolExecutor(16) as ex:
        futs = {ex.submit(scrape_site, d): d for d in keep}
        for f in as_completed(futs):
            r = f.result()
            done += 1
            if r:
                if not r["agency"]:
                    r["agency"] = agency_name(futs[f])
                sig = "specialist" if TRUCK_RE.search(futs[f] + " " + r["agency"]) else (default_signal or r["trucking_signal"])
                r["trucking_signal"] = sig
                rows.append(r)
            if done % 60 == 0:
                print(f"  {done}/{len(keep)} · {len(rows)} callable", flush=True)

    with open(out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["agency", "phone", "email", "website", "city", "state", "trucking_signal"])
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in w.fieldnames})
    spec = sum(1 for r in rows if r["trucking_signal"] == "specialist")
    print(f"[domain-scrape] DONE: {len(rows)} callable ({spec} specialist) → {out}", flush=True)


if __name__ == "__main__":
    main()
