#!/usr/bin/env python3
"""Broker discovery via DuckDuckGo HTML → agency sites → phone/email scrape.

Self-contained, no API keys / credits. Discovers trucking-insurance AGENCIES
(not carriers/directories) across all states, then visits each site for phone,
email, city/state. Merges with any existing progressiveagent.com rows.

Output: ~/Desktop/corgi/corgi-os-data/brokers.csv
"""
import csv
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

OUT = Path.home() / "Desktop/corgi/corgi-os-data/brokers.csv"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")

STATES = {
    "AL": "Alabama", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
    "CO": "Colorado", "CT": "Connecticut", "FL": "Florida", "GA": "Georgia",
    "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa",
    "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "NE": "Nebraska", "NV": "Nevada", "NJ": "New Jersey",
    "NM": "New Mexico", "NY": "New York", "NC": "North Carolina", "OH": "Ohio",
    "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania", "SC": "South Carolina",
    "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VA": "Virginia",
    "WA": "Washington", "WI": "Wisconsin", "WV": "West Virginia",
}
TERMS = [
    "trucking insurance agency",
    "commercial truck insurance broker",
    "owner operator insurance agency",
    "semi truck insurance agency",
    "motor carrier insurance agency",
]
TZ = {**{s: -5 for s in "CT FL GA IN KY MD MA MI NC NJ NY OH PA SC TN VA WV".split()},
      **{s: -6 for s in "AL AR IL IA KS LA MN MS MO NE OK TX WI".split()},
      **{s: -7 for s in "AZ CO ID NM UT".split()},
      **{s: -8 for s in "CA NV OR WA".split()}}

# domains that are carriers, aggregators, directories, or social — not callable agencies
BLOCK = re.compile(
    r"(progressive|geico|gwccnet|greatwest|biberk|nirvana|coverwhale|sentry|"
    r"canalins|northland|thehartford|hartford|nationwide|statefarm|libertymutual|"
    r"travelers|chubb|cnain|amtrust|nextinsurance|thimble|hiscox|"
    r"logrock|dat\.com|nerdwallet|thezebra|zebra\.com|valuepenguin|insurify|netquote|"
    r"quote|forbes|bankrate|investopedia|trustedchoice|simplybusiness|insureon|"
    r"yelp|yellowpages|bbb\.org|facebook|linkedin|instagram|twitter|x\.com|"
    r"wikipedia|indeed|glassdoor|reddit|youtube|mapquest|manta\.com|"
    r"simplexgroup|marqueeig|coasttransport|insuremyrig|giasure|"
    r"\.gov|fmcsa|dot\.gov)", re.I)

TRUCK_RE = re.compile(r"(truck|trucking|transport|motor.?carrier|owner.?op|semi|big.?rig|hotshot|freight|cargo|fleet|diesel|rig)", re.I)
EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
BAD_EMAIL = re.compile(r"(\.(png|jpg|jpeg|gif|svg|webp)|sentry|wix|example|godaddy|@2x|placeholder)", re.I)
PHONE_RE = re.compile(r"(?:\+?1[-.\s]?)?\(?([2-9]\d\d)\)?[-.\s]?(\d{3})[-.\s]?(\d{4})")


def ddg(query, retries=2):
    for i in range(retries):
        try:
            url = "https://html.duckduckgo.com/html/?" + urllib.parse.urlencode({"q": query})
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            html = urllib.request.urlopen(req, timeout=20).read().decode("utf-8", "ignore")
            urls = []
            for l in re.findall(r'result__a"[^>]*href="([^"]+)"', html):
                m = re.search(r"uddg=([^&]+)", l)
                if m:
                    urls.append(urllib.parse.unquote(m.group(1)))
            return urls
        except Exception:
            time.sleep(1.5 * (i + 1))
    return []


def domain_of(url):
    try:
        d = urllib.parse.urlparse(url).netloc.lower()
        return d[4:] if d.startswith("www.") else d
    except Exception:
        return ""


def agency_name(domain, title=""):
    if title:
        return title
    core = domain.split(".")[0]
    return core.replace("-", " ").title()


def fetch(url, timeout=12):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        return urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8", "ignore")
    except Exception:
        return ""


ST_NAME_TO_ABBR = {v.lower(): k for k, v in STATES.items()}


def scrape_site(domain):
    """Visit homepage + /contact, extract phone, email, city/state, title."""
    base = f"https://{domain}"
    rec = {"agency": "", "phone": "", "email": "", "website": base,
           "city": "", "state": "", "trucking_signal": ""}
    html = fetch(base) or fetch(f"http://{domain}")
    if not html:
        return None
    # title
    tm = re.search(r"<title>(.*?)</title>", html, re.S | re.I)
    if tm:
        t = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", tm.group(1))).strip()
        t = re.split(r"[|\-–—:]", t)[0].strip()
        rec["agency"] = t[:70]
    # phone: prefer tel: links
    tel = re.search(r'tel:\+?1?[-.\s(]*([2-9]\d\d)[-.\s)]*(\d{3})[-.\s]*(\d{4})', html)
    if not tel:
        tel = PHONE_RE.search(re.sub(r"<[^>]+>", " ", html))
    if tel:
        rec["phone"] = f"({tel.group(1)}) {tel.group(2)}-{tel.group(3)}"
    # email
    for em in EMAIL_RE.findall(html):
        if not BAD_EMAIL.search(em) and len(em) < 60:
            rec["email"] = em.lower()
            break
    # state: look for ", ST 5digit" or state name
    sm = re.search(r",\s*([A-Z]{2})\s+\d{5}", html)
    if sm and sm.group(1) in STATES:
        rec["state"] = sm.group(1)
    else:
        for name, ab in ST_NAME_TO_ABBR.items():
            if re.search(r"\b" + re.escape(name) + r"\b", html, re.I):
                rec["state"] = ab
                break
    cm = re.search(r"([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?),\s*" + (rec["state"] or "[A-Z]{2}") + r"\s+\d{5}", html)
    if cm:
        rec["city"] = cm.group(1)
    sig = f"{domain} {rec['agency']}"
    rec["trucking_signal"] = "specialist" if TRUCK_RE.search(sig) else "commercial"
    if not rec["phone"]:
        return None  # not callable → drop
    return rec


def load_existing():
    if not OUT.exists():
        return []
    try:
        rows = list(csv.DictReader(open(OUT)))
        return [r for r in rows if r.get("phone")]
    except Exception:
        return []


def main():
    t0 = time.time()
    queries = [f"{t} {name}" for name in STATES.values() for t in TERMS]
    print(f"[1/3] discovery: {len(queries)} DuckDuckGo queries …", flush=True)
    domains = {}
    done = 0
    with ThreadPoolExecutor(6) as ex:
        futs = {ex.submit(ddg, q): q for q in queries}
        for f in as_completed(futs):
            for url in f.result():
                d = domain_of(url)
                if d and not BLOCK.search(d) and "." in d and len(d) < 45:
                    domains[d] = True
            done += 1
            if done % 40 == 0:
                print(f"  {done}/{len(queries)} queries · {len(domains)} unique domains", flush=True)
            time.sleep(0.05)
    doms = list(domains)
    print(f"  {len(doms)} unique candidate agency domains", flush=True)

    print(f"[2/3] scraping {len(doms)} agency sites for phone/email …", flush=True)
    scraped = []
    done = 0
    with ThreadPoolExecutor(16) as ex:
        futs = {ex.submit(scrape_site, d): d for d in doms}
        for f in as_completed(futs):
            r = f.result()
            if r:
                if not r["agency"]:
                    r["agency"] = agency_name(futs[f])
                scraped.append(r)
            done += 1
            if done % 60 == 0:
                print(f"  {done}/{len(doms)} · {len(scraped)} callable", flush=True)

    print(f"[3/3] merge + dedupe …", flush=True)
    rows, seen = [], set()

    def add(agency, phone, email, website, city, state, sig, source):
        key = re.sub(r"\D", "", phone)[-10:] or domain_of(website)
        if not key or key in seen:
            return
        seen.add(key)
        rows.append({
            "kind": "broker", "agency": agency, "phone": phone, "email": email,
            "website": website, "street": "", "city": city, "state": state,
            "zip": "", "tz_offset": TZ.get(state, -6),
            "trucking_signal": sig, "source": source,
        })

    for r in load_existing():
        add(r.get("agency", ""), r.get("phone", ""), r.get("email", ""), r.get("website", ""),
            r.get("city", ""), r.get("state", ""), r.get("trucking_signal", "commercial"),
            r.get("source", "progressiveagent.com"))
    for r in scraped:
        add(r["agency"], r["phone"], r["email"], r["website"], r["city"], r["state"],
            r["trucking_signal"], "ddg-search")

    rows.sort(key=lambda r: (r["trucking_signal"] != "specialist", not r["email"], r["state"]))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    spec = sum(1 for r in rows if r["trucking_signal"] == "specialist")
    em = sum(1 for r in rows if r["email"])
    print(f"DONE in {int(time.time()-t0)}s: {len(rows)} brokers "
          f"({spec} specialist, {em} w/ email) → {OUT}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
