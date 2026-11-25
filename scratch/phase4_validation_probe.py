"""Phase 4 post-integration validation probes. Read-only."""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path

BASE = "http://localhost:5185"
UP = "https://naditwin-production.up.railway.app"
OUT = Path(__file__).resolve().parent / "phase4_validation_probe.json"


def get(url: str, timeout: float = 30):
    req = urllib.request.Request(
        url,
        headers={"Accept": "application/json,*/*", "User-Agent": "RiverEye-Phase4-Validation/1.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            headers = {k.lower(): v for k, v in r.headers.items()}
            return {"ok": True, "status": r.status, "headers": headers, "body": body}
    except urllib.error.HTTPError as e:
        body = e.read() if hasattr(e, "read") else b""
        headers = {k.lower(): v for k, v in (e.headers.items() if e.headers else [])}
        return {"ok": False, "status": e.code, "headers": headers, "body": body, "error": str(e)}
    except Exception as e:
        return {"ok": False, "status": None, "error": str(e), "body": b"", "headers": {}}


def summarize(path: str, r: dict):
    entry = {
        "status": r.get("status"),
        "ok": r.get("ok"),
        "upstream": r.get("headers", {}).get("x-naditwin-upstream-status"),
        "latency_ms": r.get("headers", {}).get("x-naditwin-latency-ms"),
        "proxy": r.get("headers", {}).get("x-naditwin-proxy"),
        "ct": (r.get("headers", {}).get("content-type") or "")[:80],
        "bytes": len(r.get("body") or b""),
    }
    body = r.get("body") or b""
    if not body:
        entry["error"] = r.get("error")
        return entry
    try:
        d = json.loads(body.decode("utf-8", "ignore"))
    except Exception:
        entry["head"] = body[:200].decode("utf-8", "ignore")
        return entry

    if isinstance(d, dict):
        entry["keys"] = sorted(d.keys())[:30]
        for k in ("q_out_now", "q_up_now", "q_now", "at", "error", "message", "n_cells", "reach_km"):
            if k in d:
                entry[k] = d[k]
        if isinstance(d.get("q_station"), list):
            entry["q_station_n"] = len(d["q_station"])
            qs = [x for x in d["q_station"] if isinstance(x, (int, float))]
            if qs:
                entry["q_station_min"] = min(qs)
                entry["q_station_max"] = max(qs)
        if "datum" in d:
            entry["datum"] = d.get("datum_short") or d.get("datum")
        if isinstance(d.get("weather"), dict):
            entry["rain_now_mmh"] = d["weather"].get("rain_now_mmh")
            entry["temperature_c"] = d["weather"].get("temperature_c")
        if isinstance(d.get("assumptions"), dict):
            entry["dam_note"] = d["assumptions"].get("note")
        if "locked" in d:
            entry["locked"] = d["locked"]
        # forecast profile shape
        for k in ("median", "p10", "p90", "p50", "wse", "chainage_m"):
            if isinstance(d.get(k), list):
                entry[f"{k}_n"] = len(d[k])
        if isinstance(d.get("forecast"), dict):
            entry["forecast_keys"] = list(d["forecast"].keys())[:20]
        if isinstance(d.get("observed"), list):
            entry["observed_n"] = len(d["observed"])
        if isinstance(d.get("times"), list):
            entry["times_n"] = len(d["times"])
    elif isinstance(d, list):
        entry["list_n"] = len(d)
        if d and isinstance(d[0], dict):
            entry["item0_keys"] = sorted(d[0].keys())[:25]
            if "q_now" in d[0]:
                entry["seg0_q_now"] = d[0].get("q_now")
                entry["seg0_forecast"] = bool(d[0].get("forecast"))
    return entry


def main():
    report = {"base_proxy": BASE, "upstream": UP, "checks": {}}

    paths = [
        "/naditwin-api/api/meta",
        "/naditwin-api/api/state",
        "/naditwin-api/api/live",
        "/naditwin-api/api/discharge_profile",
        "/naditwin-api/api/forecast/profile?lead=24",
        "/naditwin-api/api/hydrograph?cell=840&hours=72",
        "/naditwin-api/api/margins",
        "/naditwin-api/api/stations?loc=L1",
        "/naditwin-api/api/stations.csv",
        "/naditwin-api/api/stations.xlsx?loc=all",
        "/naditwin-api/api/admin",
    ]
    for path in paths:
        url = BASE + path
        if "admin" not in path and "river=" not in path:
            url += ("&" if "?" in path else "?") + "river=Mula-Mutha"
        r = get(url)
        report["checks"][path] = summarize(path, r)
        print(path, report["checks"][path].get("status"), report["checks"][path].get("q_out_now") or report["checks"][path].get("n_cells") or report["checks"][path].get("error") or report["checks"][path].get("list_n") or "")

    # Upstream stations investigation
    up_paths = [
        "/api/stations?river=Mula-Mutha",
        "/api/stations?river=Mula-Mutha&loc=L1",
        "/api/stations?river=Mula-Mutha&loc=all",
        "/api/stations?river=Mula-Mutha&loc=L2",
        "/api/stations.csv?river=Mula-Mutha",
        "/api/stations.xlsx?river=Mula-Mutha&loc=all",
        "/api/stations.xlsx?river=Mula-Mutha&loc=L1",
    ]
    for path in up_paths:
        r = get(UP + path)
        entry = {
            "status": r.get("status"),
            "ok": r.get("ok"),
            "bytes": len(r.get("body") or b""),
            "ct": (r.get("headers", {}).get("content-type") or "")[:80],
            "head": (r.get("body") or b"")[:400].decode("utf-8", "ignore"),
        }
        try:
            d = json.loads((r.get("body") or b"").decode("utf-8", "ignore"))
            if isinstance(d, dict):
                entry["keys"] = sorted(d.keys())[:40]
                entry["error"] = d.get("error") or d.get("message") or d.get("detail")
                # parallel arrays?
                for k, v in d.items():
                    if isinstance(v, list):
                        entry[f"{k}_n"] = len(v)
            elif isinstance(d, list):
                entry["list_n"] = len(d)
        except Exception:
            pass
        report["checks"]["UPSTREAM" + path] = entry
        print("UP", path, entry.get("status"), entry.get("error") or entry.get("list_n") or entry.get("q_n") or entry.get("bytes"))

    # Local geometry comparison
    local = json.loads(
        Path("public/data/naditwin/chainage_profile.json").read_text(encoding="utf-8")
    )
    meta = report["checks"]["/naditwin-api/api/meta"]
    state = report["checks"]["/naditwin-api/api/state"]
    report["chainage_compare"] = {
        "local_n": len(local),
        "local_first_m": local[0].get("chainage_m") if local else None,
        "local_last_m": local[-1].get("chainage_m") if local else None,
        "nt_n_cells": meta.get("n_cells"),
        "nt_reach_km": meta.get("reach_km"),
        "nt_q_station_n": state.get("q_station_n"),
        "nt_q_out_now": state.get("q_out_now"),
        "nt_at": state.get("at"),
        "nt_datum": meta.get("datum"),
    }

    OUT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
