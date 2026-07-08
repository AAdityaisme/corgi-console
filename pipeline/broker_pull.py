#!/usr/bin/env python3
"""Trucking-broker lead pull for Corgi OS — fast metro sweep.

progressiveagent.com renders every appointed agency per city server-side
(name + address + tel). We sweep major metros across all 50 states, keep
agencies whose name signals trucking (specialist) or commercial, dedupe,
and pull the agency website from each detail page. Phone-primary — no slow
per-site email crawl (email enriched on demand later).

Output: ~/Desktop/corgi/corgi-os-data/brokers.csv
"""
import csv
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

OUT = Path.home() / "Desktop/corgi/corgi-os-data/brokers.csv"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")

# major metros per state (slug form as progressiveagent uses)
METROS = {
    "AL": ["birmingham", "montgomery", "mobile", "huntsville"],
    "AK": ["anchorage"],
    "AZ": ["phoenix", "tucson", "mesa", "glendale", "scottsdale"],
    "AR": ["little-rock", "fort-smith", "fayetteville"],
    "CA": ["los-angeles", "san-diego", "san-jose", "fresno", "sacramento",
           "long-beach", "oakland", "bakersfield", "anaheim", "riverside",
           "stockton", "fontana", "san-bernardino", "modesto", "ontario"],
    "CO": ["denver", "colorado-springs", "aurora", "commerce-city"],
    "CT": ["bridgeport", "new-haven", "hartford", "stamford"],
    "DE": ["wilmington", "dover"],
    "FL": ["jacksonville", "miami", "tampa", "orlando", "hialeah",
           "fort-lauderdale", "tallahassee", "fort-myers", "orlando"],
    "GA": ["atlanta", "augusta", "columbus", "savannah", "macon", "marietta"],
    "ID": ["boise", "nampa", "idaho-falls"],
    "IL": ["chicago", "aurora", "rockford", "joliet", "naperville", "elgin"],
    "IN": ["indianapolis", "fort-wayne", "evansville", "gary", "hammond"],
    "IA": ["des-moines", "cedar-rapids", "davenport", "council-bluffs"],
    "KS": ["wichita", "kansas-city", "topeka", "olathe"],
    "KY": ["louisville", "lexington", "bowling-green"],
    "LA": ["new-orleans", "baton-rouge", "shreveport", "lafayette"],
    "ME": ["portland", "bangor"],
    "MD": ["baltimore", "columbia", "germantown", "rockville"],
    "MA": ["boston", "worcester", "springfield", "lowell"],
    "MI": ["detroit", "grand-rapids", "warren", "sterling-heights", "lansing", "flint"],
    "MN": ["minneapolis", "saint-paul", "rochester", "duluth"],
    "MS": ["jackson", "gulfport", "southaven"],
    "MO": ["kansas-city", "saint-louis", "springfield", "columbia", "independence"],
    "MT": ["billings", "missoula", "great-falls"],
    "NE": ["omaha", "lincoln", "bellevue"],
    "NV": ["las-vegas", "henderson", "reno", "north-las-vegas"],
    "NH": ["manchester", "nashua"],
    "NJ": ["newark", "jersey-city", "paterson", "elizabeth", "edison"],
    "NM": ["albuquerque", "las-cruces", "rio-rancho"],
    "NY": ["new-york", "buffalo", "rochester", "yonkers", "syracuse", "albany"],
    "NC": ["charlotte", "raleigh", "greensboro", "durham", "winston-salem", "fayetteville"],
    "ND": ["fargo", "bismarck"],
    "OH": ["columbus", "cleveland", "cincinnati", "toledo", "akron", "dayton"],
    "OK": ["oklahoma-city", "tulsa", "norman", "broken-arrow"],
    "OR": ["portland", "salem", "eugene", "gresham"],
    "PA": ["philadelphia", "pittsburgh", "allentown", "erie", "reading", "scranton"],
    "RI": ["providence", "warwick"],
    "SC": ["columbia", "charleston", "north-charleston", "greenville"],
    "SD": ["sioux-falls", "rapid-city"],
    "TN": ["nashville", "memphis", "knoxville", "chattanooga", "clarksville"],
    "TX": ["houston", "san-antonio", "dallas", "austin", "fort-worth",
           "el-paso", "arlington", "corpus-christi", "laredo", "lubbock",
           "garland", "irving", "amarillo", "grand-prairie", "brownsville", "mcallen"],
    "UT": ["salt-lake-city", "west-valley-city", "provo", "ogden"],
    "VT": ["burlington"],
    "VA": ["virginia-beach", "norfolk", "richmond", "chesapeake", "arlington", "newport-news"],
    "WA": ["seattle", "spokane", "tacoma", "vancouver", "kent"],
    "WV": ["charleston", "huntington"],
    "WI": ["milwaukee", "madison", "green-bay", "kenosha", "racine"],
    "WY": ["cheyenne", "casper"],
}
SLUG = {"AL": "alabama", "AK": "alaska", "AZ": "arizona", "AR": "arkansas",
        "CA": "california", "CO": "colorado", "CT": "connecticut", "DE": "delaware",
        "FL": "florida", "GA": "georgia", "ID": "idaho", "IL": "illinois",
        "IN": "indiana", "IA": "iowa", "KS": "kansas", "KY": "kentucky",
        "LA": "louisiana", "ME": "maine", "MD": "maryland", "MA": "massachusetts",
        "MI": "michigan", "MN": "minnesota", "MS": "mississippi", "MO": "missouri",
        "MT": "montana", "NE": "nebraska", "NV": "nevada", "NH": "new-hampshire",
        "NJ": "new-jersey", "NM": "new-mexico", "NY": "new-york",
        "NC": "north-carolina", "ND": "north-dakota", "OH": "ohio",
        "OK": "oklahoma", "OR": "oregon", "PA": "pennsylvania", "RI": "rhode-island",
        "SC": "south-carolina", "SD": "south-dakota", "TN": "tennessee",
        "TX": "texas", "UT": "utah", "VT": "vermont", "VA": "virginia",
        "WA": "washington", "WV": "west-virginia", "WI": "wisconsin", "WY": "wyoming"}
TZ = {**{s: -5 for s in "CT DE FL GA IN KY ME MD MA MI NH NJ NY NC OH PA RI SC VT VA WV DC".split()},
      **{s: -6 for s in "AL AR IL IA KS LA MN MS MO NE ND OK SD TN TX WI".split()},
      **{s: -7 for s in "AZ CO ID MT NM UT WY".split()},
      **{s: -8 for s in "CA NV OR WA".split()}, "AK": -9, "HI": -10}

TRUCK_RE = re.compile(
    r"\b(truck|trucking|transport|transportation|fleet|cargo|freight|haul|"
    r"hotshot|hot shot|rig|semi|cdl|carrier|diesel|wheeler|logistics|"
    r"owner.?op|motor carrier)\w*\b", re.I)
COMM_RE = re.compile(r"\b(commercial|business)\b", re.I)

AGENCY_RE = re.compile(
    r'<h2 class="title h4-style">(.*?)</h2>\s*'
    r'<span class="address">(.*?)</span>.*?'
    r'href="(https://www\.progressiveagent\.com/local-agent/[^"]+)"[^>]*class="list-link details".*?'
    r'href="tel:(\d+)"', re.S)


def fetch(url, timeout=15):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        return urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8", "ignore")
    except Exception:
        return ""


def parse_city(html, st):
    out = []
    for name, addr, detail, tel in AGENCY_RE.findall(html):
        name = re.sub(r"<[^>]+>", "", name).strip()
        addr = re.sub(r"<[^>]+>", "", addr).strip()
        m = re.match(r"(.*?),\s*([^,]+),\s*([A-Z]{2}),\s*(\d{5})", addr)
        street, city, sst, zc = m.groups() if m else (addr, "", st, "")
        tel = tel[-10:]
        phone = f"({tel[:3]}) {tel[3:6]}-{tel[6:]}" if len(tel) == 10 else ""
        sig = ("specialist" if TRUCK_RE.search(name)
               else "commercial" if COMM_RE.search(name) else "")
        if sig and phone:
            out.append({"agency": name, "street": street, "city": city,
                        "state": sst or st, "zip": zc, "phone": phone,
                        "detail_url": detail, "trucking_signal": sig})
    return out


def get_website(detail_url):
    html = fetch(detail_url, timeout=10)
    m = re.search(r"class=\"website\"[^>]*>\s*(https?://[^<\s]+)\s*<", html) or \
        re.search(r"href='(https?://[^']+)'\s*class=\"website\"", html)
    return (m.group(1).strip().rstrip("/") if m else "")


def main():
    t0 = time.time()
    jobs = [(st, city) for st, cities in METROS.items() for city in cities]
    print(f"[1/3] sweeping {len(jobs)} metros across {len(METROS)} states …", flush=True)
    agencies, seen = [], set()
    done = 0
    with ThreadPoolExecutor(12) as ex:
        futs = {ex.submit(fetch, f"https://www.progressiveagent.com/local-agent/{SLUG[st]}/{city}/"): st
                for st, city in jobs}
        for f in as_completed(futs):
            st = futs[f]
            for a in parse_city(f.result(), st):
                key = (a["phone"], a["agency"].lower().replace(",", "").replace(".", ""))
                if key not in seen:
                    seen.add(key)
                    agencies.append(a)
            done += 1
            if done % 60 == 0:
                print(f"  {done}/{len(jobs)} metros · {len(agencies)} agencies", flush=True)
    spec = [a for a in agencies if a["trucking_signal"] == "specialist"]
    comm = [a for a in agencies if a["trucking_signal"] == "commercial"]
    print(f"  {len(agencies)} agencies: {len(spec)} specialist, {len(comm)} commercial", flush=True)

    print(f"[2/3] pulling websites from {len(agencies)} detail pages …", flush=True)
    with ThreadPoolExecutor(12) as ex:
        futs = {ex.submit(get_website, a["detail_url"]): a for a in agencies}
        done = 0
        for f in as_completed(futs):
            futs[f]["website"] = f.result()
            done += 1
            if done % 100 == 0:
                print(f"  {done}/{len(agencies)}", flush=True)

    rows = []
    for a in agencies:
        rows.append({
            "kind": "broker", "agency": a["agency"], "phone": a["phone"],
            "email": "", "website": a.get("website", ""), "street": a["street"],
            "city": a["city"], "state": a["state"], "zip": a["zip"],
            "tz_offset": TZ.get(a["state"], -6), "trucking_signal": a["trucking_signal"],
            "source": "progressiveagent.com",
        })
    rows.sort(key=lambda r: (r["trucking_signal"] != "specialist", r["state"], r["agency"]))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    n_site = sum(1 for r in rows if r["website"])
    print(f"[3/3] DONE in {int(time.time()-t0)}s: {len(rows)} brokers "
          f"({len(spec)} specialist, {len(comm)} commercial, {n_site} w/ website) → {OUT}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
