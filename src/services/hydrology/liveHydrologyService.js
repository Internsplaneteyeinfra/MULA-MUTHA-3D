/**
 * Live Hydrology Service — Mula–Mutha River
 * ──────────────────────────────────────────────────────────────────────
 * Authoritative free feeds (no API key):
 *
 * 1. GloFAS river discharge via Open-Meteo Flood API
 *    https://flood-api.open-meteo.com/v1/flood
 *    Copernicus EMS Global Flood Awareness System — simulated daily Q (m³/s)
 *    at the nearest ~5 km river cell to Bund Garden / Pune corridor.
 *
 * 2. Open-Meteo weather (rainfall) — used only as a secondary runoff estimate
 *    when GloFAS is unavailable.
 *
 * CWC Bund Garden / India-WRIS gauge telemetry requires institutional auth
 * (see public/data/sources/cwc_bund_garden/source.json) — never fabricated.
 *
 * Downstream: Q drives 1D Manning normal-depth → relative stage on the 3D sheet.
 * Provenance is always labelled MODELLED (GloFAS) or ESTIMATED (rainfall-runoff).
 */

const BUND_GARDEN = { lat: 18.5367, lon: 73.8817 };

const GLOFAS_URL =
  "https://flood-api.open-meteo.com/v1/flood" +
  `?latitude=${BUND_GARDEN.lat}&longitude=${BUND_GARDEN.lon}` +
  "&daily=river_discharge" +
  "&past_days=7" +
  "&forecast_days=1" +
  "&timezone=Asia%2FKolkata";

const OPEN_METEO_URL =
  "https://api.open-meteo.com/v1/forecast" +
  "?latitude=18.5204&longitude=73.8567" +
  "&current=precipitation,rain,showers,weather_code" +
  "&hourly=precipitation" +
  "&past_hours=3" +
  "&forecast_hours=6" +
  "&timezone=Asia%2FKolkata";

// Rainfall-runoff fallback parameters (ASSUMED — used only if GloFAS fails)
const CATCHMENT_AREA_KM2 = 2000;
const RUNOFF_COEFF = 0.45;
const LAG_TIME_HOURS = 2.0;
const KHADAKWASLA_DRY_Q = 15;
const KHADAKWASLA_MON_Q = 35;
const MONSOON_MONTHS = [6, 7, 8, 9, 10];

let _lastFetch = null;
let _cachedResult = null;
let _listeners = new Set();
let _fetchTimer = null;
const FETCH_INTERVAL_MS = 15 * 60 * 1000;

function _isMonsoon() {
  return MONSOON_MONTHS.includes(new Date().getMonth() + 1);
}

function _baseflowQ() {
  return _isMonsoon() ? KHADAKWASLA_MON_Q : KHADAKWASLA_DRY_Q;
}

function _rainfallToRunoff(intensity_mm_hr) {
  if (!Number.isFinite(intensity_mm_hr) || intensity_mm_hr <= 0) return 0;
  return (RUNOFF_COEFF * intensity_mm_hr * CATCHMENT_AREA_KM2) / 3.6;
}

function _effectiveRainfallIntensity(hourlyData) {
  if (!hourlyData || hourlyData.length === 0) return 0;
  const now = Date.now();
  const lagMs = LAG_TIME_HOURS * 3600 * 1000;
  let best = null;
  let bestDiff = Infinity;
  for (const pt of hourlyData) {
    const diff = Math.abs(pt.t - (now - lagMs));
    if (diff < bestDiff) {
      best = pt;
      bestDiff = diff;
    }
  }
  return best ? best.mm : 0;
}

function _weatherDescription(code) {
  if (code === 0) return "Clear sky";
  if (code <= 3) return "Partly cloudy";
  if (code <= 9) return "Fog";
  if (code >= 51 && code <= 55) return "Drizzle";
  if (code >= 61 && code <= 65) return "Rain";
  if (code >= 80 && code <= 82) return "Rain showers";
  if (code >= 95) return "Thunderstorm";
  return "Overcast";
}

/**
 * Latest non-null GloFAS daily discharge (prefer today, else most recent past day).
 */
function _pickGlofasQ(daily) {
  const times = daily?.time || [];
  const qs = daily?.river_discharge || [];
  if (!times.length || !qs.length) return null;
  const today = new Date().toISOString().slice(0, 10);
  for (let i = times.length - 1; i >= 0; i--) {
    const q = Number(qs[i]);
    if (!Number.isFinite(q) || q < 0) continue;
    if (times[i] <= today) {
      return { Q: q, date: times[i] };
    }
  }
  for (let i = qs.length - 1; i >= 0; i--) {
    const q = Number(qs[i]);
    if (Number.isFinite(q) && q >= 0) return { Q: q, date: times[i] };
  }
  return null;
}

async function _fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Fetch live GloFAS discharge (+ rainfall context) and publish Q for the hydraulic engine.
 */
export async function fetchLiveHydrology() {
  let glofas = null;
  let weather = null;
  let glofasErr = null;
  let weatherErr = null;

  const [gRes, wRes] = await Promise.allSettled([
    _fetchJson(GLOFAS_URL),
    _fetchJson(OPEN_METEO_URL),
  ]);

  if (gRes.status === "fulfilled") glofas = gRes.value;
  else glofasErr = gRes.reason?.message || String(gRes.reason);

  if (wRes.status === "fulfilled") weather = wRes.value;
  else weatherErr = wRes.reason?.message || String(wRes.reason);

  const cur = weather?.current;
  const currentRain_mm15min = Number(cur?.precipitation ?? 0);
  const currentRain_mm_hr = currentRain_mm15min * 4;
  const weatherCode = cur?.weather_code ?? 0;
  const fetchTime = new Date(cur?.time ?? Date.now());

  const hourlyTimes = weather?.hourly?.time ?? [];
  const hourlyPrecip = weather?.hourly?.precipitation ?? [];
  const hourlyData = hourlyTimes.map((t, i) => ({
    t: new Date(t).getTime(),
    mm: Number(hourlyPrecip[i]) || 0,
  }));

  const laggedIntensity = _effectiveRainfallIntensity(hourlyData);
  const Q_runoff = _rainfallToRunoff(laggedIntensity);
  const Q_baseflow = _baseflowQ();
  const Q_rainEstimate = Math.max(Q_baseflow, Q_baseflow + Q_runoff);

  const pick = _pickGlofasQ(glofas?.daily);
  const hasGlofas = pick != null && Number.isFinite(pick.Q);

  // Prefer GloFAS river discharge (live modelled hydrology). Rainfall-runoff is fallback only.
  const Q_total = hasGlofas ? pick.Q : Q_rainEstimate;
  const available = hasGlofas || weather != null;

  const dischargeTrace = (glofas?.daily?.time || []).map((t, i) => ({
    time: `${t}T00:00:00+05:30`,
    rainfall_mm_hr: null,
    Q_glofas: Number(glofas.daily.river_discharge[i]),
    Q_total: Number(glofas.daily.river_discharge[i]),
  }));

  _lastFetch = Date.now();
  _cachedResult = {
    fetchTime: fetchTime.toISOString(),
    localTime: fetchTime.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
    currentRain_mm_hr,
    currentRain_mm15min,
    weatherCode,
    weatherDescription: _weatherDescription(weatherCode),
    Q_baseflow,
    Q_runoff,
    Q_rainEstimate,
    Q_glofas: hasGlofas ? pick.Q : null,
    Q_glofas_date: hasGlofas ? pick.date : null,
    Q_total,
    Q_total_label: hasGlofas
      ? `${Math.round(Q_total * 10) / 10} m³/s (GloFAS ${pick.date})`
      : `${Math.round(Q_total)} m³/s (rainfall estimate)`,
    dischargeTrace,
    cell: glofas
      ? { lat: glofas.latitude, lon: glofas.longitude, elevation_m: glofas.elevation }
      : null,
    provenance: {
      primary: hasGlofas
        ? "OBSERVED_MODEL — Copernicus GloFAS v4 river_discharge via Open-Meteo Flood API"
        : "ESTIMATED — Open-Meteo rainfall-runoff (GloFAS unavailable)",
      rainfall: weather
        ? "OBSERVED — Open-Meteo real-time (Pune 18.52°N 73.86°E)"
        : `UNAVAILABLE — ${weatherErr || "no weather"}`,
      discharge: hasGlofas
        ? `GLOFAS_DAILY — nearest cell (~5 km) to Bund Garden; date=${pick.date}`
        : "RAINFALL_RUNOFF_FALLBACK",
      gauge: "UNAVAILABLE — CWC Bund Garden / India-WRIS requires institutional auth",
      manningN: "ASSUMED — 0.035 (not field-calibrated)",
      datum: "RELATIVE — stage applied as delta from survey baseline depth (not absolute MSL)",
      accuracy: hasGlofas
        ? "LIVE MODELLED DISCHARGE — GloFAS is a global hydrological model, not a river gauge"
        : "ESTIMATED — not gauge-calibrated",
    },
    available,
    errors: { glofas: glofasErr, weather: weatherErr },
  };

  if (!available) {
    _cachedResult = {
      ..._cachedResult,
      Q_total: Q_baseflow,
      Q_total_label: `${Q_baseflow} m³/s (baseflow fallback)`,
      available: false,
      provenance: {
        ..._cachedResult.provenance,
        accuracy: "OFFLINE FALLBACK — live feeds unavailable",
      },
    };
  }

  _notify(_cachedResult);
  console.info(
    "[LiveHydrology]",
    hasGlofas
      ? `GloFAS Q=${pick.Q.toFixed(2)} m³/s (${pick.date})`
      : `fallback Q=${Q_total.toFixed(1)} m³/s`,
    `rain=${currentRain_mm_hr} mm/hr`,
  );
  return _cachedResult;
}

/** Start auto-refresh every 15 minutes. */
export function startLiveHydrologyPolling() {
  if (_fetchTimer) return;
  fetchLiveHydrology();
  _fetchTimer = setInterval(fetchLiveHydrology, FETCH_INTERVAL_MS);
  console.info("[LiveHydrology] Polling started (15 min). Sources: GloFAS + Open-Meteo.");
}

export function stopLiveHydrologyPolling() {
  if (_fetchTimer) {
    clearInterval(_fetchTimer);
    _fetchTimer = null;
  }
}

export function subscribeLiveHydrology(listener) {
  _listeners.add(listener);
  if (_cachedResult) listener(_cachedResult);
  return () => _listeners.delete(listener);
}

export function getCachedLiveHydrology() {
  return _cachedResult;
}

function _notify(data) {
  for (const fn of _listeners) {
    try {
      fn(data);
    } catch (e) {
      console.error("[LiveHydrology] listener error:", e);
    }
  }
  if (typeof document !== "undefined") {
    document.dispatchEvent(new CustomEvent("live-hydrology-update", { detail: data }));
  }
}
