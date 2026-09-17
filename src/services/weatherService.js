/**
 * Open-Meteo live weather — current conditions + 6-day past / 6-day forecast series.
 * Forecast: https://api.open-meteo.com
 * Air quality (PM2.5 / PM10): https://air-quality-api.open-meteo.com
 */

const cache = new Map();
const seriesCache = new Map();
/** @type {Map<string, Promise<object>>} */
const seriesInflight = new Map();
let activeController = null;

const PAST_DAYS = 6;
const FUTURE_DAYS = 6;

/** Mula–Mutha corridor fallback (Pune) when chainage coords are missing. */
export const FALLBACK_WEATHER_LL = { lat: 18.52, lon: 73.85 };

export async function fetchWeatherAt(lat, lon) {
  const q = quantizeLonLat(lat, lon);
  if (!q) throw new Error("Selected chainage has no coordinates");
  const key = `${q.lat.toFixed(2)},${q.lon.toFixed(2)}`;
  if (cache.has(key)) return cache.get(key);
  activeController?.abort();
  activeController = new AbortController();
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: String(q.lat),
    longitude: String(q.lon),
    current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,is_day",
    timezone: "Asia/Kolkata",
  });
  const res = await fetch(url, { signal: activeController.signal });
  if (!res.ok) throw new Error(`Weather request failed (${res.status})`);
  const json = await res.json();
  const current = json.current || {};
  const result = {
    temperature: Number.isFinite(current.temperature_2m) ? current.temperature_2m : null,
    apparent: Number.isFinite(current.apparent_temperature) ? current.apparent_temperature : null,
    wind: Number.isFinite(current.wind_speed_10m) ? current.wind_speed_10m : null,
    code: current.weather_code,
    isDay: current.is_day === 1,
    condition: weatherCondition(current.weather_code),
    lat: q.lat,
    lon: q.lon,
  };
  cache.set(key, result);
  return result;
}

/**
 * Daily series: past 6 days + today + next 6 days.
 * Dedupes in-flight requests so double-clicks don't abort each other.
 */
export async function fetchWeatherSeries(lat, lon, { bustCache = false } = {}) {
  const q = quantizeLonLat(lat, lon);
  if (!q) throw new Error("Selected chainage has no coordinates");
  const key = `series:${q.lat.toFixed(2)},${q.lon.toFixed(2)}`;
  if (bustCache) {
    seriesCache.delete(key);
    seriesInflight.delete(key);
  }
  if (seriesCache.has(key)) return seriesCache.get(key);
  if (seriesInflight.has(key)) return seriesInflight.get(key);

  const pending = loadWeatherSeries(q.lat, q.lon)
    .then((result) => {
      seriesCache.set(key, result);
      window.setTimeout(() => seriesCache.delete(key), 30 * 60 * 1000);
      return result;
    })
    .finally(() => {
      seriesInflight.delete(key);
    });

  seriesInflight.set(key, pending);
  return pending;
}

async function loadWeatherSeries(qLat, qLon) {
  const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
  forecastUrl.search = new URLSearchParams({
    latitude: String(qLat),
    longitude: String(qLon),
    timezone: "Asia/Kolkata",
    past_days: String(PAST_DAYS),
    forecast_days: String(FUTURE_DAYS + 1),
    daily: [
      "temperature_2m_max",
      "temperature_2m_min",
      "temperature_2m_mean",
      "precipitation_sum",
      "rain_sum",
      "wind_speed_10m_max",
    ].join(","),
  });

  const airUrl = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
  airUrl.search = new URLSearchParams({
    latitude: String(qLat),
    longitude: String(qLon),
    timezone: "Asia/Kolkata",
    past_days: String(PAST_DAYS),
    forecast_days: String(FUTURE_DAYS + 1),
    hourly: "pm10,pm2_5",
  });

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20000);

  let forecastRes;
  let airRes = null;
  try {
    [forecastRes, airRes] = await Promise.all([
      fetch(forecastUrl, { signal: controller.signal }),
      fetch(airUrl, { signal: controller.signal }).catch(() => null),
    ]);
  } finally {
    window.clearTimeout(timeout);
  }

  if (!forecastRes?.ok) {
    const detail = await safeText(forecastRes);
    throw new Error(`Open-Meteo forecast HTTP ${forecastRes?.status || "?"} ${detail}`.trim());
  }
  const forecast = await forecastRes.json();
  if (forecast?.error || forecast?.reason) {
    throw new Error(String(forecast.reason || forecast.error || "Open-Meteo error"));
  }

  let air = null;
  if (airRes?.ok) {
    try {
      air = await airRes.json();
    } catch {
      air = null;
    }
  }

  const daily = forecast.daily || {};
  const dates = Array.isArray(daily.time) ? daily.time : [];
  if (!dates.length) throw new Error("Open-Meteo returned no daily samples");

  const pmByDate = aggregateHourlyPm(air?.hourly);
  const todayKey = todayIsoInKolkata();
  const days = dates.map((date, i) => {
    const kind = date < todayKey ? "past" : date === todayKey ? "today" : "future";
    const tMax = num(daily.temperature_2m_max?.[i]);
    const tMin = num(daily.temperature_2m_min?.[i]);
    const tMean = num(daily.temperature_2m_mean?.[i]);
    const pm = pmByDate.get(date) || {};
    return {
      date,
      label: formatDayLabel(date),
      kind,
      temperature_max: tMax,
      temperature_min: tMin,
      temperature_mean: Number.isFinite(tMean)
        ? tMean
        : Number.isFinite(tMax) && Number.isFinite(tMin)
          ? (tMax + tMin) / 2
          : tMax ?? tMin,
      precipitation: num(daily.precipitation_sum?.[i]),
      rainfall: num(daily.rain_sum?.[i]),
      wind_max: num(daily.wind_speed_10m_max?.[i]),
      pm25: num(pm.pm25),
      pm10: num(pm.pm10),
    };
  });

  return {
    lat: qLat,
    lon: qLon,
    timezone: forecast.timezone || "Asia/Kolkata",
    pastDays: PAST_DAYS,
    futureDays: FUTURE_DAYS,
    today: todayKey,
    days,
    source: "Open-Meteo",
  };
}

function quantizeLonLat(lat, lon) {
  const a = Number(lat);
  const b = Number(lon);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return {
    lat: Math.round(a * 20) / 20,
    lon: Math.round(b * 20) / 20,
  };
}

async function safeText(res) {
  try {
    const t = await res?.text?.();
    return t ? String(t).slice(0, 120) : "";
  } catch {
    return "";
  }
}

function aggregateHourlyPm(hourly) {
  /** @type {Map<string, { pm25:number|null, pm10:number|null }>} */
  const map = new Map();
  if (!hourly?.time?.length) return map;
  /** @type {Map<string, { p25:number[], p10:number[] }>} */
  const buckets = new Map();
  for (let i = 0; i < hourly.time.length; i++) {
    const iso = String(hourly.time[i] || "");
    const day = iso.slice(0, 10);
    if (!day) continue;
    if (!buckets.has(day)) buckets.set(day, { p25: [], p10: [] });
    const b = buckets.get(day);
    const a = num(hourly.pm2_5?.[i]);
    const b10 = num(hourly.pm10?.[i]);
    if (Number.isFinite(a)) b.p25.push(a);
    if (Number.isFinite(b10)) b.p10.push(b10);
  }
  for (const [day, b] of buckets) {
    map.set(day, {
      pm25: b.p25.length ? mean(b.p25) : null,
      pm10: b.p10.length ? mean(b.p10) : null,
    });
  }
  return map;
}

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function todayIsoInKolkata() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function formatDayLabel(isoDate) {
  try {
    const d = new Date(`${isoDate}T12:00:00+05:30`);
    return new Intl.DateTimeFormat("en-IN", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      timeZone: "Asia/Kolkata",
    }).format(d);
  } catch {
    return isoDate;
  }
}

function weatherCondition(code) {
  const c = Number(code);
  if (c === 0) return "Clear";
  if ([1, 2, 3].includes(c)) return "Partly cloudy";
  if ([45, 48].includes(c)) return "Fog";
  if ([51, 53, 55, 56, 57].includes(c)) return "Drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(c)) return "Rain";
  if ([71, 73, 75, 77, 85, 86].includes(c)) return "Snow";
  if ([95, 96, 99].includes(c)) return "Storm";
  return "Weather unavailable";
}

export { weatherCondition, PAST_DAYS, FUTURE_DAYS };
