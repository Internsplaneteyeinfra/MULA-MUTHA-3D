"""Rainfall hyetograph helpers (uniform distribution)."""

from .engine import normalize_input


def uniform_intensity_mm_hr(depth_mm: float, duration_hours: float) -> float:
    if duration_hours <= 0:
        return 0.0
    return depth_mm / duration_hours


def build_uniform_hyetograph(depth_mm: float, duration_hours: float, dt_hours: float = 0.25):
    cfg = normalize_input(
        {"depthMm": depth_mm, "durationHours": duration_hours, "dtHours": dt_hours}
    )
    i = uniform_intensity_mm_hr(cfg["depthMm"], cfg["durationHours"])
    n = int(cfg["durationHours"] / cfg["dtHours"]) + 1
    return [{"tHours": round(k * cfg["dtHours"], 3), "rainMmHr": i} for k in range(n)]
