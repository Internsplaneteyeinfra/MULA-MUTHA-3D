/**
 * Live Hydrology Service — Mula–Mutha River
 * ──────────────────────────────────────────────────────────────────────
 * Data source: Open-Meteo (https://open-meteo.com) — FREE, no API key.
 * Fetched every 15 minutes.
 *
 * Method: Rainfall-Runoff (Rational Method) + Khadakwasla Baseflow
 *   Q_total = Q_baseflow + Q_runoff
 *   Q_runoff = C × i × A / 3.6       [m³/s]
 *
 * Where:
 *   C  = runoff coefficient  = 0.45 (monsoon urban-rural mix, ASSUMED)
 *   i  = rainfall intensity   mm/hr (from Open-Meteo current precipitation)
 *   A  = catchment area       2,000 km² (Mula-Mutha, published value)
 *   Lag = 2h concentration time (ASSUMED, typical for this catchment size)
 *
 * Baseflow (permanent water from Khadakwasla dam):
 *   Dry season  : 15 m³/s  (minimum dam release)
 *   Monsoon min : 35 m³/s  (typical monsoon background)
 *
 * IMPORTANT PROVENANCE:
 *   - Rainfall source : OBSERVED (Open-Meteo real-time measurement)
 *   - Discharge       : MODELLED (rainfall-runoff estimation)
 *   - Baseflow        : ASSUMED  (no live dam telemetry)
 *   - Manning n       : ASSUMED  = 0.035
 *   - Datum           : RELATIVE (unverified MSL)
 *
 * This is NOT a field-calibrated hydraulic model.
 * It is a DATA-DRIVEN ESTIMATION using real rainfall data.
 */

const OPEN_METEO_URL =
  "https://api.open-meteo.com/v1/forecast" +
  "?latitude=18.5204&longitude=73.8567" +
  "&current=precipitation,rain,showers,weather_code" +
  "&hourly=precipitation" +
  "&past_hours=3" +
  "&forecast_hours=6" +
  "&timezone=Asia%2FKolkata";

// ── Catchment Parameters (Mula-Mutha, published / ASSUMED) ──────────────
const CATCHMENT_AREA_KM2  = 2000;   // km² — published figure
const RUNOFF_COEFF        = 0.45;   // C  — ASSUMED (monsoon urban-rural mix)
const LAG_TIME_HOURS      = 2.0;    // hours — ASSUMED concentration time
const KHADAKWASLA_DRY_Q   = 15;     // m³/s — dry season minimum (ASSUMED)
const KHADAKWASLA_MON_Q   = 35;     // m³/s — monsoon minimum background (ASSUMED)
const MONSOON_MONTHS      = [6, 7, 8, 9, 10]; // June–October

// ── State ────────────────────────────────────────────────────────────────
let _lastFetch    = null;
let _cachedResult = null;
let _listeners    = new Set();
let _fetchTimer   = null;
const FETCH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

// ── Rolling hourly rainfall buffer (for lag calculation) ─────────────────
const _rainfallBuffer = [];  // { time: Date, mm_per_hr: number }[]

function _isMonsoon() {
  return MONSOON_MONTHS.includes(new Date().getMonth() + 1);
}

function _baseflowQ() {
  return _isMonsoon() ? KHADAKWASLA_MON_Q : KHADAKWASLA_DRY_Q;
}

/**
 * Rational Method: Q_runoff = (C × i × A) / 3.6
 * i in mm/hr, A in km², result in m³/s
 */
function _rainfallToRunoff(intensity_mm_hr) {
  if (!Number.isFinite(intensity_mm_hr) || intensity_mm_hr <= 0) return 0;
  return (RUNOFF_COEFF * intensity_mm_hr * CATCHMENT_AREA_KM2) / 3.6;
}

/**
 * Apply a simple 2-hour lag to the rainfall signal.
 * Uses the 2-hour-ago rainfall as the current effective runoff contributor.
 */
function _effectiveRainfallIntensity(hourlyData) {
  if (!hourlyData || hourlyData.length === 0) return 0;
  const now = Date.now();
  const lagMs = LAG_TIME_HOURS * 3600 * 1000;

  // Find the hourly slot closest to (now - lag)
  let best = null, bestDiff = Infinity;
  for (const pt of hourlyData) {
    const diff = Math.abs(pt.t - (now - lagMs));
    if (diff < bestDiff) { best = pt; bestDiff = diff; }
  }
  return best ? best.mm : 0;
}

/**
 * Fetch live rainfall from Open-Meteo and compute discharge.
 */
export async function fetchLiveHydrology() {
  try {
    const res  = await fetch(OPEN_METEO_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const cur = data.current;
    const currentRain_mm15min = Number(cur?.precipitation ?? 0); // mm per 15-min interval
    const currentRain_mm_hr   = currentRain_mm15min * 4;          // convert to mm/hr
    const weatherCode         = cur?.weather_code ?? 0;
    const fetchTime           = new Date(cur?.time ?? Date.now());

    // Build hourly series from past_hours data for lag calculation
    const hourlyTimes  = data.hourly?.time  ?? [];
    const hourlyPrecip = data.hourly?.precipitation ?? [];
    const hourlyData   = hourlyTimes.map((t, i) => ({
      t: new Date(t).getTime(),
      mm: (Number(hourlyPrecip[i]) || 0) * (60 / 1), // already mm/hr
    }));

    const laggedIntensity = _effectiveRainfallIntensity(hourlyData);
    const Q_runoff    = _rainfallToRunoff(laggedIntensity);
    const Q_baseflow  = _baseflowQ();
    const Q_total     = Math.max(Q_baseflow, Q_baseflow + Q_runoff);

    // Build today's 24-hour discharge trace
    const dischargeTrace = hourlyData.map(pt => ({
      time: new Date(pt.t).toISOString(),
      rainfall_mm_hr: pt.mm,
      Q_runoff: _rainfallToRunoff(pt.mm),
      Q_total: Q_baseflow + _rainfallToRunoff(pt.mm),
    }));

    _lastFetch = Date.now();
    _cachedResult = {
      fetchTime:          fetchTime.toISOString(),
      localTime:          fetchTime.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      currentRain_mm_hr,
      currentRain_mm15min,
      weatherCode,
      weatherDescription: _weatherDescription(weatherCode),
      Q_baseflow,
      Q_runoff,
      Q_total,
      Q_total_label:      `${Math.round(Q_total)} m³/s`,
      dischargeTrace,
      provenance: {
        rainfall:  "OBSERVED — Open-Meteo real-time (Pune 18.52°N 73.86°E)",
        baseflow:  "ASSUMED — Khadakwasla minimum release estimate",
        runoff:    "MODELLED — Rational Method (C=0.45, A=2000 km², lag=2h)",
        manningN:  "ASSUMED — 0.035 (not field-calibrated)",
        datum:     "RELATIVE — vertical datum UNVERIFIED",
        accuracy:  "DATA-DRIVEN ESTIMATION — not a field-calibrated model",
      },
      available: true,
    };

    _notify(_cachedResult);
    return _cachedResult;

  } catch (err) {
    console.warn("[LiveHydrology] Fetch failed:", err.message);
    const fallback = {
      fetchTime: new Date().toISOString(),
      currentRain_mm_hr: 0,
      Q_baseflow: _baseflowQ(),
      Q_runoff: 0,
      Q_total: _baseflowQ(),
      Q_total_label: `${_baseflowQ()} m³/s (baseflow fallback)`,
      dischargeTrace: [],
      provenance: { accuracy: "OFFLINE FALLBACK — Open-Meteo unavailable" },
      available: false,
      error: err.message,
    };
    _cachedResult = fallback;
    _notify(fallback);
    return fallback;
  }
}

/** Start auto-refresh every 15 minutes. */
export function startLiveHydrologyPolling() {
  if (_fetchTimer) return; // already running
  fetchLiveHydrology(); // immediate fetch
  _fetchTimer = setInterval(fetchLiveHydrology, FETCH_INTERVAL_MS);
  console.info("[LiveHydrology] Polling started (every 15 min). Source: Open-Meteo.");
}

export function stopLiveHydrologyPolling() {
  if (_fetchTimer) { clearInterval(_fetchTimer); _fetchTimer = null; }
}

/** Subscribe to live hydrology updates. Returns an unsubscribe function. */
export function subscribeLiveHydrology(listener) {
  _listeners.add(listener);
  if (_cachedResult) listener(_cachedResult); // immediate emit if data exists
  return () => _listeners.delete(listener);
}

export function getCachedLiveHydrology() {
  return _cachedResult;
}

function _notify(data) {
  for (const fn of _listeners) {
    try { fn(data); } catch (e) { console.error("[LiveHydrology] listener error:", e); }
  }
  if (typeof document !== "undefined") {
    document.dispatchEvent(new CustomEvent("live-hydrology-update", { detail: data }));
  }
}

function _weatherDescription(code) {
  if (code === 0)              return "Clear sky";
  if (code <= 3)               return "Partly cloudy";
  if (code <= 9)               return "Fog";
  if (code >= 51 && code <= 55) return "Drizzle";
  if (code >= 61 && code <= 65) return "Rain";
  if (code >= 80 && code <= 82) return "Rain showers";
  if (code >= 95)              return "Thunderstorm";
  return "Overcast";
}
