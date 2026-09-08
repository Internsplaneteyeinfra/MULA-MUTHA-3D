const cache = new Map();
let activeController = null;

export async function fetchWeatherAt(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("Selected chainage has no coordinates");
  const qLat = Math.round(lat * 20) / 20;
  const qLon = Math.round(lon * 20) / 20;
  const key = `${qLat.toFixed(2)},${qLon.toFixed(2)}`;
  if (cache.has(key)) return cache.get(key);
  activeController?.abort();
  activeController = new AbortController();
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: String(qLat),
    longitude: String(qLon),
    current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,is_day",
    timezone: "auto",
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
  };
  cache.set(key, result);
  return result;
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
