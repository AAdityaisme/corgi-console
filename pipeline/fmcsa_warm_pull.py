#!/usr/bin/env python3
"""Warmth-first nationwide trucker pull for Corgi Console.

Signal-first instead of census-first: start from the BUY SIGNALS and join
census onto them, so the list is ranked by how likely the carrier is shopping
for insurance RIGHT NOW:

  T1  RESCUE   — insurance cancellation effective within [-30d, +75d]
  T2  SUSP     — recent suspension/revocation orders (authority at risk)
  T3  WIRE     — current filing effective 10–13 months ago → renewal 0–75d out
  T4  NEWAUTH  — authority added in last 8 months (first-time buyers)
  T5  SWEET    — census sweet spot fill (10–30 units, fresh MCS-150)

All free Socrata. Output: ~/Desktop/corgi/corgi-os-data/truckers.csv
"""
import os
import csv
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, timedelta
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

TZ = {**{s: -5 for s in "CT DE FL GA IN KY ME MD MA MI NH NJ NY NC OH PA RI SC VT VA WV DC".split()},
      **{s: -6 for s in "AL AR IL IA KS LA MN MS MO NE ND OK SD TN TX WI".split()},
      **{s: -7 for s in "AZ CO ID MT NM UT WY".split()},
      **{s: -8 for s in "CA NV OR WA".split()}, "AK": -9, "HI": -10}


def q(dataset, params, retries=3):
    url = f"{BASE}/{dataset}.json?" + urllib.parse.urlencode(params)
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={
                "X-App-Token": TOKEN, "User-Agent": "corgi-console-pipeline/2.1"})
            return json.loads(urllib.request.urlopen(req, timeout=90).read().decode())
        except Exception as e:
            if i == retries - 1:
                print(f"  ! {dataset}: {e}", flush=True)
                return []
            time.sleep(2 * (i + 1))


def chunked(xs, n):
    for i in range(0, len(xs), n):
        yield xs[i:i + n]


def pdate(s):
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


def fmt(iso_or_8):
    d = pdate(iso_or_8)
    return d.isoformat() if d else ""


def main():
    today = date.today()
    signals = {}  # dot -> dict(cancel=..., cancel_co=..., susp=..., wire_eff=..., )

    # ---- T1 rescue: cancellations effective -30d .. +75d ----
    lo = (today - timedelta(days=30)).strftime("%Y%m%d")
    hi = (today + timedelta(days=75)).strftime("%Y%m%d")
    print(f"[1/6] cancellations {lo}..{hi} …", flush=True)
    rows = q("3uet-3z4i", {
        "$select": "usdot_number,cancl_effective_date,insurance_company_name",
        "$where": f"cancl_effective_date between '{lo}' and '{hi}'",
        "$order": "cancl_effective_date DESC",
        "$limit": "8000",
    })
    for r in rows:
        d = r.get("usdot_number")
        cd = pdate(r.get("cancl_effective_date"))
        if d and cd:
            s = signals.setdefault(d, {})
            if "cancel" not in s or cd > s["cancel"]:
                s["cancel"] = cd
                s["cancel_co"] = r.get("insurance_company_name", "")
    print(f"  {len(signals)} carriers with live cancellation", flush=True)

    # ---- T2 suspensions ----
    print("[2/6] recent suspension orders …", flush=True)
    srows = q("wb4f-neki", {
        "$select": "usdot_number,order1_type_desc,order1_serve_date",
        "$order": "order1_serve_date DESC",
        "$limit": "1500",
    })
    for r in srows:
        d = r.get("usdot_number")
        if d:
            s = signals.setdefault(d, {})
            s.setdefault("susp", r.get("order1_type_desc", ""))
            s.setdefault("susp_date", fmt(r.get("order1_serve_date")))
    print(f"  {len(signals)} carriers after suspensions", flush=True)

    # ---- T3 renewal wire: filing effective 10–13 months ago ----
    wlo = (today - timedelta(days=395)).strftime("%Y%m%d")
    whi = (today - timedelta(days=300)).strftime("%Y%m%d")
    print(f"[3/6] renewal wire (filings effective {wlo}..{whi}) …", flush=True)
    wire = q("c5y8-a4uz", {
        "$select": "usdot_number,insurance_company_name,effective_date,max_cov_amount",
        "$where": f"effective_date between '{wlo}' and '{whi}' AND ins_form_code like '%91%'",
        "$order": "effective_date DESC",
        "$limit": "15000",
    })
    for r in wire:
        d = r.get("usdot_number")
        eff = pdate(r.get("effective_date"))
        if d and eff:
            s = signals.setdefault(d, {})
            if "wire_eff" not in s or eff > s["wire_eff"]:
                s["wire_eff"] = eff
                s["wire_co"] = r.get("insurance_company_name", "")
                s["wire_cov"] = r.get("max_cov_amount", "")
    print(f"  {len(signals)} carriers after renewal wire", flush=True)

    # ---- census join for all signal DOTs ----
    dots = list(signals)
    print(f"[4/6] census join for {len(dots)} signal carriers …", flush=True)
    carriers = {}
    for i, chunk in enumerate(chunked(dots, 400)):
        lst = ",".join(f"'{d}'" for d in chunk)
        for r in q("az4n-8mr2", {
            "$select": CENSUS_FIELDS,
            "$where": (f"dot_number in({lst}) AND status_code='A' "
                       f"AND power_units::number between 1 and 60"),
            "$limit": "500",
        }):
            carriers[r["dot_number"]] = r
        if i % 10 == 0:
            print(f"  chunk {i}/{len(dots)//400} · {len(carriers)} matched", flush=True)
        time.sleep(0.1)
    print(f"  {len(carriers)} active carriers matched", flush=True)

    # ---- T4 new authority ----
    print("[5/6] new authorities (last 8 months) …", flush=True)
    cutoff = (today - timedelta(days=240)).strftime("%Y%m%d")
    na = q("az4n-8mr2", {
        "$select": CENSUS_FIELDS,
        "$where": (f"status_code='A' AND carrier_operation='A' AND add_date >= '{cutoff}' "
                   f"AND phone IS NOT NULL AND power_units::number between 1 and 50"),
        "$order": "add_date DESC",
        "$limit": "2000",
    })
    for r in na:
        carriers.setdefault(r["dot_number"], r)

    # ---- T5 sweet-spot fill ----
    sweet = q("az4n-8mr2", {
        "$select": CENSUS_FIELDS,
        "$where": ("status_code='A' AND carrier_operation='A' "
                   "AND power_units::number between 10 and 30 "
                   "AND phone IS NOT NULL AND mcs150_date IS NOT NULL"),
        "$order": "mcs150_date DESC",
        "$limit": "1500",
    })
    for r in sweet:
        carriers.setdefault(r["dot_number"], r)
    print(f"  {len(carriers)} total candidates", flush=True)

    # ---- score + write ----
    print("[6/6] warmth scoring …", flush=True)
    out = []
    for d, r in carriers.items():
        phone = clean_phone(r.get("phone") or r.get("cell_phone"))
        if not phone:
            continue
        s = signals.get(d, {})
        units = int(float(r.get("power_units") or 0))
        email = (r.get("email_address") or "").strip().lower()
        owner = (r.get("company_officer_1") or "").strip().title()
        mcs = pdate(r.get("mcs150_date"))
        added = pdate(r.get("add_date"))
        authority_months = ((today - added).days // 30) if added else ""

        est_renewal = ""
        if s.get("wire_eff"):
            est_renewal = (s["wire_eff"] + timedelta(days=365)).isoformat()

        warmth = 0
        why = []
        if s.get("cancel"):
            dd = abs((s["cancel"] - today).days)
            warmth += 60 - min(30, dd // 3)
            why.append("cancel")
        if s.get("susp"):
            warmth += 18
            why.append("susp")
        if est_renewal:
            dr = (date.fromisoformat(est_renewal) - today).days
            if 0 <= dr <= 45:
                warmth += 45 - dr // 3
                why.append("wire<45d")
            elif 45 < dr <= 90:
                warmth += 22
                why.append("wire<90d")
        if isinstance(authority_months, int) and authority_months <= 8:
            warmth += 22
            why.append("new-auth")
        if 10 <= units <= 30:
            warmth += 12
        elif 5 <= units <= 50:
            warmth += 6
        if email:
            warmth += 6
        if owner:
            warmth += 4
        if mcs and mcs.year >= today.year - 1:
            warmth += 4
        if (r.get("interstate_beyond_100_miles") or "").upper() in ("X", "Y", "1", "TRUE"):
            warmth += 3

        angle = ("RS" if s.get("cancel") or s.get("susp")
                 else "RW" if est_renewal and 0 <= (date.fromisoformat(est_renewal) - today).days <= 90
                 else "NA" if isinstance(authority_months, int) and authority_months <= 24
                 else "PL" if units <= 3 else "GEN")

        equipment = "; ".join(n for f, n in [
            ("crgo_genfreight", "General Freight"), ("crgo_coldfood", "Refrigerated"),
            ("crgo_beverages", "Beverages"), ("crgo_produce", "Produce")]
            if (r.get(f) or "").upper() in ("X", "Y", "1", "TRUE"))

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
            "mileage": r.get("mcs150_mileage", ""),
            "mcs150_date": mcs.isoformat() if mcs else "",
            "authority_date": added.isoformat() if added else "",
            "authority_months": authority_months,
            "insurer": s.get("wire_co", ""),
            "ins_eff": s["wire_eff"].isoformat() if s.get("wire_eff") else "",
            "ins_cov": s.get("wire_cov", ""),
            "est_renewal": est_renewal,
            "cancel_date": s["cancel"].isoformat() if s.get("cancel") else "",
            "cancel_insurer": s.get("cancel_co", ""),
            "score": warmth, "angle_seed": angle,
            "source": "+".join(why) if why else "sweet-spot",
        })

    out.sort(key=lambda x: -x["score"])
    out = out[:6000]
    n = len(out)
    for idx, r in enumerate(out):
        r["tier"] = "Hot" if idx < n * 0.3 else "Warm" if idx < n * 0.7 else "Cold"

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
        w.writeheader()
        w.writerows(out)
    print(f"DONE: {n} warm truckers → {OUT}", flush=True)
    print("  angles:", {a: sum(1 for r in out if r["angle_seed"] == a) for a in ("RS", "RW", "NA", "PL", "GEN")}, flush=True)
    print("  top-500 warmth range:", out[0]["score"], "→", out[min(499, n-1)]["score"], flush=True)


if __name__ == "__main__":
    sys.exit(main())
