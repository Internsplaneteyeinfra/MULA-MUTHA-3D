"""SCS-CN excess rainfall (ASSUMED CN / C)."""

from .engine import CURVE_NUMBER, RUNOFF_COEFFICIENT, build_rainfall_response_series


def effective_rainfall_mm(depth_mm: float, duration_hours: float = 2.0) -> float:
    series = build_rainfall_response_series(
        {"depthMm": depth_mm, "durationHours": duration_hours}
    )
    return float(series["meta"]["totals"]["effectiveRainfallMm"])


__all__ = ["effective_rainfall_mm", "CURVE_NUMBER", "RUNOFF_COEFFICIENT"]
