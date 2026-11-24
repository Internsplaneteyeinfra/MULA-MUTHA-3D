from __future__ import annotations

from fastapi import APIRouter, HTTPException

from . import simulation_manager as mgr
from .schemas import RainfallStartRequest, RainfallUpdateRequest

router = APIRouter(prefix="/api/rainfall-simulation", tags=["rainfall-simulation"])


@router.post("/start")
def start(body: RainfallStartRequest):
    return mgr.start_simulation(body.model_dump(by_alias=True))


@router.post("/update")
def update(body: RainfallUpdateRequest):
    sid = body.simulation_id
    if not sid:
        raise HTTPException(400, "simulation_id required")
    try:
        return mgr.update_simulation(
            sid,
            {
                "depthMm": body.depth_mm,
                "durationHours": body.duration_hours,
                "baseflowM3s": body.baseflow_m3s,
            },
        )
    except mgr.NotFound:
        raise HTTPException(404, f"simulation not found: {sid}") from None


@router.get("/{simulation_id}/status")
def status(simulation_id: str):
    try:
        return mgr.get_status(simulation_id)
    except mgr.NotFound:
        raise HTTPException(404, f"simulation not found: {simulation_id}") from None


@router.post("/{simulation_id}/pause")
def pause(simulation_id: str):
    try:
        return mgr.pause_simulation(simulation_id)
    except mgr.NotFound:
        raise HTTPException(404, f"simulation not found: {simulation_id}") from None


@router.post("/{simulation_id}/resume")
def resume(simulation_id: str):
    try:
        return mgr.resume_simulation(simulation_id)
    except mgr.NotFound:
        raise HTTPException(404, f"simulation not found: {simulation_id}") from None


@router.post("/{simulation_id}/reset")
def reset(simulation_id: str):
    try:
        return mgr.reset_simulation(simulation_id)
    except mgr.NotFound:
        raise HTTPException(404, f"simulation not found: {simulation_id}") from None


@router.post("/{simulation_id}/speed")
def speed(simulation_id: str, body: dict):
    try:
        mult = body.get("playbackSpeed", body.get("playback_speed", 1))
        return mgr.set_playback_speed(simulation_id, float(mult))
    except mgr.NotFound:
        raise HTTPException(404, f"simulation not found: {simulation_id}") from None
    except (TypeError, ValueError) as err:
        raise HTTPException(400, f"invalid playback speed: {err}") from err
