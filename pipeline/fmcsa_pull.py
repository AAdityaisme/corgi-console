#!/usr/bin/env python3
"""Nationwide trucker lead pull for Corgi OS.

Census (az4n-8mr2) + current insurance (c5y8-a4uz) + cancellation history
(3uet-3z4i), all free Socrata. No SAFER scraping — census carries
safety_rating natively, so the whole pull is API-only and fast.

Output: ~/Desktop/corgi/corgi-os-data/truckers.csv
"""
import os
import csv
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

BASE = "https://data.transportation.gov/resource"
TOKEN = os.environ.get("SOCRATA_APP_TOKEN", "")  # optional; anonymous works at a lower rate limit
OUT = Path.home() / "Desktop/corgi/corgi-os-data/truckers.csv"

CENSUS_FIELDS = (
    "dot_number,legal_name,dba_name,phone,cell_phone,email_address,"
    "company_officer_1,phy_street,phy_city,phy_state,phy_zip,power_units,"
    "total_drivers,mcs150_date,mcs150_mileage,add_date,safety_rating,"
    "hm_ind,docket1prefix,docket1,crgo_genfreight,crgo_coldfood,"
    "crgo_beverages,crgo_produce,interstate_beyond_100_miles"
)

# state -> UTC offset (standard time, close enough for call-window math)
TZ = {**{s: -5 for s in "CT DE FL GA IN KY ME MD MA MI NH NJ NY NC OH PA RI SC VT VA WV DC".split()},
      **{s: -6 for s in "AL AR IL IA KS LA MN MS MO NE ND OK SD TN TX WI".split()},
      **{s: -7 for s in "AZ CO ID MT NM UT WY".split()},
      **{s: -8 for s in "CA NV OR WA".split()},
      "AK": -9, "HI": -10}


def q(dataset: str, params: dict, retries: int = 3):
    url = f"{BASE}/{dataset}.json?" + urllib.parse.urlencode(params)
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={
                "X-App-Token": TOKEN, "User-Agent": "corgi-os-pipeline/2.0"})
            return json.loads(urllib.request.urlopen(req, timeout=60).read().decode())
        except Exception as e:
            if i == retries - 1:
                print(f"  ! {dataset} failed after {retries}: {e}", flush=True)
                return []
            time.sleep(2 * (i + 1))


def chunked(xs, n):
    for i in range(0, len(xs), n):
        yield xs[i:i + n]


def parse_date(s):
    if not s:
        return None
    s = s[:10].replace("-", "")
    try:
        return date(int(s[:4]), int(s[4:6]), int(s[6:8]))
    except Exception:
        return None


def clean_phone(p):
    d = "".join(c for c in (p or "") if c.isdigit())
    if len(d) == 11 and d[0] == "1":
        d = d[1:]
    if len(d) != 10 or d[0] in "01" or len(set(d)) == 1 or d == "1234567890":
        return ""
    return f"({d[:3]}) {d[3:6]}-{d[6:]}"


def main():
    today = date.today()
    print("[1/5] census pull: nationwide active for-hire 3-50 PU …", flush=True)
    rows = q("az4n-8mr2", {
        "$select": CENSUS_FIELDS,
        "$where": ("status_code='A' AND carrier_operation='A' "
                   "AND power_units::number between 3 and 50 "
                   "AND phone IS NOT NULL AND mcs150_date IS NOT NULL"),
        "$order": "mcs150_date DESC",
        "$limit": "3500",
    })
    print(f"  {len(rows)} census rows", flush=True)

    print("[2/5] new-authority pull (last 120 days) …", flush=True)
    cutoff = (today - timedelta(days=120)).strftime("%Y%m%d")
    na = q("az4n-8mr2", {
        "$select": CENSUS_FIELDS,
        "$where": (f"status_code='A' AND carrier_operation='A' "
                   f"AND power_units::number between 1 and 50 "
                   f"AND phone IS NOT NULL AND add_date >= '{cutoff}'"),
        "$order": "add_date DESC",
        "$limit": "1000",
    })
    print(f"  {len(na)} new-authority rows", flush=True)

    by_dot = {}
    for r in rows + na:
        d = r.get("dot_number")
        if d and d not in by_dot and clean_phone(r.get("phone") or r.get("cell_phone")):
            by_dot[d] = r
    dots = list(by_dot)
    print(f"  {len(dots)} unique carriers with valid phone", flush=True)

    print("[3/5] insurance join (current filings) …", flush=True)
    ins = {}
    for i, chunk in enumerate(chunked(dots, 45)):
        lst = ",".join(f"'{d}'" for d in chunk)
        for r in q("c5y8-a4uz", {
            "$select": "usdot_number,insurance_company_name,effective_date,max_cov_amount,ins_form_code",
            "$where": f"usdot_number in({lst})",
            "$limit": "500",
        }):
            d = r.get("usdot_number")
            eff = parse_date(r.get("effective_date"))
            if not d or not eff:
                continue
            cur = ins.get(d)
            is91 = "91" in (r.get("ins_form_code") or "")
            if not cur or (eff > cur["eff"]) or (is91 and not cur["is91"] and eff >= cur["eff"] - timedelta(days=365)):
                ins[d] = {"co": r.get("insurance_company_name", ""), "eff": eff,
                          "cov": r.get("max_cov_amount", ""), "is91": is91}
        if i % 20 == 0:
            print(f"  ins chunk {i}/{len(dots)//45}", flush=True)
        time.sleep(0.15)

    print("[4/5] cancellation join …", flush=True)
    cancels = {}
    recent = (today - timedelta(days=240)).strftime("%Y%m%d")
    for i, chunk in enumerate(chunked(dots, 45)):
        lst = ",".join(f"'{d}'" for d in chunk)
        for r in q("3uet-3z4i", {
            "$select": "usdot_number,cancl_effective_date,insurance_company_name",
            "$where": f"usdot_number in({lst}) AND cancl_effective_date >= '{recent}'",
            "$limit": "500",
        }):
            d = r.get("usdot_number")
            cd = parse_date(r.get("cancl_effective_date"))
            if d and cd and (d not in cancels or cd > cancels[d]["date"]):
                cancels[d] = {"date": cd, "co": r.get("insurance_company_name", "")}
        time.sleep(0.15)
    print(f"  {len(ins)} with insurance on file · {len(cancels)} with recent cancellation", flush=True)

    print("[5/5] score, tier, write …", flush=True)
    out = []
    for d, r in by_dot.items():
        units = int(float(r.get("power_units") or 0))
        phone = clean_phone(r.get("phone") or r.get("cell_phone"))
        email = (r.get("email_address") or "").strip().lower()
        owner = (r.get("company_officer_1") or "").strip().title()
        mcs = parse_date(r.get("mcs150_date"))
        added = parse_date(r.get("add_date"))
        i = ins.get(d)
        c = cancels.get(d)
        est_renewal = (i["eff"] + timedelta(days=365)).isoformat() if i else ""
        authority_months = ((today - added).days // 30) if added else ""

        equipment = "; ".join(n for f, n in [
            ("crgo_genfreight", "General Freight"), ("crgo_coldfood", "Refrigerated"),
            ("crgo_beverages", "Beverages"), ("crgo_produce", "Produce")]
            if (r.get(f) or "").upper() in ("X", "Y", "1", "TRUE"))

        score = 5
        score += 40 if 20 <= units <= 29 else 30 if 15 <= units <= 39 else 22 if 10 <= units <= 50 else 12 if 5 <= units <= 9 else 6
        score += 18 if email else 0
        score += 12 if owner else 0
        score += 6 if (r.get("interstate_beyond_100_miles") or "").upper() in ("X", "Y", "1", "TRUE") else 0
        score += 6 if equipment else 0
        if mcs:
            score += 10 if mcs.year >= today.year else 5 if mcs.year == today.year - 1 else 0
        if c:
            score += 25  # rescue signal
        if est_renewal:
            days = (date.fromisoformat(est_renewal) - today).days
            if 0 <= days <= 60:
                score += 20  # renewal wire

        angle = ("RS" if c or (not i and (r.get("interstate_beyond_100_miles") or "").upper() in ("X", "Y", "1", "TRUE"))
                 else "RW" if est_renewal and 0 <= (date.fromisoformat(est_renewal) - today).days <= 60
                 else "NA" if isinstance(authority_months, int) and authority_months <= 24
                 else "PL" if units <= 3 else "GEN")

        out.append({
            "kind": "fleet", "company": (r.get("legal_name") or "").title(),
            "dba": (r.get("dba_name") or "").title(), "owner": owner,
            "phone": phone, "email": email, "website": "",
            "street": (r.get("phy_street") or "").title(),
            "city": (r.get("phy_city") or "").title(), "state": r.get("phy_state", ""),
            "zip": r.get("phy_zip", ""), "tz_offset": TZ.get(r.get("phy_state", ""), -6),
            "dot": d, "mc": (r.get("docket1prefix", "") + (r.get("docket1") or "")),
            "units": units, "drivers": r.get("total_drivers", ""),
            "equipment": equipment, "hazmat": r.get("hm_ind", ""),
            "safety_rating": (r.get("safety_rating") or "").strip(),
            "mileage": r.get("mcs150_mileage", ""), "mcs150_date": mcs.isoformat() if mcs else "",
            "authority_date": added.isoformat() if added else "",
            "authority_months": authority_months,
            "insurer": i["co"] if i else "", "ins_eff": i["eff"].isoformat() if i else "",
            "ins_cov": i["cov"] if i else "", "est_renewal": est_renewal,
            "cancel_date": c["date"].isoformat() if c else "",
            "cancel_insurer": c["co"] if c else "",
            "score": min(score, 100), "angle_seed": angle, "source": "fmcsa-census",
        })

    out.sort(key=lambda x: -x["score"])
    n = len(out)
    for idx, r in enumerate(out):
        r["tier"] = "Hot" if idx < n * 0.3 else "Warm" if idx < n * 0.7 else "Cold"

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
        w.writeheader()
        w.writerows(out)
    print(f"DONE: {n} truckers → {OUT}", flush=True)
    print(f"  angles: " + ", ".join(f"{a}={sum(1 for r in out if r['angle_seed']==a)}"
          for a in ("RS", "RW", "NA", "PL", "GEN")), flush=True)


if __name__ == "__main__":
    sys.exit(main())
