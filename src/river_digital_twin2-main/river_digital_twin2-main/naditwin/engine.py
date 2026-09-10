"""
NadiTwin engine — multi-river capable.

Each river is a self-contained data folder under naditwin/rivers/<key>/:
    chainage_profile.json   REAL centerline stations (10 m spacing) + width,
                             extracted from that river's KML polygon.
    reach_polygon.json      REAL traced polygon (lon/lat), for the map.
    landmarks.json          REAL localities snapped onto the real chainage.
    depth_profile.json      OPTIONAL. REAL per-station water depth, from a
                             bathymetry survey grid (IDW-interpolated onto
                             the chainage). Only present for rivers where a
                             real depth survey was supplied — currently
                             Mula-Mutha. Where absent, bed elevation falls
                             back to a fully synthetic toy formula.

What is REAL for every river: centerline, chainage, cross-section width
(from the KML), and locality names/positions (snapped to that chainage).

What is REAL only for Mula-Mutha (because a real depth survey was
supplied for it): local bed relief (relative depth variation).

What is STILL SYNTHETIC for every river: absolute elevation datum,
downstream slope, embankment/bank crest height, discharge (Q), river
stage time series, hydrograph, forecasts, margins, and alerts — none of
these have a real DEM or real gauge/sensor feed behind them yet. Plug
a real discharge/stage CSV in via `--gauge your_file.csv`; plug in a
real DEM by resampling it onto each river's lon/lat list and rebuilding
bed/crest (see README.md).
"""

import json
import math
import random
import csv
import os
import time as _time

HERE = os.path.dirname(__file__)
RIVERS_DIR = os.path.join(HERE, "rivers")

PAST_HOURS = 72
FORECAST_HOURS = 72
N_MEMBERS = 50
TRUTH_HOURS = PAST_HOURS + 480   # long truth so the sim can be advanced

# --- synthetic-only knobs (no real datum / gauge available for any river yet) ---
WSE_DATUM_M = 0.0        # ARBITRARY relative datum: 0 m = assumed water surface
                          # at survey time. Real MSL elevation needs a DEM.
TOY_SLOPE = 0.0009        # synthetic downstream slope, m/m — only so the toy
                          # hydraulics has a flow direction; not measured.
DEPTH_COEF = 0.10         # hydraulic-geometry style depth = c * Q^0.6 * width_factor
DEPTH_EXP = 0.6


# ------------------------------ river registry ------------------------------

class RiverData:
    """Loads and holds the REAL, pre-computed geometry layers for one river."""

    def __init__(self, key, display_name, product_label):
        self.key = key
        self.display_name = display_name
        self.product_label = product_label
        d = os.path.join(RIVERS_DIR, key)

        with open(os.path.join(d, "chainage_profile.json")) as f:
            stations = json.load(f)
        with open(os.path.join(d, "reach_polygon.json")) as f:
            self.reach_polygon_lonlat = json.load(f)
        lm_path = os.path.join(d, "landmarks.json")
        if os.path.exists(lm_path):
            with open(lm_path) as f:
                self.landmarks = json.load(f)
        else:
            self.landmarks = []

        self.n_cells = len(stations)
        self.chainage_m = [s["chainage_m"] for s in stations]
        self.lon = [s["lon"] for s in stations]
        self.lat = [s["lat"] for s in stations]
        self.real_width_m = [s["width_m"] for s in stations]
        self.reach_len_m = self.chainage_m[-1]
        self.mean_width = sum(self.real_width_m) / len(self.real_width_m)

        depth_path = os.path.join(d, "depth_profile.json")
        if os.path.exists(depth_path):
            with open(depth_path) as f:
                depth_stations = json.load(f)
            self.has_real_depth = True
            self.real_depth_m = [ds["depth_m"] for ds in depth_stations]
            self.depth_flagged = [bool(ds["flagged"]) for ds in depth_stations]
            self.mean_depth = sum(self.real_depth_m) / len(self.real_depth_m)
        else:
            self.has_real_depth = False
            self.real_depth_m = [0.0] * self.n_cells
            self.depth_flagged = [False] * self.n_cells
            self.mean_depth = 0.0


RIVER_CONFIGS = {
    "Mula-Mutha": RiverData(
        key="mula_mutha",
        display_name="Mula-Mutha",
        product_label="NadiTwin — Mula-Mutha reach, Pune (real KML geometry + real depth survey)",
    ),
    "Mithi": RiverData(
        key="mithi",
        display_name="Mithi",
        product_label="NadiTwin — Mithi River reach, Mumbai (real KML geometry)",
    ),
}
DEFAULT_RIVER = "Mula-Mutha"


# --------------------------------- engine ---------------------------------

class TwinEngine:
    def __init__(self, river: RiverData, seed=42, gauge_csv=None):
        self.river = river
        self.seed = seed
        self.rng = random.Random(seed)
        self.t0 = _time.time()
        self.now_idx = PAST_HOURS + 24
        self._build_geometry()
        self._build_truth_discharge(gauge_csv)
        self._build_assets()
        self.refresh_forecast()

    # ------------------------- geometry / bathymetry -------------------------

    def _build_geometry(self):
        """bed = ARBITRARY relative datum MINUS the REAL measured depth at
        that station where a real depth survey was supplied (currently
        Mula-Mutha only), plus a small SYNTHETIC downstream slope so the
        toy hydraulics has a flow direction. Where no real depth survey
        exists (e.g. Mithi), bed falls back fully to a synthetic toy
        formula, same as the original demo. crest and sigma_bed remain
        synthetic/toy for every river, pending a real DEM / structural
        survey."""
        r = self.river
        rng = random.Random(self.seed + 1)
        self.bed = []
        self.crest = []
        self.width_factor = []
        self.sigma_bed = []
        for i in range(r.n_cells):
            x = r.chainage_m[i]
            slope_component = WSE_DATUM_M - TOY_SLOPE * x   # synthetic trend only

            if r.has_real_depth:
                relief_component = -(r.real_depth_m[i] - r.mean_depth)   # REAL, from survey
                bed = slope_component + relief_component
            else:
                # fully synthetic toy bed (no real depth survey for this river)
                pools = 0.6 * math.sin(2 * math.pi * x / 500.0) \
                      + 0.3 * math.sin(2 * math.pi * x / 140.0 + 1.3)
                noise = rng.gauss(0, 0.12)
                bed = slope_component + pools + noise
            self.bed.append(bed)

            crest = bed + 6.0 + 0.5 * math.sin(2 * math.pi * x / 700.0 + 0.7)
            if r.real_width_m[i] < r.mean_width * 0.55:
                crest -= 1.4
            self.crest.append(crest)

            wf = r.real_width_m[i] / r.mean_width
            self.width_factor.append(max(0.15, min(2.2, wf)))

            edge_frac = min(x, r.reach_len_m - x) / (r.reach_len_m / 2.0)
            s = 0.6 - 0.4 * edge_frac
            if r.has_real_depth and r.depth_flagged[i]:
                s = max(s, 0.5)   # real depth here was extrapolated, not measured
            self.sigma_bed.append(round(max(0.12, s), 3))

    # ------------------------- discharge truth series -------------------------

    def _build_truth_discharge(self, gauge_csv):
        self.q_truth = None
        if gauge_csv and os.path.exists(gauge_csv):
            try:
                vals = []
                with open(gauge_csv, newline="") as f:
                    for row in csv.reader(f):
                        if not row:
                            continue
                        try:
                            vals.append(float(row[-1]))
                        except ValueError:
                            continue
                if len(vals) >= PAST_HOURS + FORECAST_HOURS:
                    self.q_truth = vals[:TRUTH_HOURS]
                    while len(self.q_truth) < TRUTH_HOURS:
                        self.q_truth.append(vals[-1])
                    self.q_source = "user_csv:" + os.path.basename(gauge_csv)
            except Exception:
                self.q_truth = None
        if self.q_truth is None:
            rng = random.Random(self.seed + 2)
            base = 180.0
            pulses = []
            t = 20
            while t < TRUTH_HOURS:
                amp = rng.uniform(200, 1400)
                width = rng.uniform(6, 20)
                pulses.append((t, amp, width))
                t += int(rng.uniform(40, 110))
            q = []
            for h in range(TRUTH_HOURS):
                v = base + 30 * math.sin(2 * math.pi * h / 240.0)
                for (pt, amp, w) in pulses:
                    v += amp * math.exp(-0.5 * ((h - pt) / w) ** 2)
                v *= (1 + rng.gauss(0, 0.015))
                q.append(max(40.0, v))
            self.q_truth = q
            self.q_source = "synthetic_demo (no gauge CSV supplied)"

    # ------------------------------- assets -------------------------------

    def _build_assets(self):
        r = self.river

        def crest_at(x_m):
            return self.crest[self._cell_for_chainage(x_m)]

        self.assets = []
        if r.landmarks:
            ordered = sorted(r.landmarks, key=lambda lm: lm["chainage_m"])
            for i, lm in enumerate(ordered):
                x = lm["chainage_m"]
                cell = self._cell_for_chainage(x)
                aid = f"A{i+1}"
                self.assets.append({
                    "id": aid,
                    "name": lm["name"],
                    "locality": lm["name"],
                    "chainage_m": round(x, 1),
                    "lon": r.lon[cell], "lat": r.lat[cell],
                    "threshold": round(crest_at(x) - 0.8, 2),
                })
        else:
            picks = [
                ("A1", "Upstream reach", r.reach_len_m * 0.10),
                ("A2", "Narrow section (left bank)", r.reach_len_m * 0.30),
                ("A3", "Mid-reach crossing", r.reach_len_m * 0.50),
                ("A4", "Narrow section (right bank)", r.reach_len_m * 0.70),
                ("A5", "Downstream reach", r.reach_len_m * 0.90),
            ]
            for aid, name, x in picks:
                cell = self._cell_for_chainage(x)
                self.assets.append({
                    "id": aid, "name": name,
                    "chainage_m": round(x, 1),
                    "lon": r.lon[cell], "lat": r.lat[cell],
                    "threshold": round(crest_at(x) - 0.8, 2),
                })

    def _cell_for_chainage(self, x_m):
        r = self.river
        best = 0
        best_d = abs(r.chainage_m[0] - x_m)
        for i, c in enumerate(r.chainage_m):
            d = abs(c - x_m)
            if d < best_d:
                best, best_d = i, d
        return best

    # --------------------------- hydraulic mapping ---------------------------

    def _depth_from_q(self, q, cell):
        return DEPTH_COEF * (q ** DEPTH_EXP) / max(0.4, self.width_factor[cell])

    def wse_profile(self, q):
        r = self.river
        prof = []
        for i in range(r.n_cells):
            att = 1.0 - 0.08 * (i / r.n_cells)
            d = self._depth_from_q(q * att, i)
            prof.append(self.bed[i] + d)
        return prof

    def wse_at(self, q, cell):
        att = 1.0 - 0.08 * (cell / self.river.n_cells)
        return self.bed[cell] + self._depth_from_q(q * att, cell)

    # ------------------------------ forecasting ------------------------------

    def refresh_forecast(self):
        self.members = []
        for m in range(N_MEMBERS):
            rng = random.Random(self.seed * 1000 + self.now_idx * 7 + m)
            phase = rng.gauss(0, 2.5)
            bias = rng.gauss(0, 0.04)
            series = []
            noise = 0.0
            for k in range(1, FORECAST_HOURS + 1):
                noise += rng.gauss(0, 0.012)
                idx = self.now_idx + k + phase
                i0 = max(0, min(TRUTH_HOURS - 2, int(idx)))
                frac = min(1.0, max(0.0, idx - i0))
                q = self.q_truth[i0] * (1 - frac) + self.q_truth[i0 + 1] * frac
                series.append(max(30.0, q * (1 + bias + noise)))
            self.members.append(series)

    def q_quantiles(self, k, qs=(0.1, 0.5, 0.9)):
        vals = sorted(m[k] for m in self.members)
        out = []
        for q in qs:
            pos = q * (len(vals) - 1)
            lo = int(pos)
            hi = min(lo + 1, len(vals) - 1)
            out.append(vals[lo] + (vals[hi] - vals[lo]) * (pos - lo))
        return out

    # ------------------------------- analytics -------------------------------

    def state_now(self):
        q = self.q_truth[self.now_idx]
        return {"q_now": round(q, 1), "wse": [round(v, 3) for v in self.wse_profile(q)]}

    def observed_hydrograph(self, cell):
        out = []
        for h in range(self.now_idx - PAST_HOURS, self.now_idx + 1):
            out.append(round(self.wse_at(self.q_truth[h], cell), 3))
        return out

    def forecast_hydrograph(self, cell):
        med, p10, p90 = [], [], []
        for k in range(FORECAST_HOURS):
            q10, q50, q90 = self.q_quantiles(k)
            p10.append(round(self.wse_at(q10, cell), 3))
            med.append(round(self.wse_at(q50, cell), 3))
            p90.append(round(self.wse_at(q90, cell), 3))
        return {"median": med, "p10": p10, "p90": p90}

    def forecast_profile(self, lead_h):
        k = max(0, min(FORECAST_HOURS - 1, lead_h - 1))
        q10, q50, q90 = self.q_quantiles(k)
        return {
            "lead_h": lead_h,
            "median": [round(v, 3) for v in self.wse_profile(q50)],
            "p10": [round(v, 3) for v in self.wse_profile(q10)],
            "p90": [round(v, 3) for v in self.wse_profile(q90)],
        }

    def margins(self):
        out = []
        q_now = self.q_truth[self.now_idx]
        for a in self.assets:
            cell = self._cell_for_chainage(a["chainage_m"])
            wse_now = self.wse_at(q_now, cell)
            margin_now = a["threshold"] - wse_now
            exceed_members = 0
            tth = None
            min_margin_med = margin_now
            for k in range(FORECAST_HOURS):
                q10, q50, q90 = self.q_quantiles(k)
                m_med = a["threshold"] - self.wse_at(q50, cell)
                min_margin_med = min(min_margin_med, m_med)
                if tth is None and m_med <= 0:
                    tth = k + 1
            for m in self.members:
                if any(self.wse_at(m[k], cell) >= a["threshold"]
                       for k in range(FORECAST_HOURS)):
                    exceed_members += 1
            p = exceed_members / N_MEMBERS
            if p >= 0.6 or margin_now <= 0:
                status = "DANGER"
            elif p >= 0.3:
                status = "WARNING"
            elif p >= 0.1:
                status = "WATCH"
            else:
                status = "SAFE"
            out.append({
                "id": a["id"], "name": a["name"],
                "chainage_m": a["chainage_m"], "lon": a["lon"], "lat": a["lat"],
                "threshold": a["threshold"],
                "wse_now": round(wse_now, 2),
                "margin_now_m": round(margin_now, 2),
                "min_margin_median_m": round(min_margin_med, 2),
                "p_exceed_72h": round(p, 2),
                "time_to_threshold_h": tth,
                "status": status,
            })
        return out

    def alerts(self):
        out = []
        for m in self.margins():
            if m["status"] in ("WATCH", "WARNING", "DANGER"):
                msg = (f"{m['name']}: probability of threshold exceedance in next "
                       f"72 h is {int(m['p_exceed_72h']*100)}%.")
                if m["time_to_threshold_h"]:
                    msg += (f" Median forecast crosses threshold in "
                            f"~{m['time_to_threshold_h']} h.")
                msg += f" Current margin {m['margin_now_m']} m."
                out.append({"severity": m["status"], "asset": m["id"],
                            "message": msg})
        return out

    def scorecard(self):
        if self.now_idx - 24 < 0:
            return {"note": "insufficient history yet", "rows": []}
        saved_idx = self.now_idx
        self.now_idx = saved_idx - 24
        self.refresh_forecast()
        cell = self._cell_for_chainage(self.assets[0]["chainage_m"])
        errs = []
        hits = misses = false_alarms = 0
        thr = self.assets[0]["threshold"]
        for k in range(24):
            q10, q50, q90 = self.q_quantiles(k)
            pred = self.wse_at(q50, cell)
            truth = self.wse_at(self.q_truth[self.now_idx + 1 + k], cell)
            errs.append((pred - truth) ** 2)
            pe = pred >= thr
            te = truth >= thr
            if pe and te:
                hits += 1
            elif te and not pe:
                misses += 1
            elif pe and not te:
                false_alarms += 1
        rmse = math.sqrt(sum(errs) / len(errs))
        self.now_idx = saved_idx
        self.refresh_forecast()
        return {
            "note": "",
            "rows": [
                {"metric": f"WSE 24 h forecast RMSE at {self.assets[0]['name']}",
                 "value": f"{rmse:.2f} m"},
                {"metric": "Threshold-exceedance hits (24 h)", "value": str(hits)},
                {"metric": "Misses", "value": str(misses)},
                {"metric": "False alarms", "value": str(false_alarms)},
                {"metric": "Ensemble size", "value": str(N_MEMBERS)},
                {"metric": "Data source", "value": self.q_source},
            ],
        }

    def meta(self):
        r = self.river
        return {
            "product": r.product_label,
            "river": r.display_name,
            "disclaimer": (
                "REAL layers: centerline/chainage/width from the KML polygon"
                + (", local bed relief (relative depth variation) from a real bathymetry survey grid"
                   if r.has_real_depth else "")
                + ". STILL SYNTHETIC: absolute elevation datum and downstream "
                  "slope (no DEM supplied), embankment crest (no structural "
                  "survey)"
                + ("" if r.has_real_depth else ", and bed elevation itself (no depth survey supplied for this river)")
                + ", and discharge / river stage / hydrograph / forecasts / "
                  "margins / alerts (no gauge or sensor feed supplied — plug "
                  "one in via `--gauge your_file.csv`). Do not use for any "
                  "real decision until the DEM and gauge layers are supplied."
            ),
            "has_real_depth": r.has_real_depth,
            "reach_km": round(r.reach_len_m / 1000.0, 3),
            "n_cells": r.n_cells,
            "past_hours": PAST_HOURS,
            "forecast_hours": FORECAST_HOURS,
            "members": N_MEMBERS,
            "sim_hour": self.now_idx - PAST_HOURS,
            "q_source": self.q_source,
            "assets": self.assets,
            "chainage_km": [round(v / 1000.0, 4) for v in r.chainage_m],
            "lon": r.lon,
            "lat": r.lat,
            "real_width_m": r.real_width_m,
            "real_depth_m": r.real_depth_m,
            "depth_flagged": r.depth_flagged,
            "reach_polygon_lonlat": r.reach_polygon_lonlat,
            "landmarks": r.landmarks,
            "bed": [round(v, 3) for v in self.bed],
            "crest": [round(v, 3) for v in self.crest],
            "sigma_bed": self.sigma_bed,
        }

    def advance(self, hours=6):
        hours = int(hours)
        hours = max(-24, min(24, hours))
        if hours == 0:
            hours = 1
        self.now_idx = max(
            PAST_HOURS,
            min(TRUTH_HOURS - FORECAST_HOURS - 2, self.now_idx + hours)
        )
        self.refresh_forecast()
        return {"sim_hour": self.now_idx - PAST_HOURS}
