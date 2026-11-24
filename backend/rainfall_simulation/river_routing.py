"""Unit-hydrograph routing of excess rainfall to channel inflow."""

from .engine import build_rainfall_response_series


def runoff_hydrograph(depth_mm: float, duration_hours: float):
    series = build_rainfall_response_series(
        {"depthMm": depth_mm, "durationHours": duration_hours}
    )
    return [
        {"tHours": s["tHours"], "Q_m3s": s["Q_m3s"]}
        for s in series["samples"]
    ]
