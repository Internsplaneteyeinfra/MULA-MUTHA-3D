"""SCS-CN + triangular UH → Manning stage (ASSUMED parameters). Mirrors JS engine."""
from __future__ import annotations

import math
from datetime import datetime
from typing import Any

# ASSUMED twin-corridor contributing area (not full upper basin).
CATCHMENT_AREA_KM2 = 150.0
RUNOFF_COEFFICIENT = 0.45
CURVE_NUMBER = 70.0
LAG_TIME_HOURS = 2.0
BASEFLOW_DRY = 15.0
BASEFLOW_MONSOON = 35.0
MANNING_N = 0.035
BED_SLOPE = 0.0008
REF_WIDTH_M = 55.0
BASELINE_DEPTH_M = 1.72
VERTICAL_DATUM = "scene relative · hydraulic depth vs baseline 1.72 m"


def _clamp(n: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, n))


def _default_baseflow() -> float:
    m = datetime.now().month
    return BASEFLOW_MONSOON if 6 <= m <= 10 else BASEFLOW_DRY


def normalize_input(raw: dict[str, Any]) -> dict[str, Any]:
    depth = _clamp(float(raw.get("depthMm", raw.get("depth_mm", 0)) or 0), 0, 100)
    duration = _clamp(float(raw.get("durationHours", raw.get("duration_hours", 1)) or 1), 1, 24)
    bf = raw.get("baseflowM3s", raw.get("baseflow_m3s"))
    baseflow = float(bf) if bf is not None and math.isfinite(float(bf)) else None
    dt = _clamp(float(raw.get("dtHours", raw.get("dt_hours", 0.25)) or 0.25), 0.1, 1)
    rec = raw.get("recessionHours", raw.get("recession_hours"))
    # None → JS/Python engine chooses UH-based post-rain horizon (not a fixed 8–10 h).
    recession = _clamp(float(rec), 1, 48) if rec is not None else None
    speed = _clamp(float(raw.get("playbackSpeed", raw.get("playback_speed", 1)) or 1), 0.1, 120)
    return {
        "depthMm": depth,
        "durationHours": duration,
        "distribution": "uniform",
        "baseflowM3s": baseflow,
        "dtHours": dt,
        "recessionHours": recession,
        "playbackSpeed": speed,
    }


def _storage_mm(cn: float) -> float:
    return 25400.0 / max(1.0, cn) - 254.0


def _scs_excess(P: float, Ia: float, S: float) -> float:
    if P <= Ia:
        return 0.0
    return ((P - Ia) ** 2) / (P - Ia + S)


def _manning_depth(Q: float) -> float:
    q = max(0.05, float(Q))
    h = 1.0
    for _ in range(12):
        w = REF_WIDTH_M
        A = w * h
        P = w + 2 * h
        R = A / max(P, 1e-3)
        Qcalc = (1.0 / MANNING_N) * A * (R ** (2.0 / 3.0)) * math.sqrt(BED_SLOPE)
        err = Qcalc - q
        dQdh = (1.0 / MANNING_N) * math.sqrt(BED_SLOPE) * (
            (R ** (2.0 / 3.0)) * w
            + A * (2.0 / 3.0) * (R ** (-1.0 / 3.0)) * ((w * P - A * 2) / (P * P))
        )
        h = max(0.15, h - err / max(dQdh, 1e-3))
    return h


def _triangular_uh(dt: float) -> list[float]:
    Tp = dt / 2.0 + LAG_TIME_HOURS
    Tb = 2.67 * Tp
    qp = (0.208 * CATCHMENT_AREA_KM2) / max(0.25, Tp)
    n = max(3, int(math.ceil(Tb / dt)) + 1)
    u = [0.0] * n
    for i in range(n):
        t = i * dt
        if t <= Tp:
            u[i] = qp * (t / Tp)
        elif t <= Tb:
            u[i] = qp * (Tb - t) / (Tb - Tp)
    return u


def _convolve(excess: list[float], uh: list[float]) -> list[float]:
    out = [0.0] * len(excess)
    for i, pe in enumerate(excess):
        if pe <= 0:
            continue
        for j, uj in enumerate(uh):
            k = i + j
            if k >= len(out):
                break
            out[k] += pe * uj
    return out


def build_rainfall_response_series(raw: dict[str, Any]) -> dict[str, Any]:
    cfg = normalize_input(raw)
    intensity = cfg["depthMm"] / cfg["durationHours"] if cfg["durationHours"] > 0 else 0.0
    baseflow = cfg["baseflowM3s"] if cfg["baseflowM3s"] is not None else _default_baseflow()
    S = _storage_mm(CURVE_NUMBER)
    Ia = 0.2 * S
    dt = cfg["dtHours"]
    storm_end = cfg["durationHours"]
    uh_probe = _triangular_uh(dt)
    uh_base = (len(uh_probe) - 1) * dt
    Tp = dt / 2.0 + LAG_TIME_HOURS
    auto_post = min(36.0 - storm_end, max(uh_base + LAG_TIME_HOURS * 0.25, Tp * 2.67))
    post_cap = (
        min(float(cfg["recessionHours"]), 36.0 - storm_end)
        if cfg["recessionHours"] is not None
        else max(1.0, auto_post)
    )
    sim_end = min(36.0, storm_end + max(0.5, post_cap))
    n_steps = max(2, int(math.ceil(sim_end / dt)) + 1)

    excess_mm: list[float] = []
    cum_p = 0.0
    cum_pe = 0.0
    for i in range(n_steps):
        t0 = i * dt
        raining = t0 < storm_end - 1e-9
        p_pulse = intensity * dt if raining else 0.0
        cum_p += p_pulse
        pe_cum = _scs_excess(cum_p, Ia, S)
        pe_pulse = max(0.0, pe_cum - cum_pe)
        cum_pe = pe_cum
        excess_mm.append(pe_pulse)

    pe_target = RUNOFF_COEFFICIENT * cfg["depthMm"]
    pe_sum = sum(excess_mm)
    if pe_target > 1e-6:
        if pe_sum > 1e-6:
            scale = pe_target / pe_sum
            excess_mm = [x * scale for x in excess_mm]
        else:
            storm_pulses = max(1, int(math.ceil(storm_end / dt)))
            per = pe_target / storm_pulses
            excess_mm = [
                per if (i * dt) < storm_end - 1e-9 else 0.0 for i in range(n_steps)
            ]

    uh = _triangular_uh(dt)
    q_direct = _convolve(excess_mm, uh)
    h0 = _manning_depth(baseflow)

    samples = []
    peak_q = baseflow
    peak_idx = 0
    cum_rain = 0.0
    cum_excess = 0.0
    for i in range(n_steps):
        t = i * dt
        raining = t < storm_end - 1e-9
        rain_pulse = intensity * dt if raining else 0.0
        cum_rain += rain_pulse
        cum_excess += excess_mm[i]
        Q = baseflow + max(0.0, q_direct[i] if i < len(q_direct) else 0.0)
        h = _manning_depth(Q)
        d_stage = h - h0
        A = REF_WIDTH_M * max(0.15, h)
        V = Q / max(A, 1e-3)
        vol = A * 16800.0
        samples.append(
            {
                "tHours": round(t, 3),
                "rainMmHr": round(intensity, 4) if raining else 0.0,
                "excessMmHr": round((excess_mm[i] / dt), 4),
                "cumRainMm": round(min(cum_rain, cfg["depthMm"]), 4),
                "cumExcessMm": round(cum_excess, 4),
                "Q_m3s": round(Q, 3),
                "deltaStageM": round(d_stage, 4),
                "stageM": round(BASELINE_DEPTH_M + d_stage, 4),
                "velocityMs": round(V, 3),
                "wettedAreaM2": round(A, 2),
                "volumeM3": round(vol, 0),
            }
        )
        if Q > peak_q:
            peak_q = Q
            peak_idx = i

    total_excess = sum(excess_mm)
    return {
        "meta": {
            "model": "SCS-CN excess + triangular UH → Manning stage (ASSUMED parameters)",
            "assumptions": {
                "catchmentAreaKm2": CATCHMENT_AREA_KM2,
                "runoffCoefficient": RUNOFF_COEFFICIENT,
                "curveNumber": CURVE_NUMBER,
                "lagHours": LAG_TIME_HOURS,
                "manningN": MANNING_N,
                "bedSlope": BED_SLOPE,
                "distribution": "uniform",
                "verticalDatum": VERTICAL_DATUM,
                "baselineDepthM": BASELINE_DEPTH_M,
            },
            "input": {
                "depthMm": cfg["depthMm"],
                "durationHours": cfg["durationHours"],
                "intensityMmHr": round(intensity, 4),
                "baseflowM3s": round(baseflow, 3),
                "dtHours": dt,
                "recessionHours": cfg["recessionHours"],
            },
            "totals": {
                "rainfallMm": cfg["depthMm"],
                "effectiveRainfallMm": round(total_excess, 3),
                "peakQm3s": round(peak_q, 3),
                "peakDeltaStageM": samples[peak_idx]["deltaStageM"],
                "timeToPeakHours": samples[peak_idx]["tHours"],
            },
        },
        "samples": samples,
        "peak": samples[peak_idx],
        "input": cfg,
    }


def sample_at_time(samples: list[dict], t: float) -> dict:
    """Latest model timestep at or before t — no invented intermediate values."""
    if not samples:
        return {}
    if t <= samples[0]["tHours"]:
        return dict(samples[0])
    if t >= samples[-1]["tHours"]:
        return dict(samples[-1])
    chosen = samples[0]
    for s in samples:
        if s["tHours"] <= t:
            chosen = s
        else:
            break
    return dict(chosen)
