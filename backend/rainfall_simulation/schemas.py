from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class RainfallStartRequest(BaseModel):
    depth_mm: float = Field(..., ge=0, le=100, alias="depthMm")
    duration_hours: float = Field(..., ge=1, le=24, alias="durationHours")
    distribution: Literal["uniform"] = "uniform"
    baseflow_m3s: Optional[float] = Field(None, alias="baseflowM3s")
    dt_hours: Optional[float] = Field(0.25, alias="dtHours")
    recession_hours: Optional[float] = Field(None, alias="recessionHours")

    model_config = {"populate_by_name": True}


class RainfallUpdateRequest(BaseModel):
    simulation_id: Optional[str] = None
    depth_mm: Optional[float] = Field(None, ge=0, le=100, alias="depthMm")
    duration_hours: Optional[float] = Field(None, ge=1, le=24, alias="durationHours")
    baseflow_m3s: Optional[float] = Field(None, alias="baseflowM3s")

    model_config = {"populate_by_name": True}


class RainfallSample(BaseModel):
    tHours: float
    rainMmHr: float
    excessMmHr: float
    Q_m3s: float
    deltaStageM: float
    stageM: float
    velocityMs: float
    wettedAreaM2: Optional[float] = None
    volumeM3: Optional[float] = None


class RainfallStatusResponse(BaseModel):
    simulation_id: str
    status: str
    vertical_datum: str
    input: dict[str, Any]
    elapsed_hours: float
    total_hours: float
    current: Optional[RainfallSample]
    peak: Optional[RainfallSample]
    meta: dict[str, Any]
    series: list[RainfallSample]
    updated_at: float
