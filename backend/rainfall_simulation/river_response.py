"""Stage / velocity / wetted-area response from routed discharge."""

from .engine import build_rainfall_response_series


def river_response_series(depth_mm: float, duration_hours: float):
    return build_rainfall_response_series(
        {"depthMm": depth_mm, "durationHours": duration_hours}
    )
