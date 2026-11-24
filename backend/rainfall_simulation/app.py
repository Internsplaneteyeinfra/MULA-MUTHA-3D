"""
Optional FastAPI entrypoint for Rainfall Simulation.

  cd MULA-MUTHA-3D
  pip install fastapi uvicorn pydantic
  uvicorn backend.rainfall_simulation.app:app --reload --port 8091

Vite can proxy /api/rainfall-simulation → this service. The twin also runs
the same model in-browser via src/services/rainfallSimulation (default).
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .router import router

app = FastAPI(
    title="PLANET.EYE AI — Rainfall Simulation",
    description="Event rainfall → river response (not flood inundation).",
    version="1.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)


@app.get("/health")
def health():
    return {"ok": True, "service": "rainfall-simulation"}
