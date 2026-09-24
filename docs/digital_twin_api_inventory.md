# Digital Twin API Inventory — Mula–Mutha RIVEREYE

Generated: 2026-09-23  
Project: `MULA-MUTHA-3D`  
Reference dashboard: `https://digitaltwinmulamutha-git-main-solar-khardas-projects-d66675a5.vercel.app/`

---

## Reference Application Inspection Result

**Status: ALL ENDPOINTS UNAVAILABLE — VERCEL DEPLOYMENT PROTECTION**

Every HTTP request to the reference Vercel deployment (including `/api/*`, `/data/*`, and all Next.js chunk URLs) returned HTTP 200 with the body:

```
Protected Deployment – Vercel
```

This is a Vercel deployment-protection gate that requires a valid Vercel session cookie. No API endpoints, data files, or JS bundles were accessible without authentication.

**Conclusion:** The reference dashboard's data sources, endpoint paths, response schemas, and authentication requirements could **not** be determined from the publicly accessible deployment. No endpoints were fabricated.

---

## Local Data Sources (Used in Implementation)

### 1. ForecastEngine (forecastService.js)

| Property | Value |
|---|---|
| Source | `public/data/naditwin/chainage_profile.json` + `depth_profile.json` |
| Method | Loaded at runtime via `fetch()` |
| Data type | 50-member stochastic ensemble, 72h forecast |
| Provenance | **SIMULATED** — synthetic stochastic truth signal, no live gauge |
| Stations | 1,698 |
| Reach | 16.962 km |

**Available methods:**
- `currentHydraulic(meters?)` → WSE profile, discharge, bed elevations
- `wseProfile(Q)` → WSE at each chainage cell
- `qQuantiles(k, qs)` → P10/P50/P90 at forecast step k
- `forecastProfile(leadH)` → downsampled forecast profile
- `cellForChainage(meters)` → nearest cell index
- `dischargeAtChainage(meters)` → local Q with attenuation

### 2. Digital Twin Service (digitalTwinService.js)

| Property | Value |
|---|---|
| Source | `public/data/naditwin/landmarks.json` + ForecastEngine |
| Method | Loaded at runtime |
| Data type | 8 named assets with WSE, threshold, margin, risk |
| Provenance | **MODELLED** WSE, **ASSUMED** thresholds |

**Assets in landmarks.json:**
| Name | Chainage (m) | Lat | Lon |
|---|---|---|---|
| Sangam | 621.9 | 18.5312 | 73.8602 |
| Bund Garden | 3,451.9 | 18.5430 | 73.8831 |
| Dhanori | 5,901.9 | 18.5412 | 73.9060 |
| Wadgaon Sheri | 7,531.9 | 18.5390 | 73.9212 |
| Hadapsar | 9,131.9 | 18.5357 | 73.9359 |
| Mundhwa | 9,561.9 | 18.5366 | 73.9398 |
| Kharadi | 10,751.9 | 18.5453 | 73.9460 |
| Manjari | 15,521.9 | 18.5286 | 73.9824 |

### 3. Historical Hydrology Service (historicalHydrologyService.js)

| Property | Value |
|---|---|
| Source | Hardcoded verified events (bulletin-reported estimates) |
| Provenance | **MODELLED** / **ASSUMED** depending on event |

**Events:**
| ID | Name | Date | Q (m³/s) | Provenance |
|---|---|---|---|---|
| `jul_2023_monsoon_peak` | July 2023 Monsoon Release | 2023-07-26 | 585.0 | MODELLED |
| `aug_2024_khadakwasla_spill` | August 2024 High Discharge | 2024-08-04 | 980.0 | MODELLED |
| `mar_2024_summer_baseflow` | March 2024 Baseflow | 2024-03-15 | 35.0 | ASSUMED |

### 4. Hydrology Telemetry Service (hydrologyTelemetryService.js)

| Property | Value |
|---|---|
| Source | External gauge endpoints (configurable via `window.__RIVEREYE_TELEMETRY_ENDPOINT__`) |
| Status | **UNAVAILABLE** — endpoints not configured |

**Gauge stations defined (all UNAVAILABLE):**
| ID | Name | CWC ID | Chainage (m) |
|---|---|---|---|
| `cwc_bund_garden` | Bund Garden (CWC/MWRD) | 028-MDH-PUNE | 3,451.9 |
| `mwrd_sangam` | Sangam Bridge Gauge | — | 621.9 |
| `khadakwasla_outflow` | Khadakwasla Reservoir | — | 0.0 |

**To connect live telemetry:** Set `window.__RIVEREYE_TELEMETRY_ENDPOINT__ = "https://your-gauge-api/observations"` before application load. The service will fetch `?station=<stationId>` and expects JSON: `{ discharge_m3s, stage_m_msl, timestamp, source, isLive, quality }`.

### 5. Hydrology Store (hydrologyStore.js)

| Property | Value |
|---|---|
| Source | HydraulicProfileEngine (1D Manning solver) |
| Provenance | **MODELLED** — n=0.035 assumed, datum unverified |
| Records | 1,698 stations |

---

## digitalTwinApi.js — Exposed Methods

| Method | Data Source | Provenance |
|---|---|---|
| `getCurrentHydrology()` | ForecastEngine | SIMULATED |
| `getStationState(chainage_m)` | ForecastEngine | MODELLED+SIMULATED |
| `getDischargeSeries(chainage_m?)` | ForecastEngine qTruth + ensemble | SIMULATED |
| `getRiverStageSeries(leadH?)` | ForecastEngine wseProfile | MODELLED+SIMULATED |
| `getHydrograph(chainage_m)` | ForecastEngine historical Q + ensemble | SIMULATED |
| `getEnsembleForecast(chainage_m)` | ForecastEngine 50-member ensemble | SIMULATED |
| `getAlerts()` | digitalTwinService assets + exceedance calc | SIMULATED |
| `getMarginBoard()` | digitalTwinService assets | MODELLED+ASSUMED |
| `getHistoricalEvents()` | historicalHydrologyService | MODELLED/ASSUMED |
| `getGaugeObservations()` | hydrologyTelemetryService | UNAVAILABLE |

---

## Reference Dashboard Feature → Local Implementation Mapping

| Reference Feature | Local Implementation | Status |
|---|---|---|
| Simulation / time controls | LIVE/HISTORIC mode toggles + historical event selector | ✅ Implemented (3 events) |
| Upstream discharge card | `getCurrentHydrology().discharge_m3s` | ✅ SIMULATED |
| Reach summary | `getCurrentHydrology().reach_km` + `station_count` | ✅ Dynamic from chainage_profile.json |
| Ensemble summary | N members × H hours display | ✅ 50 members · 72h |
| Station/bridge selector | Landmarks dropdown (8 named assets) | ✅ Implemented |
| Discharge — Today | `getDischargeSeries()` → 24h obs + P10/P50/P90 | ✅ SIMULATED |
| River Stage profile | `getRiverStageSeries()` → full longitudinal WSE | ✅ MODELLED+SIMULATED |
| Hydrograph at station | `getHydrograph()` → 72h past + 72h forecast | ✅ SIMULATED |
| Threshold graph | `getStationState()` → bar chart + margin | ✅ ASSUMED threshold |
| Forecast ensemble | `getEnsembleForecast()` → P10/P50/P90 | ✅ 50-member SIMULATED |
| Active Alerts | `getAlerts()` → per-asset exceedance | ✅ SIMULATED |
| Margin Board | `getMarginBoard()` → all 8 assets sorted | ✅ MODELLED+ASSUMED |
| Asset risk | per-asset risk 0–100 | ✅ DERIVED |

---

## Known Limitations / Cannot Implement (Data Unavailable)

1. **Live CWC/MWRD gauge observations** — Bund Garden, Sangam, Khadakwasla gauge readings are UNAVAILABLE. The telemetry service is wired but all endpoints return `ENDPOINT_UNCONFIGURED`.

2. **Reference API response schemas** — The Vercel deployment protection prevented inspection of any actual API endpoints, JSON structures, or authentication mechanisms from the reference dashboard.

3. **Verified WSE/stage values** — All WSE and stage values are **MODELLED/SIMULATED** from the ForecastEngine. No actual observed river stage is available.

4. **Embankment crest elevations** — Not present in any local data file. The River Stage graph therefore omits the "Embankment crest" series (shown as unavailable, not fabricated).

5. **Historical observed time series** — Only 3 scalar historical events are stored. No continuous historical discharge/stage time series exists locally.

6. **Absolute MSL elevations** — Vertical datum is UNVERIFIED. All WSE values are relative (datum = 0.0 m) not absolute MSL.

---

## Data Provenance Summary

| Source | Provenance tag | Notes |
|---|---|---|
| ForecastEngine WSE profiles | MODELLED | 1D Manning hydraulic geometry |
| ForecastEngine ensemble | SIMULATED | Stochastic synthetic truth, 50 members |
| Flood thresholds | ASSUMED | CLASS_DEFAULT (bridge 2.5m, landmark 1.8m, default 2.0m) |
| Manning roughness n | ASSUMED | n=0.035 calibration pending |
| Vertical datum | UNVERIFIED | EGM96 not verified at any gauge |
| CWC gauge readings | UNAVAILABLE | Endpoint not configured |
| MWRD telemetry | UNAVAILABLE | Endpoint not configured |
| Cross-section geometry | MODELLED / PARAMETRIC | Cross-section registry fallback |
