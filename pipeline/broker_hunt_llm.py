#!/usr/bin/env python3
"""Hunt NEW trucking-specialist brokers via OpenRouter web-grounded LLM,
then VERIFY each candidate by scraping its real website (phone/email/state).
LLM output is used only for discovery (name+domain) — contact data comes
exclusively from the live site, never from the model.

Output: ~/Desktop/New-Broker-Partners.csv (only rows with a verified email)
"""
import csv
import json
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from broker_search import scrape_site, fetch, EMAIL_RE, BAD_EMAIL, TRUCK_RE, TZ, BLOCK


def deep_email(domain):
    for path in ("/contact", "/contact-us", "/about", "/about-us", "/quote", "/get-a-quote"):
        html = fetch(f"https://{domain}{path}", timeout=8)
        for em in EMAIL_RE.findall(html or ""):
            if not BAD_EMAIL.search(em) and len(em) < 60:
                return em.lower()
    return ""


def site_is_trucking(domain):
    html = fetch(f"https://{domain}", timeout=8) or ""
    return len(re.findall(r"truck|trucking|motor carrier|owner.?operator|fleet", html, re.I)) >= 3

DATA = Path.home() / "Desktop/corgi/corgi-os-data"
OUT = Path.home() / "Desktop/New-Broker-Partners.csv"
TOKEN = (DATA / ".apify_token").parent  # not used; key below
OR_KEY = None
for line in open(Path.home() / "Desktop/Coding Projects/tg-export/.env"):
    if line.startswith("OPENROUTER_API_KEY="):
        OR_KEY = line.split("=", 1)[1].strip()
MODEL = "google/gemini-2.5-flash-lite:online"

TARGET = 50
QUERIES = [
    "the Houston Texas area", "the Dallas-Fort Worth area", "the Atlanta Georgia area",
    "the Chicago Illinois area", "the Southern California / Inland Empire area",
    "the Central Valley California area (Fresno, Stockton, Bakersfield)",
    "the Miami / South Florida area", "the Charlotte North Carolina area",
    "the Memphis / Nashville Tennessee area", "the Columbus / Cleveland Ohio area",
    "the Indianapolis Indiana area", "the Kansas City area", "the St Louis Missouri area",
    "the Phoenix Arizona area", "the Denver Colorado area", "the Salt Lake City Utah area",
    "the Portland Oregon area", "the Seattle Washington area", "the Sacramento area",
    "the Detroit Michigan area", "the Philadelphia / New Jersey area", "the Laredo / El Paso Texas border area",
    "Oklahoma", "Arkansas", "Louisiana", "Alabama", "Mississippi", "Kentucky",
    "Wisconsin", "Minnesota", "Iowa", "Nebraska", "Kansas", "Virginia", "South Carolina",
    "hotshot trucking (nationwide specialists)", "owner-operator insurance (nationwide specialists)",
    "reefer and produce haulers (nationwide specialists)", "dump truck and aggregate haulers",
    "tow truck and auto transport", "intermodal drayage carriers", "flatbed and heavy haul carriers",
]


def openrouter(prompt, retries=3):
    for i in range(retries):
        try:
            req = urllib.request.Request(
                "https://openrouter.ai/api/v1/chat/completions",
                data=json.dumps({
                    "model": MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.2,
                }).encode(),
                headers={"Authorization": f"Bearer {OR_KEY}", "Content-Type": "application/json"},
                method="POST")
            out = json.loads(urllib.request.urlopen(req, timeout=120).read().decode())
            return out["choices"][0]["message"]["content"]
        except Exception as e:
            if i == retries - 1:
                print(f"  ! openrouter: {e}", flush=True)
                return ""
            time.sleep(3 * (i + 1))


def parse_domains(text):
    out = []
    m = re.search(r"\[.*\]", text, re.S)
    if m:
        try:
            for e in json.loads(m.group(0)):
                if isinstance(e, dict) and e.get("website"):
                    out.append((e.get("name", ""), e["website"]))
            return out
        except Exception:
            pass
    # fallback: harvest bare domains
    for d in re.findall(r"(?:https?://)?(?:www\.)?([a-z0-9-]+\.[a-z]{2,}(?:\.[a-z]{2})?)", text.lower()):
        out.append(("", d))
    return out


def norm_domain(w):
    d = re.sub(r"https?://(www\.)?", "", (w or "").lower()).split("/")[0]
    return d.strip()


def existing_keys():
    doms, phones = set(), set()
    for r in csv.DictReader(open(DATA / "brokers.csv")):
        d = norm_domain(r.get("website", ""))
        if d:
            doms.add(d)
            doms.add(d.replace("www.", ""))
        p = re.sub(r"\D", "", r.get("phone", ""))[-10:]
        if p:
            phones.add(p)
    return doms, phones


def main():
    if not OR_KEY:
        sys.exit("no OPENROUTER_API_KEY in tg-export/.env")
    doms, phones = existing_keys()
    print(f"existing: {len(doms)} domains / {len(phones)} phones to exclude", flush=True)

    seen = set()
    verified = []
    if OUT.exists():
        for r in csv.DictReader(open(OUT)):
            verified.append({"agency": r["agency"], "phone": r["phone"], "email": r["email"],
                             "website": r["website"], "city": r.get("city",""), "state": r.get("state","")})
            d = norm_domain(r["website"]); seen.add(d); doms.add(d)
            phones.add(re.sub(r"\D","",r["phone"])[-10:])
        print(f"resuming with {len(verified)} already verified", flush=True)

    def verify_batch(batch):
        got = []
        with ThreadPoolExecutor(10) as ex:
            futs = {ex.submit(scrape_site, d): (n, d) for n, d in batch}
            for f in as_completed(futs):
                n, d = futs[f]
                r = f.result()
                if not r or not r.get("phone"):
                    continue
                ph = re.sub(r"\D", "", r["phone"])[-10:]
                if ph in phones:
                    continue
                if not r.get("email"):
                    r["email"] = deep_email(d)
                if not r.get("email"):
                    continue  # email required — that's the whole point
                if not TRUCK_RE.search(f"{d} {r.get('agency','')}") and not site_is_trucking(d):
                    continue  # trucking-specialist only (name/domain OR site content)
                phones.add(ph)
                r["agency"] = r["agency"] or n or d.split(".")[0].replace("-", " ").title()
                r["website"] = r.get("website") or f"https://{d}"
                got.append(r)
        return got

    for state in QUERIES:
        if len(verified) >= TARGET:
            break
        prompt = (
            f"Search the web for small independent insurance AGENCIES that specialize in commercial "
            f"trucking insurance serving {state}. Only real retail agencies/brokerages with their own "
            f"website — NOT carriers (Progressive, GEICO, Great West, Sentry, Northland, Canal), "
            f"NOT comparison/lead-gen sites (NerdWallet, Insurify, TheZebra, CoverWallet), NOT "
            f"national wholesale giants. Prefer smaller regional specialists. Return ONLY a JSON "
            f'array: [{{"name": "...", "website": "https://..."}}] with up to 15 agencies. Focus on small independent local agencies most people have not heard of.'
        )
        text = openrouter(prompt)
        fresh = []
        for n, w in parse_domains(text):
            d = norm_domain(w)
            if not d or d in seen or d in doms or BLOCK.search(d) or len(d) > 45:
                continue
            seen.add(d)
            fresh.append((n, d))
        got = verify_batch(fresh)
        verified.extend(got)
        print(f"  {state}: {len(fresh)} candidates → {len(got)} verified w/ email · total {len(verified)}/{TARGET}", flush=True)
        time.sleep(0.5)

    verified = verified[:TARGET + 10]
    rows = []
    for r in verified[:TARGET]:
        rows.append({
            "agency": r["agency"][:60], "phone": r["phone"], "email": r["email"],
            "website": r["website"], "city": r.get("city", ""), "state": r.get("state", ""),
            "specialty": "Trucking", "source": "openrouter-web + site-verified",
        })
    with open(OUT, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()) if rows else ["agency"])
        w.writeheader()
        w.writerows(rows)
    print(f"DONE: {len(rows)} new verified trucking brokers → {OUT}", flush=True)


if __name__ == "__main__":
    main()
