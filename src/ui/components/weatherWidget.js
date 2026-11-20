import { CloudSun } from "lucide";
import { lucideHtml } from "../icons.js";
import { fetchWeatherAt } from "../../services/weatherService.js";
import { loadBodCodPixels, lookupBodCodAt } from "../../services/bodCodPixelService.js";
import { getLiveDischargeAtChainage } from "../../services/forecastService.js";
import { mountWeatherOverview } from "../../weather/WeatherOverview.js";
import { state } from "../../state.js";

/**
 * Top-right LIVE WEATHER + always-on BOD/COD + chainage-local modelled discharge.
 * BOD/COD come from main-stream pixel samples (no map layer) at the selected chainage.
 * Weather icon opens Open-Meteo past/future detail graphs.
 */
export function mountWeatherWidget(root) {
  const el = document.createElement("aside");
  el.className = "hud weather-widget map-chrome";
  el.id = "weather-widget";
  el.innerHTML = `
    <button type="button" class="weather-icon" id="weather-icon-btn" title="Open live weather details" aria-label="Open live weather details">
      ${lucideHtml(CloudSun, { size: 18 })}
    </button>
    <div class="weather-wq" aria-label="Modelled discharge, BOD and COD at selected chainage">
      <div class="weather-wq-head">RIVER REACH</div>
      <div class="weather-wq-row is-q">
        <i data-short="DISCHARGE">Discharge</i>
        <b id="weather-discharge">—</b>
        <em id="weather-discharge-unit">m³/s</em>
      </div>
      <div class="weather-wq-row is-bod">
        <i data-short="BOD">BOD</i>
        <b id="weather-bod">—</b>
        <em>mg/L</em>
      </div>
      <div class="weather-wq-row is-cod">
        <i data-short="COD">COD</i>
        <b id="weather-cod">—</b>
        <em>mg/L</em>
      </div>
    </div>
    <button type="button" class="weather-copy weather-copy-btn" id="weather-open-detail" title="Open live weather details">
      <strong>LIVE WEATHER</strong>
      <b id="weather-temp" class="weather-temp">— °C</b>
      <i id="weather-condition" class="weather-condition">Weather unavailable</i>
      <small id="weather-wind">Wind —</small>
      <small id="weather-location">Station —</small>
    </button>
    <div class="weather-time-block" aria-label="Local date and time">
      <time class="weather-date" datetime="">—</time>
      <time class="weather-time" datetime="">--:--</time>
    </div>
  `;
  root.appendChild(el);

  const detail = mountWeatherOverview(root);
  /** @type {{ lat?:number, lon?:number, label?:string } | null} */
  let lastPoint = null;

  const dateEl = el.querySelector(".weather-date");
  const time = el.querySelector(".weather-time");
  const temperature = el.querySelector("#weather-temp");
  const condition = el.querySelector("#weather-condition");
  const wind = el.querySelector("#weather-wind");
  const rain = el.querySelector("#weather-rain");
  const location = el.querySelector("#weather-location");
  const dischargeEl = el.querySelector("#weather-discharge");
  const dischargeUnitEl = el.querySelector("#weather-discharge-unit");
  const bodEl = el.querySelector("#weather-bod");
  const codEl = el.querySelector("#weather-cod");

  let requestTimer = 0;
  let requestSerial = 0;
  let lastSuccessful = "";
  let weatherAvailable = false;

  let lastMeters = null;
  let bodLookupSerial = 0;
  let dischargeSerial = 0;

  const dateFmt = new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
  const timeFmt = new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  });

  const update = () => {
    const now = new Date();
    const iso = now.toISOString();
    dateEl.dateTime = iso;
    dateEl.textContent = dateFmt.format(now);
    if (!weatherAvailable && lastSuccessful) return;
    time.dateTime = iso;
    time.textContent = timeFmt.format(now);
  };
  update();
  const timer = window.setInterval(update, 1000);

  async function renderBodCod() {
    const lat = lastPoint?.lat;
    const lon = lastPoint?.lon;
    const serial = ++bodLookupSerial;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      bodEl.textContent = "—";
      codEl.textContent = "—";
      bodEl.title = codEl.title = "";
      return;
    }
    try {
      const hit = await lookupBodCodAt(lat, lon);
      if (serial !== bodLookupSerial) return;
      if (!hit) {
        bodEl.textContent = "—";
        codEl.textContent = "—";
        bodEl.title = codEl.title = "No BOD/COD pixel near this chainage";
        return;
      }
      bodEl.textContent = formatMetricNumber(hit.bod, 2);
      codEl.textContent = formatMetricNumber(hit.cod, 2);
      bodEl.title = codEl.title = `Main-stream pixel · ${hit.lat.toFixed(5)}, ${hit.lon.toFixed(5)}`;
    } catch (err) {
      if (serial !== bodLookupSerial) return;
      console.warn("[weather-wq]", err?.message || err);
      bodEl.textContent = "—";
      codEl.textContent = "—";
      bodEl.title = codEl.title = "BOD/COD unavailable";
    }
  }

  function formatMetricNumber(v, digits = 1) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    return n.toFixed(digits);
  }

  async function renderDischarge() {
    const meters =
      lastMeters != null
        ? lastMeters
        : Number.isFinite(state.selectedChainageMeters)
          ? state.selectedChainageMeters
          : 0;
    const serial = ++dischargeSerial;
    try {
      const q = await getLiveDischargeAtChainage(meters);
      if (serial !== dischargeSerial) return;
      dischargeEl.textContent = formatMetricNumber(q, 1);
      if (dischargeUnitEl) dischargeUnitEl.hidden = !Number.isFinite(q);
      dischargeEl.title = `Modelled discharge at chainage ${Math.round(meters)} m — not a gauge reading`;
      document.dispatchEvent(
        new CustomEvent("chainage-discharge", { detail: { meters, q } }),
      );
    } catch (err) {
      if (serial !== dischargeSerial) return;
      console.warn("[weather-q]", err?.message || err);
      dischargeEl.textContent = "—";
      if (dischargeUnitEl) dischargeUnitEl.hidden = true;
      dischargeEl.title = "Discharge unavailable";
    }
  }

  function updateBodCodForChainage(point) {
    lastMeters = point?.meters ?? state.selectedChainageMeters ?? null;
    void renderBodCod();
    void renderDischarge();
  }

  function updateForChainage(point) {
    lastPoint = point
      ? { lat: point.lat, lon: point.lon, label: point.label }
      : null;
    detail.setPoint(lastPoint);
    location.textContent = point?.label ? `Station ${point.label}` : "Station —";
    updateBodCodForChainage(point);
    window.clearTimeout(requestTimer);
    const serial = ++requestSerial;
    requestTimer = window.setTimeout(async () => {
      try {
        const weather = await fetchWeatherAt(point?.lat, point?.lon);
        if (serial !== requestSerial) return;
        temperature.textContent =
          weather.temperature == null ? "— °C" : `${weather.temperature.toFixed(0)}°C`;
        condition.textContent = weather.condition || "Weather unavailable";
        wind.textContent = weather.wind == null ? "Wind —" : `Wind ${weather.wind.toFixed(0)} km/h`;
        if (rain) {
          rain.textContent =
            weather.precipitation == null
              ? "Rain — mm"
              : `Rain ${weather.precipitation.toFixed(1)} mm`;
        }
        lastSuccessful = time.textContent;
        weatherAvailable = true;
        window.__MM_SCENE__?.applyLiveWeather?.(weather);
        state.liveWeather = { ...weather, fetchedAt: new Date().toISOString(), label: point?.label ?? null };
        document.dispatchEvent(new CustomEvent("chainage-weather", { detail: state.liveWeather }));
      } catch (error) {
        if (error?.name === "AbortError" || serial !== requestSerial) return;
        weatherAvailable = false;
        state.liveWeather = { error: error?.message || "Weather unavailable", label: point?.label ?? null };
        document.dispatchEvent(new CustomEvent("chainage-weather", { detail: state.liveWeather }));
        temperature.textContent = "— °C";
        condition.textContent = "Weather unavailable";
        wind.textContent = "Wind —";
        if (rain) rain.textContent = "Rain — mm";
        time.textContent = lastSuccessful ? `Last ${lastSuccessful}` : "Unavailable";
        dateEl.textContent = dateFmt.format(new Date());
      }
    }, 600);
  }

  function openDetail() {
    void detail.show(lastPoint);
  }
  el.querySelector("#weather-icon-btn")?.addEventListener("click", openDetail);
  el.querySelector("#weather-open-detail")?.addEventListener("click", openDetail);

  // Prefetch pixel samples + live Q so numbers appear on first chainage select
  void loadBodCodPixels().catch(() => {});
  void renderDischarge();

  return {
    el,
    updateForChainage,
    openDetail,
    dispose: () => {
      window.clearTimeout(requestTimer);
      window.clearInterval(timer);
      detail.dispose();
    },
  };
}
