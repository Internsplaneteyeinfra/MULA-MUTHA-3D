from __future__ import annotations

import time
import uuid
from typing import Any

from .engine import LAG_TIME_HOURS, VERTICAL_DATUM, build_rainfall_response_series, sample_at_time

READY, RUNNING, PAUSED, COMPLETED = "READY", "RUNNING", "PAUSED", "COMPLETED"
REAL_MINUTES_FOR_STORM_AT_1X = 5.0

_sessions: dict[str, dict[str, Any]] = {}


class NotFound(Exception):
    pass


def _base_hours_per_sec(duration_hours: float) -> float:
    return max(1.0, float(duration_hours)) / (REAL_MINUTES_FOR_STORM_AT_1X * 60.0)


def _apply_speed(s: dict[str, Any], multiplier: float) -> None:
    mult = max(0.1, min(120.0, float(multiplier or 1)))
    s["playbackMultiplier"] = mult
    s["playbackSpeedHoursPerSec"] = _base_hours_per_sec(s["input"]["durationHours"]) * mult


def _derive_phase(s: dict[str, Any], current: dict[str, Any] | None) -> str:
    status = s["status"]
    if status == COMPLETED:
        return "COMPLETED"
    if status == READY:
        return "READY"
    if status == PAUSED:
        return "PAUSED"
    t = float(s["tHours"])
    storm_end = float(s["input"]["durationHours"])
    peak_t = float(s["meta"]["totals"].get("timeToPeakHours", storm_end + LAG_TIME_HOURS))
    lag = float(s["meta"]["assumptions"].get("lagHours", LAG_TIME_HOURS))
    raining = bool(current and current.get("rainMmHr", 0) > 0 and t < storm_end - 1e-9)
    if raining or t < storm_end - 1e-9:
        return "RAINING"
    if t < storm_end + 0.2:
        return "RAINFALL STOPPED"
    if t < peak_t:
        if t < storm_end + lag:
            return "RUNOFF ROUTING"
        return "RIVER RISING"
    return "RIVER RECESSION"


def start_simulation(raw: dict[str, Any]) -> dict[str, Any]:
    built = build_rainfall_response_series(raw)
    sid = f"rain-{uuid.uuid4().hex[:12]}"
    session = {
        "id": sid,
        "status": RUNNING,
        "input": built["input"],
        "meta": built["meta"],
        "samples": built["samples"],
        "peak": built["peak"],
        "tHours": 0.0,
        "playbackMultiplier": built["input"].get("playbackSpeed", 1.0),
        "playbackSpeedHoursPerSec": 0.0,
        "lastTickWall": time.time(),
        "updatedAt": time.time(),
        "verticalDatum": VERTICAL_DATUM,
    }
    _apply_speed(session, session["playbackMultiplier"])
    _sessions[sid] = session
    return snapshot(session)


def update_simulation(sid: str, patch: dict[str, Any]) -> dict[str, Any]:
    s = _require(sid)
    merged = {**s["input"], **{k: v for k, v in patch.items() if v is not None}}
    built = build_rainfall_response_series(merged)
    s["input"] = built["input"]
    s["meta"] = built["meta"]
    s["samples"] = built["samples"]
    s["peak"] = built["peak"]
    end_t = built["samples"][-1]["tHours"]
    s["tHours"] = min(s["tHours"], end_t)
    speed = patch.get("playbackSpeed", patch.get("playback_speed", s["playbackMultiplier"]))
    _apply_speed(s, speed)
    s["updatedAt"] = time.time()
    if s["status"] == COMPLETED:
        s["status"] = RUNNING
    s["lastTickWall"] = time.time()
    return snapshot(s)


def set_playback_speed(sid: str, multiplier: float) -> dict[str, Any]:
    s = _require(sid)
    _advance(s)
    _apply_speed(s, multiplier)
    s["input"]["playbackSpeed"] = s["playbackMultiplier"]
    s["updatedAt"] = time.time()
    return snapshot(s)


def get_status(sid: str) -> dict[str, Any]:
    return snapshot(_require(sid))


def pause_simulation(sid: str) -> dict[str, Any]:
    s = _require(sid)
    _advance(s)
    if s["status"] == RUNNING:
        s["status"] = PAUSED
        s["updatedAt"] = time.time()
    return snapshot(s)


def resume_simulation(sid: str) -> dict[str, Any]:
    s = _require(sid)
    if s["status"] == PAUSED:
        s["status"] = RUNNING
        s["lastTickWall"] = time.time()
        s["updatedAt"] = time.time()
    return snapshot(s)


def reset_simulation(sid: str) -> dict[str, Any]:
    s = _require(sid)
    s["tHours"] = 0.0
    s["status"] = READY
    s["lastTickWall"] = time.time()
    s["updatedAt"] = time.time()
    return snapshot(s)


def _require(sid: str) -> dict[str, Any]:
    s = _sessions.get(sid)
    if not s:
        raise NotFound(sid)
    return s


def _advance(s: dict[str, Any]) -> None:
    if s["status"] != RUNNING:
        return
    now = time.time()
    dt = max(0.0, now - s["lastTickWall"])
    s["lastTickWall"] = now
    end = s["samples"][-1]["tHours"]
    s["tHours"] = min(end, s["tHours"] + dt * s["playbackSpeedHoursPerSec"])
    s["updatedAt"] = now
    if s["tHours"] >= end - 1e-6:
        s["tHours"] = end
        s["status"] = COMPLETED


def snapshot(s: dict[str, Any]) -> dict[str, Any]:
    _advance(s)
    current = sample_at_time(s["samples"], s["tHours"])
    phase = _derive_phase(s, current)
    return {
        "simulation_id": s["id"],
        "status": s["status"],
        "phase": phase,
        "vertical_datum": s["verticalDatum"],
        "input": {
            "depth_mm": s["input"]["depthMm"],
            "duration_hours": s["input"]["durationHours"],
            "intensity_mm_hr": s["meta"]["input"]["intensityMmHr"],
            "distribution": s["input"]["distribution"],
            "recession_hours": s["input"]["recessionHours"],
        },
        "elapsed_hours": round(s["tHours"], 3),
        "storm_end_hours": s["input"]["durationHours"],
        "total_hours": s["samples"][-1]["tHours"],
        "rainfall_completed_mm": round(current.get("cumRainMm", 0.0), 4),
        "effective_rainfall_mm": round(current.get("cumExcessMm", 0.0), 4),
        "playback": {
            "multiplier": s["playbackMultiplier"],
            "hours_per_sec": round(s["playbackSpeedHoursPerSec"], 6),
            "base_hours_per_sec": round(_base_hours_per_sec(s["input"]["durationHours"]), 6),
        },
        "current": current,
        "peak": s["peak"],
        "meta": s["meta"],
        "series": s["samples"],
        "updated_at": s["updatedAt"],
    }
